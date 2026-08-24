import { useCallback, useEffect, useState } from 'react'
import type { Role } from '../lib/protocol.ts'
import { appUrl } from '../lib/basePath.ts'

type Link = { token: string; role: Role }
type Collaborator = { id: string; display_name: string; role: Role; last_seen_at: number }

type SessionInfo = {
  collaboratorId: string
  planId: string
  displayName: string
  role: Role
  planName: string
  spotifyPlaylistId: string | null
}

function linkUrl(token: string): string {
  return `${window.location.origin}${appUrl(`join/${token}`)}`
}

function relativeTime(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return `${Math.round(hours / 24)} days ago`
}

function LinkRow({
  label,
  hint,
  link,
  onCreate,
  busy,
}: {
  label: string
  hint: string
  link: Link | undefined
  onCreate: () => void
  busy: boolean
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(linkUrl(link.token))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be blocked; the input below is selectable as a fallback.
    }
  }

  return (
    <div className="share-link">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{label}</strong>
        <button className="btn sm" onClick={onCreate} disabled={busy}>
          {link ? 'Rotate' : 'Create'}
        </button>
      </div>
      <div className="tiny faint">{hint}</div>
      {link ? (
        <div className="row" style={{ gap: 6 }}>
          <input readOnly value={linkUrl(link.token)} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : (
        <div className="tiny faint">No link yet.</div>
      )}
    </div>
  )
}

/**
 * Owner-facing sharing controls: the two invite links, who has joined, and
 * which Spotify playlist the master order is kept in step with.
 */
export default function SharePanel({ session }: { session: SessionInfo }) {
  const [links, setLinks] = useState<Link[]>([])
  const [people, setPeople] = useState<Collaborator[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playlistId, setPlaylistId] = useState(session.spotifyPlaylistId ?? '')
  const [playlistNote, setPlaylistNote] = useState<string | null>(null)

  const isOwner = session.role === 'owner'

  const load = useCallback(async () => {
    if (!isOwner) return
    try {
      const res = await fetch(appUrl('api/links'))
      const data = (await res.json()) as {
        links?: Link[]
        collaborators?: Collaborator[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Could not load sharing settings.')
      setLinks(data.links ?? [])
      setPeople(data.collaborators ?? [])
    } catch (err) {
      setError((err as Error).message)
    }
  }, [isOwner])

  useEffect(() => {
    void load()
  }, [load])

  const createLink = async (role: Role) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(appUrl('api/links'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Could not create the link.')
      }
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await fetch(appUrl(`api/collaborators/${id}`), { method: 'DELETE' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const savePlaylist = async () => {
    setBusy(true)
    setError(null)
    setPlaylistNote(null)
    try {
      // Accept a full Spotify URL as well as a bare id — pasting the link
      // straight from the app is the obvious thing to do.
      const id = playlistId.trim().match(/playlist[/:]([A-Za-z0-9]+)/)?.[1] ?? playlistId.trim()
      const res = await fetch(appUrl('api/playlist'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId: id || null }),
      })
      const data = (await res.json()) as { error?: string; playlistId?: string | null }
      if (!res.ok) throw new Error(data.error ?? 'Could not set the playlist.')
      setPlaylistId(data.playlistId ?? '')
      setPlaylistNote(
        data.playlistId
          ? 'Saved. Changes to the master playlist order will sync to Spotify.'
          : 'Spotify sync is off for this plan.',
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!isOwner) {
    return (
      <section className="card">
        <h3>Sharing</h3>
        <p className="tiny faint">
          You joined <strong>{session.planName || 'this playlist'}</strong> as{' '}
          <strong>{session.displayName}</strong> (
          {session.role === 'editor' ? 'can edit' : 'view only'}). Your link is for this
          playlist only. Only the owner can manage invite links.
        </p>
      </section>
    )
  }

  const editor = links.find((l) => l.role === 'editor')
  const viewer = links.find((l) => l.role === 'viewer')

  return (
    <section className="card">
      <h3>Sharing “{session.planName || 'this playlist'}”</h3>
      <p className="tiny faint">
        These links are for <strong>{session.planName || 'this playlist'}</strong> only —
        each playlist has its own, and someone who joins one cannot see the others. Anyone
        with a link can open it without a Spotify account. Treat the editor link like a
        password: it lets someone change the plan and the real Spotify playlist.
      </p>

      {error && <div className="notice error">{error}</div>}

      <LinkRow
        label="Editor link"
        hint="Can reorder the playlist, edit sections, and assign songs. Their changes sync to Spotify."
        link={editor}
        busy={busy}
        onCreate={() => void createLink('editor')}
      />
      <LinkRow
        label="View-only link"
        hint="Can see the plan and the run sheet, but cannot change anything."
        link={viewer}
        busy={busy}
        onCreate={() => void createLink('viewer')}
      />

      <h4>Who has access to this playlist</h4>
      <div className="people">
        {people.map((p) => (
          <div className="row person" key={p.id}>
            <span className="dot" style={{ background: 'var(--accent)' }} />
            <span className="grow truncate">
              {p.display_name}
              <span className="tiny faint">
                {' '}
                · {p.role === 'owner' ? 'owner' : p.role} · seen {relativeTime(p.last_seen_at)}
              </span>
            </span>
            {p.role !== 'owner' && (
              <button className="btn sm ghost" onClick={() => void remove(p.id)} disabled={busy}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <h4>Spotify playlist</h4>
      <p className="tiny faint">
        {session.spotifyPlaylistId
          ? 'The master playlist order is written back to this playlist, a few seconds after edits settle.'
          : 'Set automatically when you import a playlist — import one and this fills itself in. You can also paste a link here.'}{' '}
        It must be owned by the connected Spotify account: Spotify does not allow reordering
        anyone else's playlist. Sections are an idea in this app only; Spotify receives the
        flattened order.
      </p>
      <div className="row" style={{ gap: 6 }}>
        <input
          placeholder="Spotify playlist link or id"
          value={playlistId}
          onChange={(e) => setPlaylistId(e.target.value)}
        />
        <button className="btn sm" onClick={() => void savePlaylist()} disabled={busy}>
          Save
        </button>
      </div>
      {playlistNote && <div className="tiny faint">{playlistNote}</div>}
    </section>
  )
}
