/**
 * Camp Playlist Sorter — Worker.
 *
 * Serves the built SPA and an /api surface for shared plans:
 *
 *   Owner (has Spotify)          Collaborator (has a link)
 *   ─────────────────────        ────────────────────────────
 *   GET  /api/auth/login         POST /api/join/:token   {name}
 *   GET  /api/auth/callback      GET  /api/session
 *   POST /api/plans              GET  /api/plans/:id/socket
 *   POST /api/plans/:id/links
 *   ...
 *
 * Everything a collaborator can reach is authorised from a session cookie
 * that was issued by redeeming a share link. Share tokens themselves are
 * only ever exchanged for a session — they are not accepted as credentials
 * on ordinary requests, so they cannot leak through a Referer header.
 */

import type { Plan } from '../src/lib/types.ts'
import type { Role } from '../src/lib/protocol.ts'
import { randomToken, sha256Hex } from './crypto.ts'
import { exchangeCode, OwnerSpotify, sealRefreshToken, SpotifyError } from './spotify.ts'
import { canReorderPlaylist } from './playlistAccess.ts'
import { mountPath, mountedUrl, stripMount } from './basePath.ts'
import type { Env } from './env.ts'

export { PlanRoom } from './PlanRoom.ts'

const SESSION_COOKIE = 'cps_session'
const OAUTH_STATE_COOKIE = 'cps_oauth_state'
const SESSION_MAX_AGE = 60 * 60 * 24 * 365 // a year; this is a year-long project

const SCOPES = [
  'user-read-private',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ')

type Session = {
  collaboratorId: string
  planId: string
  displayName: string
  role: Role
}

// --- small helpers ----------------------------------------------------

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

function fail(message: string, status = 400): Response {
  return json({ error: message }, { status })
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function setCookie(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
  mount = '/',
): string {
  // HttpOnly so no script can read it; SameSite=Lax so it survives the
  // Spotify redirect back but is not sent on cross-site POSTs.
  //
  // Path is scoped to the mount so that when the app lives at
  // bmxc.camp/playlist-builder these cookies are not attached to every
  // request for the marketing site sharing the origin.
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${mount === '/' ? '/' : mount}`,
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join('; ')
}

function isSecure(url: URL): boolean {
  return url.protocol === 'https:'
}

/** Resolve the session cookie to a collaborator row. */
async function currentSession(request: Request, env: Env): Promise<Session | null> {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return null
  const hash = await sha256Hex(token)
  const row = await env.DB.prepare(
    'SELECT id, plan_id, display_name, role FROM collaborators WHERE session_hash = ?',
  )
    .bind(hash)
    .first<{ id: string; plan_id: string; display_name: string; role: Role }>()
  if (!row) return null

  // Best-effort liveness stamp; not worth failing a request over.
  await env.DB.prepare('UPDATE collaborators SET last_seen_at = ? WHERE id = ?')
    .bind(Date.now(), row.id)
    .run()
    .catch(() => {})

  return {
    collaboratorId: row.id,
    planId: row.plan_id,
    displayName: row.display_name,
    role: row.role,
  }
}

function emptyPlan(id: string, name: string): Plan {
  return {
    version: 1,
    id,
    name,
    days: [],
    blocks: [],
    tracks: {},
    sources: [],
    trackOrder: [],
    sections: [
      { id: 'sec_run', name: 'Run', color: '#ef4444' },
      { id: 'sec_lake', name: 'Lake', color: '#0ea5e9' },
      { id: 'sec_vibes', name: 'Vibes', color: '#a855f7' },
      { id: 'sec_feels', name: 'Feels', color: '#f59e0b' },
    ],
    updatedAt: Date.now(),
  }
}

// --- routes -----------------------------------------------------------

/** Start the owner's Spotify sign-in. */
function authLogin(env: Env, url: URL, mount: string): Response {
  const state = randomToken(24)
  // Built from the mount, not the origin: at bmxc.camp/playlist-builder the
  // callback Spotify sends the browser back to must carry the prefix, and it
  // has to match the URI registered in the Spotify dashboard byte for byte.
  const redirectUri = mountedUrl(url, '/api/auth/callback', mount)
  const authorize = new URL('https://accounts.spotify.com/authorize')
  authorize.searchParams.set('client_id', env.SPOTIFY_CLIENT_ID)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('redirect_uri', redirectUri)
  authorize.searchParams.set('scope', SCOPES)
  authorize.searchParams.set('state', state)

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      'Set-Cookie': setCookie(OAUTH_STATE_COOKIE, state, 600, isSecure(url), mount),
    },
  })
}

/**
 * Finish sign-in: exchange the code server-side, store the encrypted
 * refresh token, and give the owner a session for their plan.
 */
async function authCallback(
  request: Request,
  env: Env,
  url: URL,
  mount: string,
): Promise<Response> {
  // Spotify reports a refusal by redirecting back with ?error=... Carry both
  // the code and its description to the app; dropping them left the user on
  // the calendar with no idea what went wrong.
  const error = url.searchParams.get('error')
  if (error) {
    const detail = url.searchParams.get('error_description') ?? ''
    const params = new URLSearchParams({ auth_error: error })
    if (detail) params.set('auth_error_detail', detail)
    return Response.redirect(`${mountedUrl(url, '/', mount)}?${params}`, 302)
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expected = readCookie(request, OAUTH_STATE_COOKIE)
  const bounce = (message: string) =>
    Response.redirect(
      `${mountedUrl(url, '/', mount)}?${new URLSearchParams({ auth_error: 'sign_in_failed', auth_error_detail: message })}`,
      302,
    )

  if (!code) return bounce('Spotify did not return an authorization code.')
  if (!state || !expected || state !== expected) {
    return bounce(
      'The sign-in could not be verified. This usually means the browser blocked the sign-in cookie — try again without private browsing.',
    )
  }

  let tokens
  try {
    tokens = await exchangeCode({
      code,
      redirectUri: mountedUrl(url, '/api/auth/callback', mount),
      clientId: env.SPOTIFY_CLIENT_ID,
      clientSecret: env.SPOTIFY_CLIENT_SECRET,
    })
  } catch (err) {
    return bounce((err as Error).message)
  }

  const client = new OwnerSpotify(
    tokens.refreshToken,
    env.SPOTIFY_CLIENT_ID,
    env.SPOTIFY_CLIENT_SECRET,
  )
  // In Development mode Spotify refuses /me for accounts not listed under
  // User Management, which would otherwise surface as an unhandled 500.
  let me
  try {
    me = await client.me()
  } catch (err) {
    return bounce(
      `${(err as Error).message} If this app is still in Development mode on Spotify, add this account under User Management in the Spotify dashboard.`,
    )
  }

  const now = Date.now()
  const sealed = await sealRefreshToken(tokens.refreshToken, env.ENCRYPTION_KEY)
  await env.DB.prepare(
    `INSERT INTO owners (spotify_user_id, display_name, refresh_token_enc, scopes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(spotify_user_id) DO UPDATE SET
       display_name = excluded.display_name,
       refresh_token_enc = excluded.refresh_token_enc,
       scopes = excluded.scopes,
       updated_at = excluded.updated_at`,
  )
    .bind(me.id, me.display_name ?? me.id, sealed, tokens.scopes, now, now)
    .run()

  // Reuse the owner's existing plan when they sign in again.
  let plan = await env.DB.prepare(
    'SELECT id FROM plans WHERE owner_id = ? ORDER BY created_at LIMIT 1',
  )
    .bind(me.id)
    .first<{ id: string }>()

  if (!plan) {
    const planId = `plan_${randomToken(12)}`
    const doc = emptyPlan(planId, 'Camp Week 1')
    await env.DB.prepare(
      'INSERT INTO plans (id, owner_id, name, doc, rev, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    )
      .bind(planId, me.id, doc.name, JSON.stringify(doc), now, now)
      .run()
    plan = { id: planId }
  }

  const sessionToken = randomToken(32)
  await env.DB.prepare(
    `INSERT INTO collaborators (id, plan_id, display_name, role, session_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, 'owner', ?, ?, ?)`,
  )
    .bind(
      `col_${randomToken(12)}`,
      plan.id,
      me.display_name ?? me.id,
      await sha256Hex(sessionToken),
      now,
      now,
    )
    .run()

  return new Response(null, {
    status: 302,
    headers: {
      Location: mountedUrl(url, '/', mount),
      'Set-Cookie': setCookie(SESSION_COOKIE, sessionToken, SESSION_MAX_AGE, isSecure(url), mount),
    },
  })
}

/** Redeem a share link for a session. */
async function join(
  request: Request,
  env: Env,
  url: URL,
  token: string,
  mount: string,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { name?: string }
  const name = (body.name ?? '').trim().slice(0, 60)
  if (!name) return fail('Please enter a name so others know who is editing.', 400)

  const link = await env.DB.prepare(
    'SELECT plan_id, role FROM share_links WHERE token = ?',
  )
    .bind(token)
    .first<{ plan_id: string; role: Role }>()
  if (!link) return fail('That invite link is no longer valid.', 404)

  const sessionToken = randomToken(32)
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO collaborators (id, plan_id, display_name, role, session_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `col_${randomToken(12)}`,
      link.plan_id,
      name,
      link.role,
      await sha256Hex(sessionToken),
      now,
      now,
    )
    .run()

  return json(
    { planId: link.plan_id, role: link.role, displayName: name },
    { headers: { 'Set-Cookie': setCookie(SESSION_COOKIE, sessionToken, SESSION_MAX_AGE, isSecure(url), mount) } },
  )
}

/** Create or rotate a share link. Owner only. */
async function createLink(env: Env, session: Session, role: Role): Promise<Response> {
  if (session.role !== 'owner') return fail('Only the plan owner can create invite links.', 403)
  if (role !== 'editor' && role !== 'viewer') return fail('Unknown link type.', 400)

  // Rotating means the old URL stops working, which is the point.
  await env.DB.prepare('DELETE FROM share_links WHERE plan_id = ? AND role = ?')
    .bind(session.planId, role)
    .run()

  const token = randomToken(20)
  await env.DB.prepare(
    'INSERT INTO share_links (token, plan_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(token, session.planId, role, Date.now())
    .run()

  return json({ token, role })
}

async function listLinks(env: Env, session: Session): Promise<Response> {
  if (session.role !== 'owner') return fail('Only the plan owner can see invite links.', 403)
  const links = await env.DB.prepare(
    'SELECT token, role FROM share_links WHERE plan_id = ?',
  )
    .bind(session.planId)
    .all<{ token: string; role: Role }>()

  const people = await env.DB.prepare(
    'SELECT id, display_name, role, last_seen_at FROM collaborators WHERE plan_id = ? ORDER BY created_at',
  )
    .bind(session.planId)
    .all<{ id: string; display_name: string; role: Role; last_seen_at: number }>()

  return json({ links: links.results ?? [], collaborators: people.results ?? [] })
}

async function removeCollaborator(env: Env, session: Session, id: string): Promise<Response> {
  if (session.role !== 'owner') return fail('Only the plan owner can remove people.', 403)
  if (id === session.collaboratorId) return fail('You cannot remove yourself.', 400)
  await env.DB.prepare('DELETE FROM collaborators WHERE id = ? AND plan_id = ? AND role != ?')
    .bind(id, session.planId, 'owner')
    .run()
  return json({ ok: true })
}

/** Point this plan's sync at a Spotify playlist. Owner only. */
async function setPlaylist(request: Request, env: Env, session: Session): Promise<Response> {
  if (session.role !== 'owner') return fail('Only the plan owner can choose the playlist.', 403)
  const body = (await request.json().catch(() => ({}))) as { playlistId?: string | null }
  const playlistId = body.playlistId?.trim() || null

  if (playlistId) {
    const owner = await env.DB.prepare(
      'SELECT owner_id FROM plans WHERE id = ?',
    )
      .bind(session.planId)
      .first<{ owner_id: string }>()
    const row = await env.DB.prepare(
      'SELECT refresh_token_enc FROM owners WHERE spotify_user_id = ?',
    )
      .bind(owner?.owner_id ?? '')
      .first<{ refresh_token_enc: string }>()
    if (!row) return fail('Connect Spotify first.', 400)

    // Fail now, with a clear reason, rather than at the first silent sync.
    try {
      const client = await OwnerSpotify.fromEncrypted(
        row.refresh_token_enc,
        env.ENCRYPTION_KEY,
        env.SPOTIFY_CLIENT_ID,
        env.SPOTIFY_CLIENT_SECRET,
      )
      const meta = await client.playlist(playlistId)

      if (!canReorderPlaylist(meta, owner?.owner_id)) {
        return fail(
          'The connected Spotify account cannot edit that playlist. Reordering needs a playlist that account owns, or a collaborative one it has been added to.',
          403,
        )
      }
    } catch (err) {
      const e = err as SpotifyError
      console.log(
        `setPlaylist rejected: plan=${session.planId} playlist=${playlistId} ` +
          `status=${e.status ?? '?'} message=${e.message}`,
      )
      return fail(
        `Could not turn on Spotify sync for that playlist: ${e.message}`,
        e.status === 404 ? 404 : 400,
      )
    }
  }

  console.log(`setPlaylist ok: plan=${session.planId} playlist=${playlistId}`)

  await env.DB.prepare('UPDATE plans SET spotify_playlist_id = ?, updated_at = ? WHERE id = ?')
    .bind(playlistId, Date.now(), session.planId)
    .run()

  // Tell the live room, which cached the old value when it loaded.
  try {
    const room = env.PLAN_ROOM.get(env.PLAN_ROOM.idFromName(session.planId))
    const notify = new URL(request.url)
    notify.searchParams.set('plan', session.planId)
    notify.searchParams.set('event', 'playlist-changed')
    if (playlistId) notify.searchParams.set('playlistId', playlistId)
    else notify.searchParams.delete('playlistId')
    await room.fetch(new Request(notify.toString()))
  } catch (err) {
    // The plan is saved either way; the room picks it up on next start.
    console.log(`setPlaylist: could not notify room — ${(err as Error).message}`)
  }

  return json({ playlistId })
}

/**
 * Every plan this session's owner has.
 *
 * A collaborator only ever sees the one plan their link was for, so this
 * is owner-only: listing an owner's other plans to someone holding a share
 * link would leak playlists they were never invited to.
 */
async function listPlans(env: Env, session: Session): Promise<Response> {
  if (session.role !== 'owner') return fail('Only the plan owner can see other playlists.', 403)

  const owner = await env.DB.prepare('SELECT owner_id FROM plans WHERE id = ?')
    .bind(session.planId)
    .first<{ owner_id: string }>()
  if (!owner) return fail('Plan not found.', 404)

  const rows = await env.DB.prepare(
    'SELECT id, name, spotify_playlist_id, updated_at FROM plans WHERE owner_id = ? ORDER BY created_at',
  )
    .bind(owner.owner_id)
    .all<{ id: string; name: string; spotify_playlist_id: string | null; updated_at: number }>()

  return json({ plans: rows.results ?? [], activePlanId: session.planId })
}

/** Start another plan for the same owner, and switch this session to it. */
async function createPlan(
  request: Request,
  env: Env,
  session: Session,
  url: URL,
  mount: string,
): Promise<Response> {
  if (session.role !== 'owner') return fail('Only the plan owner can start another playlist.', 403)

  const body = (await request.json().catch(() => ({}))) as {
    name?: string
    spotifyPlaylistId?: string
  }
  const name = (body.name ?? '').trim().slice(0, 100) || 'New playlist'
  const spotifyPlaylistId = body.spotifyPlaylistId?.trim() || null

  const owner = await env.DB.prepare('SELECT owner_id FROM plans WHERE id = ?')
    .bind(session.planId)
    .first<{ owner_id: string }>()
  if (!owner) return fail('Plan not found.', 404)

  const now = Date.now()
  const planId = `plan_${randomToken(12)}`
  const doc = emptyPlan(planId, name)
  await env.DB.prepare(
    `INSERT INTO plans (id, owner_id, name, doc, rev, spotify_playlist_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(planId, owner.owner_id, name, JSON.stringify(doc), spotifyPlaylistId, now, now)
    .run()

  return switchTo(env, session, planId, url, mount, owner.owner_id)
}

/**
 * Point this session at another of the owner's plans.
 *
 * A session is bound to one plan, so switching means issuing a new session
 * for the target. The old collaborator row is dropped rather than left
 * behind as a stale grant.
 */
async function switchTo(
  env: Env,
  session: Session,
  planId: string,
  url: URL,
  mount: string,
  knownOwnerId?: string,
): Promise<Response> {
  if (session.role !== 'owner') return fail('Only the plan owner can switch playlists.', 403)

  const ownerId =
    knownOwnerId ??
    (
      await env.DB.prepare('SELECT owner_id FROM plans WHERE id = ?')
        .bind(session.planId)
        .first<{ owner_id: string }>()
    )?.owner_id

  const target = await env.DB.prepare('SELECT id, owner_id, name FROM plans WHERE id = ?')
    .bind(planId)
    .first<{ id: string; owner_id: string; name: string }>()

  // Only ever switch between plans the same account owns.
  if (!target || !ownerId || target.owner_id !== ownerId) {
    return fail('That playlist does not belong to this account.', 403)
  }

  const now = Date.now()
  const sessionToken = randomToken(32)
  await env.DB.prepare(
    `INSERT INTO collaborators (id, plan_id, display_name, role, session_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, 'owner', ?, ?, ?)`,
  )
    .bind(`col_${randomToken(12)}`, planId, session.displayName, await sha256Hex(sessionToken), now, now)
    .run()

  await env.DB.prepare('DELETE FROM collaborators WHERE id = ?').bind(session.collaboratorId).run()

  return json(
    { planId, name: target.name },
    { headers: { 'Set-Cookie': setCookie(SESSION_COOKIE, sessionToken, SESSION_MAX_AGE, isSecure(url), mount) } },
  )
}

// --- entrypoint --------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const mount = mountPath(env)

    // Everything below is written as if the app owned the origin. When it is
    // mounted at a subpath, drop the prefix here — once — rather than
    // threading it through every route comparison.
    const url = stripMount(new URL(request.url), mount)
    const path = url.pathname

    if (!path.startsWith('/api/')) {
      // The asset store is keyed by path *relative to dist/* — the mount
      // prefix is not part of the key even though Vite baked it into the
      // asset URLs. Serving the request unchanged makes
      // /playlist-builder/assets/x.js miss and fall through to the SPA
      // fallback, which returns index.html as text/html and leaves the app
      // blank. Ask for the stripped path instead.
      return env.ASSETS.fetch(new Request(url.toString(), request))
    }

    // --- unauthenticated -------------------------------------------
    if (path === '/api/auth/login') return authLogin(env, url, mount)
    if (path === '/api/auth/callback') return authCallback(request, env, url, mount)

    const joinMatch = path.match(/^\/api\/join\/([A-Za-z0-9]+)$/)
    if (joinMatch && request.method === 'POST') {
      return join(request, env, url, joinMatch[1], mount)
    }

    // --- everything below needs a session ---------------------------
    const session = await currentSession(request, env)

    // Asking who you are is not an error when the answer is "nobody" — the
    // local-only app probes this on every load.
    if (path === '/api/session' && !session) return json({ session: null })

    if (!session) return fail('Not signed in.', 401)

    if (path === '/api/session') {
      const plan = await env.DB.prepare(
        'SELECT name, spotify_playlist_id FROM plans WHERE id = ?',
      )
        .bind(session.planId)
        .first<{ name: string; spotify_playlist_id: string | null }>()
      return json({
        collaboratorId: session.collaboratorId,
        planId: session.planId,
        displayName: session.displayName,
        role: session.role,
        planName: plan?.name ?? '',
        spotifyPlaylistId: plan?.spotify_playlist_id ?? null,
      })
    }

    if (path === '/api/plans') {
      if (request.method === 'GET') return listPlans(env, session)
      if (request.method === 'POST') return createPlan(request, env, session, url, mount)
    }

    const switchMatch = path.match(/^\/api\/plans\/([A-Za-z0-9_]+)\/open$/)
    if (switchMatch && request.method === 'POST') {
      return switchTo(env, session, switchMatch[1], url, mount)
    }

    if (path === '/api/links') {
      if (request.method === 'GET') return listLinks(env, session)
      if (request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { role?: Role }
        return createLink(env, session, body.role ?? 'editor')
      }
    }

    const removeMatch = path.match(/^\/api\/collaborators\/([A-Za-z0-9_]+)$/)
    if (removeMatch && request.method === 'DELETE') {
      return removeCollaborator(env, session, removeMatch[1])
    }

    if (path === '/api/playlist' && request.method === 'PUT') {
      return setPlaylist(request, env, session)
    }

    if (path === '/api/socket') {
      // The room trusts these parameters, so they come from the session and
      // never from the query string the client sent.
      const id = env.PLAN_ROOM.idFromName(session.planId)
      const room = env.PLAN_ROOM.get(id)
      // Built from the stripped URL so the room sees `/api/socket`
      // regardless of where the app is mounted.
      const forward = new URL(url.toString())
      forward.searchParams.set('plan', session.planId)
      forward.searchParams.set('cid', session.collaboratorId)
      forward.searchParams.set('name', session.displayName)
      forward.searchParams.set('role', session.role)
      return room.fetch(new Request(forward.toString(), request))
    }

    return fail('Unknown endpoint.', 404)
  },
}
