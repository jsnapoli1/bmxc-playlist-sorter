/**
 * One Durable Object per plan: the live editing session.
 *
 * Everyone editing a plan connects here over a WebSocket. Ops arrive, are
 * applied in the order this object receives them, and are broadcast to the
 * other editors. Because every client applies the same ops in the same
 * order, they converge without anyone's edit clobbering anyone else's.
 *
 * The object also owns Spotify sync. Running it here rather than in each
 * browser means one sync per plan no matter how many people are editing —
 * three connected editors would otherwise fire three competing reorders.
 */

import type { Plan } from '../src/lib/types.ts'
import type { ClientMessage, Op, Presence, Role, ServerMessage, SyncState } from '../src/lib/protocol.ts'
import { canEdit, MAX_OPS_PER_MESSAGE } from '../src/lib/protocol.ts'
import { applyOps } from '../src/lib/applyOp.ts'
import { displayOrderedTracks, orderedTrackIds } from '../src/lib/playlistOrder.ts'
import { missingFromSpotify, reorderMoves } from '../src/lib/spotifyDiff.ts'
import { inferSections } from '../src/lib/inheritSection.ts'
import { adoptOrder } from '../src/lib/adoptSpotifyOrder.ts'
import { describeRateLimit, OwnerSpotify, RateLimited, SpotifyError, sealRefreshToken } from './spotify.ts'
import type { Env } from './env.ts'

/** Wait for edits to settle before pushing to Spotify. */
const SYNC_DEBOUNCE_MS = 5_000
/** Write the plan back to D1 at most this often. */
const PERSIST_DEBOUNCE_MS = 2_000
/** Give up on a sync that keeps failing, rather than hammering Spotify. */
const MAX_SYNC_FAILURES = 3
/**
 * How often to re-read the playlist from Spotify while someone has it
 * open, so a song added in the Spotify app shows up on its own.
 */
const POLL_MS = 120_000
/**
 * Hard floor between playlist reads, whatever asked for one.
 *
 * startPolling() polls immediately so a freshly opened page is current, and
 * it runs on every socket connect — so a flapping phone connection turned
 * into a read per reconnect on top of the interval. Worse, a read is one
 * request per 100 songs, so a 300-song playlist tripled it. That is what
 * earned a multi-hour rate-limit ban from Spotify.
 */
const MIN_POLL_GAP_MS = 30_000
/**
 * Pause between reorder calls. A long reorder is one request per moved song,
 * and firing them back to back is what walks into Spotify's rolling-window
 * limit; a short gap keeps a big change inside it.
 */
const REORDER_GAP_MS = 250

type Session = {
  socket: WebSocket
  collaboratorId: string
  displayName: string
  role: Role
}

export class PlanRoom implements DurableObject {
  private plan: Plan | null = null
  private planId = ''
  private rev = 0
  private spotifyPlaylistId: string | null = null
  private ownerId = ''
  private loaded = false

  private sessions = new Map<WebSocket, Session>()

  private sync: SyncState = {
    status: 'off',
    lastSyncedAt: null,
    error: null,
    playlistName: null,
  }
  private syncTimer: number | null = null
  private persistTimer: number | null = null
  private syncFailures = 0
  private syncRunning = false
  /** Set when an edit lands while a sync is in flight. */
  private syncQueued = false
  private pollTimer: number | null = null
  private polling = false
  /** Track ids last seen on Spotify, to skip work when nothing changed. */
  private lastPollSignature = ''
  /** When the last Spotify read actually happened, for MIN_POLL_GAP_MS. */
  private lastPollAt = 0
  /**
   * Epoch ms before which Spotify will refuse us. Checked on every natural
   * trigger rather than relying on a timer: a long ban outlives the Durable
   * Object, which is evicted when idle, so a setTimeout hours out would
   * silently never fire.
   */
  private rateLimitedUntilMs = 0

  // `state` is required by the runtime's constructor signature. This room
  // keeps its authoritative copy in D1 rather than DO storage, so the handle
  // itself is not retained.
  constructor(_state: DurableObjectState, private readonly env: Env) {}

  // --- loading -------------------------------------------------------

  private async load(planId: string): Promise<void> {
    if (this.loaded) return
    this.planId = planId

    const row = await this.env.DB.prepare(
      'SELECT owner_id, doc, rev, spotify_playlist_id FROM plans WHERE id = ?',
    )
      .bind(planId)
      .first<{ owner_id: string; doc: string; rev: number; spotify_playlist_id: string | null }>()

    if (!row) throw new Error('Plan not found.')

    this.ownerId = row.owner_id
    this.plan = JSON.parse(row.doc) as Plan
    this.rev = row.rev
    this.spotifyPlaylistId = row.spotify_playlist_id
    this.sync = {
      ...this.sync,
      status: this.spotifyPlaylistId ? 'idle' : 'off',
    }
    this.loaded = true
  }

  // --- persistence ---------------------------------------------------

  private schedulePersist(): void {
    if (this.persistTimer !== null) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persist()
    }, PERSIST_DEBOUNCE_MS) as unknown as number
  }

  private async persist(): Promise<void> {
    if (!this.plan) return
    await this.env.DB.prepare(
      'UPDATE plans SET doc = ?, rev = ?, name = ?, updated_at = ? WHERE id = ?',
    )
      .bind(JSON.stringify(this.plan), this.rev, this.plan.name, Date.now(), this.planId)
      .run()
  }

  // --- websocket -----------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const planId = url.searchParams.get('plan') ?? ''
    const collaboratorId = url.searchParams.get('cid') ?? ''
    const displayName = url.searchParams.get('name') ?? 'Someone'
    const role = (url.searchParams.get('role') ?? 'viewer') as Role

    // The Worker authenticates before forwarding here; this object trusts
    // those parameters and is never routed to directly from outside.
    try {
      await this.load(planId)
    } catch (err) {
      return new Response((err as Error).message, { status: 404 })
    }

    // The Worker calls this when the owner points the plan at a playlist,
    // so a room that loaded before that learns about it without waiting
    // for a restart.
    if (url.searchParams.get('event') === 'playlist-changed') {
      const next = url.searchParams.get('playlistId') || null
      this.spotifyPlaylistId = next
      this.syncFailures = 0
      this.setSync({
        status: next ? 'idle' : 'off',
        error: null,
        playlistName: null,
      })
      if (next) {
        this.scheduleSync()
        this.startPolling()
      } else {
        this.stopPolling()
      }
      return new Response(null, { status: 204 })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    const session: Session = { socket: server, collaboratorId, displayName, role }
    this.sessions.set(server, session)

    server.addEventListener('message', (event) => {
      void this.onMessage(session, event.data as string)
    })
    const drop = () => {
      this.sessions.delete(server)
      this.broadcastPresence()
      // Nobody is watching; stop calling Spotify.
      if (this.sessions.size === 0) this.stopPolling()
    }
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)

    this.startPolling()

    this.send(server, {
      t: 'snapshot',
      rev: this.rev,
      doc: this.plan,
      you: { collaboratorId, displayName, role },
      peers: this.peers(),
      sync: this.sync,
    })
    this.broadcastPresence()

    return new Response(null, { status: 101, webSocket: client })
  }

  private peers(): Presence[] {
    return [...this.sessions.values()].map((s) => ({
      collaboratorId: s.collaboratorId,
      displayName: s.displayName,
      role: s.role,
    }))
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // A socket that has gone away is dropped by its own close handler.
    }
  }

  private broadcast(message: ServerMessage, except?: WebSocket): void {
    for (const [socket] of this.sessions) {
      if (socket !== except) this.send(socket, message)
    }
  }

  private broadcastPresence(): void {
    this.broadcast({ t: 'presence', peers: this.peers() })
  }

  private async onMessage(session: Session, raw: string): Promise<void> {
    let message: ClientMessage
    try {
      message = JSON.parse(raw) as ClientMessage
    } catch {
      this.send(session.socket, { t: 'error', message: 'Malformed message.' })
      return
    }

    if (message.t === 'ping') return

    if (message.t === 'retrySync') {
      // A paused sync never retries on its own, so without this the only way
      // out was to re-save the playlist in settings.
      if (!canEdit(session.role)) return
      if (!this.spotifyPlaylistId) return
      // Retrying cannot shorten a rate-limit window; say how long is left
      // rather than clearing the notice and appearing to have done something.
      if (Date.now() < this.rateLimitedUntilMs) {
        const leftMs = this.rateLimitedUntilMs - Date.now()
        this.setSync({ status: 'pending', error: describeRateLimit(leftMs / 1000) })
        return
      }
      this.syncFailures = 0
      this.setSync({ status: 'idle', error: null })
      this.scheduleSync()
      return
    }

    if (message.t === 'hello') {
      this.send(session.socket, {
        t: 'snapshot',
        rev: this.rev,
        doc: this.plan,
        you: {
          collaboratorId: session.collaboratorId,
          displayName: session.displayName,
          role: session.role,
        },
        peers: this.peers(),
        sync: this.sync,
      })
      return
    }

    if (message.t !== 'ops') return

    if (!canEdit(session.role)) {
      this.send(session.socket, {
        t: 'error',
        message: 'You have view-only access to this plan.',
      })
      return
    }
    if (!Array.isArray(message.ops) || message.ops.length > MAX_OPS_PER_MESSAGE) {
      this.send(session.socket, { t: 'error', message: 'Too many changes in one message.' })
      return
    }

    await this.applyAndBroadcast(message.ops, session, message.clientSeq)
  }

  private async applyAndBroadcast(ops: Op[], from: Session, clientSeq: number): Promise<void> {
    if (!this.plan || !ops.length) return

    const before = this.plan
    this.plan = applyOps(this.plan, ops)
    this.rev += 1

    this.send(from.socket, { t: 'ack', rev: this.rev, clientSeq })
    this.broadcast({ t: 'ops', rev: this.rev, ops, from: from.collaboratorId }, from.socket)

    this.schedulePersist()

    // Only a change to the master order can affect Spotify; block edits and
    // notes never do.
    const orderChanged = this.masterOrderChanged(before, this.plan)
    if (this.spotifyPlaylistId && orderChanged) {
      this.scheduleSync()
    } else if (orderChanged) {
      console.log(`sync skipped: plan=${this.planId} has no Spotify playlist set`)
    }
  }

  private masterOrderChanged(before: Plan, after: Plan): boolean {
    const a = displayOrderedTracks(before).map((t) => t.uri)
    const b = displayOrderedTracks(after).map((t) => t.uri)
    if (a.length !== b.length) return true
    return a.some((uri, i) => uri !== b[i])
  }

  // --- polling Spotify for new songs ------------------------------------

  private startPolling(): void {
    if (this.pollTimer !== null || !this.spotifyPlaylistId) return
    this.pollTimer = setInterval(() => void this.pollPlaylist(), POLL_MS) as unknown as number
    // Check straight away too, so opening the page picks up new songs
    // without waiting a full interval. Polling stops when the last person
    // leaves, so this restarts on every reconnect — the gap floor inside
    // pollPlaylist is what keeps a flapping connection from re-reading the
    // playlist each time.
    void this.pollPlaylist()
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /** Stop polling for a while, then resume the normal interval. */
  private pausePollingFor(ms: number): void {
    this.stopPolling()
    setTimeout(() => {
      // Only resume if someone is still watching.
      if (this.sessions.size > 0) this.startPolling()
    }, ms)
  }

  /**
   * Re-read the playlist and fold in anything that changed on Spotify's
   * side — songs added or removed in the Spotify app.
   *
   * Runs server-side so one poll serves everyone with the plan open, and
   * so it works for collaborators who have no Spotify account of their
   * own. Skips entirely when the song list is unchanged, which is the
   * normal case, so a quiet plan costs one read every 15s and no writes.
   */
  private async pollPlaylist(force = false): Promise<void> {
    if (this.polling || !this.plan || !this.spotifyPlaylistId) return
    // A push in flight would race a pull; the next tick will catch up.
    if (this.syncRunning || this.sync.status === 'paused') return
    // Rate limiting is account-wide, so a read refused here also costs the
    // sync that matters. Never read more often than the floor allows.
    if (Date.now() < this.rateLimitedUntilMs) return
    const since = Date.now() - this.lastPollAt
    if (!force && this.lastPollAt > 0 && since < MIN_POLL_GAP_MS) return
    this.lastPollAt = Date.now()
    this.polling = true

    try {
      const spotify = await this.ownerClient()
      const tracks = await spotify.playlistTracks(this.spotifyPlaylistId)

      const signature = tracks.map((t) => t.id).join(',')
      if (signature === this.lastPollSignature) return
      this.lastPollSignature = signature

      const known = new Set(Object.keys(this.plan.tracks))
      const added = tracks.filter((t) => !known.has(t.id)).length
      const removed = [...known].filter(
        (id) =>
          this.plan?.tracks[id]?.sourceId === this.spotifyPlaylistId &&
          !tracks.some((t) => t.id === id),
      ).length

      // Someone reordering in the Spotify app changes neither count. That
      // used to end the poll here, so their edit survived only until the
      // next push overwrote it.
      const target = displayOrderedTracks(this.plan)
        .map((t) => t.id)
        .filter((id) => tracks.some((t) => t.id === id))
      const onSpotify = tracks.map((t) => t.id).filter((id) => known.has(id))
      const reordered =
        target.length === onSpotify.length && target.some((id, i) => id !== onSpotify[i])

      if (added === 0 && removed === 0 && !reordered) return

      // A song added inside one of the section runs the app pushed to
      // Spotify carries its intent in its position. Resolve that before
      // applying, so it lands filed rather than in Unsorted.
      const placed = new Map(
        Object.values(this.plan.tracks).map((t) => [t.id, { id: t.id, sectionId: t.sectionId }]),
      )
      const newIds = tracks.filter((t) => !known.has(t.id)).map((t) => t.id)
      const inferred = inferSections(
        tracks.map((t) => t.id),
        placed,
        newIds,
      )

      const op: Op = {
        type: 'syncTracks',
        tracks: tracks.map((t) =>
          inferred.has(t.id) ? { ...t, sectionId: inferred.get(t.id) } : t,
        ),
        sourceId: this.spotifyPlaylistId,
      }
      const ops: Op[] = [op]

      if (reordered) {
        // Spotify wins: adopt its order and, critically, do not schedule a
        // push. Pushing would immediately rewrite the playlist back into the
        // app's order, which is the behaviour being fixed.
        const applied = applyOps(this.plan, [op])
        const sectionIds = (applied.sections ?? []).map((sc) => sc.id)
        const { order, moved } = adoptOrder({
          spotifyOrder: tracks.map((t) => t.id).filter((id) => applied.tracks[id]),
          currentOrder: orderedTrackIds(applied),
          sectionOf: (id) => applied.tracks[id]?.sectionId,
          sectionIds,
        })
        const sections: Record<string, string | null> = {}
        for (const [id, section] of moved) sections[id] = section ?? null
        ops.push({ type: 'adoptOrder', order, sections })
        console.log(
          `poll adopted order: plan=${this.planId} moved=${moved.size} songs=${order.length}`,
        )
      }

      this.plan = applyOps(this.plan, ops)
      this.rev += 1
      // Everyone applies the same op, so the change lands identically in
      // every open browser.
      this.broadcast({ t: 'ops', rev: this.rev, ops, from: 'spotify' })
      this.schedulePersist()
      console.log(
        `poll: plan=${this.planId} added=${added} removed=${removed} total=${tracks.length}`,
      )
    } catch (err) {
      // A rate-limited poll must stop polling, or the 15s tick keeps the
      // limit alive and starves the sync that actually matters.
      if (err instanceof RateLimited) {
        console.log(`poll rate limited: plan=${this.planId} retryAfter=${err.retryAfterS}s`)
        this.pausePollingFor(Math.max(1, err.retryAfterS) * 1000)
        return
      }
      // Any other failed poll is not worth surfacing: the plan is unaffected
      // and the next tick retries.
      console.log(`poll failed: plan=${this.planId} ${(err as Error).message}`)
    } finally {
      this.polling = false
    }
  }

  // --- Spotify sync ---------------------------------------------------

  private setSync(patch: Partial<SyncState>): void {
    this.sync = { ...this.sync, ...patch }
    this.broadcast({ t: 'sync', sync: this.sync })
  }

  private scheduleSync(): void {
    if (this.sync.status === 'paused') return
    if (this.syncRunning) {
      this.syncQueued = true
      return
    }
    if (this.syncTimer !== null) clearTimeout(this.syncTimer)
    this.setSync({ status: 'pending' })
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      void this.runSync()
    }, SYNC_DEBOUNCE_MS) as unknown as number
  }

  /**
   * Push the master order to Spotify.
   *
   * Deliberately conservative: it reads the playlist first and computes a
   * minimal set of moves, so an unchanged playlist costs one read and no
   * writes. On failure it stops rather than retrying into a half-reordered
   * playlist, and says why.
   */
  private async runSync(): Promise<void> {
    if (!this.plan || !this.spotifyPlaylistId) return
    // A ban can outlive this object; re-check the deadline rather than
    // trusting a timer that may have died with an eviction.
    if (Date.now() < this.rateLimitedUntilMs) {
      const leftMs = this.rateLimitedUntilMs - Date.now()
      this.setSync({ status: 'pending', error: describeRateLimit(leftMs / 1000) })
      this.syncQueued = true
      return
    }

    this.syncRunning = true
    // Set by the rate-limit branch below to the wait Spotify asked for.
    let rateLimitedUntil = 0
    this.setSync({ status: 'syncing', error: null })
    console.log(`sync start: plan=${this.planId} playlist=${this.spotifyPlaylistId}`)

    try {
      const spotify = await this.ownerClient()
      const playlistId = this.spotifyPlaylistId

      // No permission pre-check here. The reorder below is the write itself,
      // and Spotify answers with a 403 that already surfaces as a permanent
      // sync error — guessing first only risks refusing something Spotify
      // would have allowed, which is what the `collaborative` flag did.
      const meta = await spotify.playlist(playlistId)

      const current = await spotify.playlistTrackUris(playlistId)
      // Local songs have no Spotify uri and simply do not participate.
      // The order on screen, grouped by section — not the raw drag order.
      const target = displayOrderedTracks(this.plan)
        .map((t) => t.uri)
        .filter(Boolean)

      // Reading back an empty playlist when the plan has songs means the
      // read failed, not that the playlist is empty. Pushing zero moves
      // and reporting success is how a broken read hid for so long.
      if (current.length === 0 && target.length > 0) {
        throw new SpotifyError(
          'Spotify returned no songs for this playlist, so the order could not be compared. ' +
            'If the playlist does have songs, the app could not read them.',
          502,
          false,
        )
      }

      const moves = reorderMoves(current, target)
      const absent = missingFromSpotify(current, target)
      console.log(
        `sync diff: plan=${this.planId} spotify=${current.length} app=${target.length} ` +
          `moves=${moves.length} missing=${absent.length}`,
      )

      let snapshot = meta.snapshot_id
      for (const [i, move] of moves.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, REORDER_GAP_MS))
        const result = await spotify.reorder(playlistId, move, snapshot)
        // Chain snapshots so a concurrent edit in the Spotify app is caught
        // rather than silently overwritten.
        snapshot = result.snapshot_id
      }

      this.syncFailures = 0
      console.log(`sync done: plan=${this.planId} moves=${moves.length}`)
      this.setSync({
        status: 'synced',
        lastSyncedAt: Date.now(),
        error: absent.length
          ? `${absent.length} song${absent.length === 1 ? '' : 's'} in the plan ${
              absent.length === 1 ? 'is' : 'are'
            } not in the Spotify playlist, so ${absent.length === 1 ? 'it was' : 'they were'} left out of the order.`
          : null,
        playlistName: meta.name,
      })
    } catch (err) {
      // Rate limiting is not a failure — it is Spotify telling us when to
      // come back. Don't count it toward MAX_SYNC_FAILURES, don't pause;
      // just wait out the window it gave us and pick up where we left off.
      if (err instanceof RateLimited) {
        const waitMs = Math.max(1, err.retryAfterS) * 1000
        console.log(`sync rate limited: plan=${this.planId} retryAfter=${err.retryAfterS}s`)
        this.setSync({ status: 'pending', error: err.message })
        // Owns the retry itself, and says so, because `finally` below would
        // otherwise reschedule on the normal debounce and walk straight back
        // into the limit.
        rateLimitedUntil = waitMs
        this.rateLimitedUntilMs = Date.now() + waitMs
        return
      }

      const error = err as SpotifyError
      this.syncFailures += 1
      console.log(
        `sync failed: plan=${this.planId} status=${error.status ?? '?'} ` +
          `permanent=${error instanceof SpotifyError && error.permanent} message=${error.message}`,
      )
      const permanent = error instanceof SpotifyError && error.permanent
      const exhausted = this.syncFailures >= MAX_SYNC_FAILURES

      // Only an auth problem is actually fixed by reconnecting; saying so for
      // every pause sent people to re-do a sign-in that was never broken.
      const isAuth = error.status === 401 || error.status === 403
      this.setSync({
        status: permanent || exhausted ? 'paused' : 'idle',
        error:
          (error.message || 'Could not reach Spotify.') +
          (permanent || exhausted
            ? isAuth
              ? ' Syncing is paused — reconnect Spotify to resume.'
              : ' Syncing is paused. Use “Try syncing again” once the problem is sorted.'
            : ''),
      })
    } finally {
      this.syncRunning = false
      if (rateLimitedUntil > 0) {
        // Come back when Spotify said to, keeping any queued edits pending
        // so they go out with that run.
        this.syncQueued = true
        if (this.syncTimer !== null) clearTimeout(this.syncTimer)
        this.syncTimer = setTimeout(() => {
          this.syncTimer = null
          this.syncQueued = false
          void this.runSync()
        }, rateLimitedUntil) as unknown as number
      } else if (this.syncQueued && this.sync.status !== 'paused') {
        this.syncQueued = false
        this.scheduleSync()
      }
    }
  }

  private async ownerClient(): Promise<OwnerSpotify> {
    const row = await this.env.DB.prepare(
      'SELECT refresh_token_enc FROM owners WHERE spotify_user_id = ?',
    )
      .bind(this.ownerId)
      .first<{ refresh_token_enc: string }>()

    if (!row) throw new SpotifyError('The owner has not connected Spotify.', 401, true)

    return OwnerSpotify.fromEncrypted(
      row.refresh_token_enc,
      this.env.ENCRYPTION_KEY,
      this.env.SPOTIFY_CLIENT_ID,
      this.env.SPOTIFY_CLIENT_SECRET,
      async (rotated) => {
        const sealed = await sealRefreshToken(rotated, this.env.ENCRYPTION_KEY)
        await this.env.DB.prepare(
          'UPDATE owners SET refresh_token_enc = ?, updated_at = ? WHERE spotify_user_id = ?',
        )
          .bind(sealed, Date.now(), this.ownerId)
          .run()
      },
    )
  }
}
