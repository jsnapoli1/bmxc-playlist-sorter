import { useMemo, useState } from 'react'
import { useStore } from '../lib/store.tsx'
import { useSpotify } from '../spotify/SpotifyProvider.tsx'
import { getPlaylist, getPlaylistTracks, type SpotifyPlaylist } from '../spotify/api.ts'
import SpotifySetup from './SpotifySetup.tsx'
import { sourceOf } from '../lib/planMigration.ts'
import ScopeNotice from './ScopeNotice.tsx'

/** Accepts a playlist id, a spotify: URI, or an open.spotify.com link. */
export function parsePlaylistRef(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  const uri = s.match(/^spotify:playlist:([A-Za-z0-9]+)/)
  if (uri) return uri[1]
  const url = s.match(/open\.spotify\.com\/(?:[a-z-]+\/)?playlist\/([A-Za-z0-9]+)/)
  if (url) return url[1]
  if (/^[A-Za-z0-9]{16,}$/.test(s)) return s
  return null
}

export default function SpotifyImportModal({
  onClose,
  isShared = false,
}: {
  onClose: () => void
  /** True when this plan lives on the server and can sync to Spotify. */
  isShared?: boolean
}) {
  const { plan, dispatch } = useStore()
  const current = sourceOf(plan)
  const {
    status,
    user,
    playlists,
    playlistsLoading,
    refreshPlaylists,
    error: connectionError,
  } = useSpotify()
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return playlists.filter((p) => (!q ? true : `${p.name} ${p.owner}`.toLowerCase().includes(q)))
  }, [playlists, query])

  const importPlaylist = async (playlist: SpotifyPlaylist) => {
    setBusy(playlist.id)
    setError(null)
    setDone(null)
    try {
      const tracks = await getPlaylistTracks(playlist.id, (loaded, total) =>
        setProgress(`Loading ${loaded} of ${total} songs…`),
      )

      // Since February 2026 Spotify returns the songs of your own playlists
      // only; someone else's comes back as metadata with no contents.
      if (!tracks.length) {
        const mine = user && playlist.ownerId === user.id
        setError(
          mine
            ? `“${playlist.name}” came back empty — it may have no songs in it.`
            : `Spotify only returns the songs of playlists you own. “${playlist.name}” belongs to ${playlist.owner}, so its songs can't be read. Save a copy to your own account in Spotify, then import that copy.`,
        )
        return
      }

      const source = {
        id: playlist.id,
        name: playlist.name,
        owner: playlist.owner,
        image: playlist.image,
        trackCount: tracks.length,
        importedAt: Date.now(),
      }

      /**
       * Point the server's Spotify sync at the playlist just imported.
       *
       * Without this the plan has the songs but no idea where to write
       * them back, and the only way to say so was to paste the same
       * playlist link a second time under Settings.
       */
      const setSyncTarget = async () => {
        if (!isShared) return
        try {
          const res = await fetch('/api/playlist', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playlistId: playlist.id }),
          })
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            // Not fatal: the songs imported fine, only the write-back
            // could not be armed. Say so rather than failing silently.
            setSyncNote(
              body.error ??
                'The songs imported, but Spotify sync could not be turned on for this playlist.',
            )
          }
        } catch {
          setSyncNote('The songs imported, but Spotify sync could not be turned on right now.')
        }
      }

      if (!current) {
        // Nothing imported yet — fill this plan rather than leaving an
        // empty one behind.
        dispatch({ type: 'addTracks', tracks })
        dispatch({ type: 'addSource', source })
        dispatch({ type: 'renamePlan', id: plan.id, name: playlist.name })
        await setSyncTarget()
        setDone(`Imported ${tracks.length} songs from “${playlist.name}”.`)
      } else if (playlist.id === current.id) {
        // Re-importing the same playlist refreshes it in place: sections
        // and schedule placements survive, and songs deleted in Spotify
        // since the last import are dropped from the library.
        const before = Object.values(plan.tracks).filter((t) => t.sourceId === playlist.id).length
        dispatch({ type: 'syncTracks', tracks, sourceId: playlist.id })
        dispatch({ type: 'addSource', source })
        await setSyncTarget()
        const removed = Math.max(0, before - tracks.length)
        setDone(
          `Refreshed “${playlist.name}” — ${tracks.length} songs` +
            (removed ? `, ${removed} no longer in the playlist removed.` : '.'),
        )
      } else if (isShared) {
        // On a shared account a plan lives on the server, so ask it to
        // make one for this playlist and switch to it. The reload picks
        // up the new session; the songs import into it on the way.
        const res = await fetch('/api/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: playlist.name, spotifyPlaylistId: playlist.id }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? 'Could not open that playlist as its own plan.')
        }
        setDone(`Opening “${playlist.name}”…`)
        window.location.reload()
        return
      } else {
        // A different playlist gets its own plan, with its own sections
        // and schedule, and becomes the active one.
        dispatch({ type: 'createPlanFromPlaylist', source, tracks })
        setDone(`Opened “${playlist.name}” with ${tracks.length} songs.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  const importManual = async () => {
    const id = parsePlaylistRef(manual)
    if (!id) {
      setError('That does not look like a Spotify playlist link or ID.')
      return
    }
    setBusy(id)
    setError(null)
    try {
      const playlist = await getPlaylist(id)
      await importPlaylist(playlist)
      setManual('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 className="grow">{current ? 'Choose a playlist' : 'Import songs from Spotify'}</h2>
          <button className="btn ghost" onClick={onClose}>
            ×
          </button>
        </div>

        {status !== 'connected' ? (
          <SpotifySetup />
        ) : (
          <>
            <ScopeNotice />
            {/* Errors from loading the playlist list live on the provider;
                without this they failed silently behind an empty grid. */}
            {(error || connectionError) && (
              <div className="banner error tiny">{error || connectionError}</div>
            )}
            {done && <div className="banner ok tiny">{done}</div>}
            {syncNote && <div className="banner error tiny">{syncNote}</div>}

            <div className="row" style={{ marginBottom: 10 }}>
              <input
                type="search"
                placeholder="Filter your playlists…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="btn sm" onClick={() => void refreshPlaylists()} disabled={playlistsLoading}>
                {playlistsLoading ? '…' : 'Refresh'}
              </button>
            </div>

            {current && (
              <div className="banner tiny" style={{ marginBottom: 10 }}>
                This plan is for <strong>{current.name}</strong>. Picking a different
                playlist opens it as its own plan, with its own sections and schedule —
                this one stays exactly as you left it.
              </div>
            )}

            <div className="playlist-grid">
              {filtered.map((p) => (
                <button
                  className="playlist-card"
                  key={p.id}
                  disabled={busy !== null}
                  onClick={() => void importPlaylist(p)}
                >
                  {p.image ? <img className="art" src={p.image} alt="" /> : <div className="art">♪</div>}
                  <div className="track-meta">
                    <div className="track-name truncate">{p.name}</div>
                    <div className="track-sub truncate">
                      {busy === p.id ? progress || 'Loading…' : `${p.trackCount} songs · ${p.owner}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {!playlistsLoading && !filtered.length && (
              <div className="empty-state">No playlists matched.</div>
            )}

            <div className="section-label">Or paste a playlist link</div>
            <div className="row">
              <input
                type="text"
                placeholder="https://open.spotify.com/playlist/…"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void importManual()}
              />
              <button className="btn" onClick={() => void importManual()} disabled={busy !== null}>
                Add
              </button>
            </div>
            <div className="hint">
              Works for any playlist you can open in Spotify, including collaborative camp
              playlists shared with you.
            </div>
          </>
        )}

        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
