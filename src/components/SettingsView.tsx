import { useRef, useState } from 'react'
import { useStore } from '../lib/store.tsx'
import { useSpotify } from '../spotify/SpotifyProvider.tsx'
import SharePanel from './SharePanel.tsx'
import type { SessionInfo } from '../Root.tsx'
import { planLabel, sourceOf } from '../lib/planMigration.ts'
import type { AuthError } from '../lib/authError.ts'
import SpotifySetup from './SpotifySetup.tsx'
import SpotifyDiagnostics from './SpotifyDiagnostics.tsx'
import ScopeNotice from './ScopeNotice.tsx'
import { createPlaylistWithTracks } from '../spotify/api.ts'
import { minutesOf } from '../lib/time.ts'
import { loadToken } from '../spotify/auth.ts'
import { appUrl } from '../lib/basePath.ts'

export default function SettingsView({
  session,
  authError,
}: {
  session: SessionInfo | null
  authError?: AuthError | null
}) {
  const { state, plan, dispatch, exportJson, importJson } = useStore()
  const { status, user, disconnect, redirectUri, error: connectionError, profileNote } = useSpotify()
  // A rejected account still has a token; without this the panel below would
  // send them back to the connect button in a loop instead of explaining.
  const hasToken = Boolean(loadToken())
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `camp-playlist-plan-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      importJson(await file.text())
      setMessage({ kind: 'ok', text: 'Backup restored.' })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const exportDayPlaylists = async () => {
    setBusy(true)
    setMessage(null)
    try {
      let made = 0
      for (const day of plan.days) {
        const uris = plan.blocks
          .filter((b) => b.dayId === day.id)
          .sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
          .flatMap((b) => b.entries.map((e) => plan.tracks[e.trackId]?.uri))
          .filter((uri): uri is string => Boolean(uri) && uri.startsWith('spotify:track:'))
        if (!uris.length) continue
        await createPlaylistWithTracks({
          name: `${plan.name} · ${day.label}`,
          description: `Camp music plan for ${day.label}, in schedule order.`,
          uris,
        })
        made += 1
      }
      setMessage({
        kind: made ? 'ok' : 'error',
        text: made ? `Created ${made} playlist${made === 1 ? '' : 's'} in Spotify.` : 'No Spotify songs were placed yet.',
      })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-inner">
        {message && <div className={`banner ${message.kind === 'ok' ? 'ok' : 'error'}`}>{message.text}</div>}

        {session && <SharePanel session={session} />}

        {!session && (
          <div className="card">
            <h3>Share this plan</h3>
            {authError && (
              <div className="notice error" style={{ marginBottom: 10 }}>
                <strong>Spotify did not complete the sign-in.</strong>
                <div className="tiny" style={{ marginTop: 4 }}>{authError.advice}</div>
                <div className="tiny faint" style={{ marginTop: 6 }}>
                  Spotify said: {authError.code}
                  {authError.detail ? ` — ${authError.detail}` : ''}
                </div>
              </div>
            )}
            <p className="tiny faint">
              Sign in with the camp's Spotify account to put this plan online. Everyone else
              gets an invite link and edits alongside you — no Spotify account needed on
              their side. Your plan stays in this browser until you do.
            </p>
            <a className="btn primary" href={appUrl('api/auth/login')}>
              Sign in with Spotify to share
            </a>
          </div>
        )}

        {!session && (
        <div className="card">
          <h3>Spotify</h3>
          {status === 'connected' ? (
            <>
              <ScopeNotice />
              <div className="row" style={{ marginTop: 10 }}>
                {user?.image ? <img className="art" src={user.image} alt="" /> : <div className="art">♪</div>}
                <div className="grow">
                  <div className="track-name">{user?.displayName ?? 'Spotify account'}</div>
                  <div className="track-sub">{profileNote ? 'Connected — profile unavailable' : 'Connected'}</div>
                </div>
                <button className="btn" onClick={disconnect}>
                  Disconnect
                </button>
              </div>
              <div className="section-label">Export the whole plan back to Spotify</div>
              <p className="tiny muted" style={{ marginTop: 0 }}>
                Creates one private playlist per day, with songs in schedule order. Notes stay here —
                Spotify has nowhere to put them.
              </p>
              <button className="btn" onClick={() => void exportDayPlaylists()} disabled={busy}>
                {busy ? 'Creating…' : 'Create one playlist per day'}
              </button>
              <div className="hint" style={{ marginTop: 12 }}>
                Redirect URI for this install: <code className="inline">{redirectUri}</code>
              </div>
              <SpotifyDiagnostics />
            </>
          ) : hasToken ? (
            <>
              <div className="banner error tiny">
                Signed in to Spotify, but it is refusing requests.
                {connectionError ? ` ${connectionError}` : ''}
              </div>
              <div className="row wrap">
                <button className="btn" onClick={disconnect}>
                  Disconnect and start over
                </button>
              </div>
              <div className="hint" style={{ marginTop: 12 }}>
                Redirect URI for this install: <code className="inline">{redirectUri}</code>
              </div>
              <SpotifyDiagnostics />
            </>
          ) : (
            <SpotifySetup />
          )}
        </div>
        )}

        <div className="card">
          <h3>Playlists</h3>
          <p className="tiny muted" style={{ marginTop: 4 }}>
            Each playlist has its own sections, song order and schedule. Switch between them
            from the picker at the top; duplicate one to start next season from a week you
            already like.
          </p>
          {state.plans.map((p) => (
            <div className="row" key={p.id} style={{ marginBottom: 6 }}>
              {/* Bound to p.name, not planLabel(p): the label prefers the
                  imported Spotify playlist's name, so an input showing it
                  would overwrite every keystroke with the Spotify name and
                  the rename looked like it did nothing. The placeholder
                  keeps that name visible when no override has been set. */}
              <input
                type="text"
                value={p.name}
                placeholder={sourceOf(p)?.name ?? 'Playlist name'}
                onChange={(e) => dispatch({ type: 'renamePlan', id: p.id, name: e.target.value })}
                aria-label="Playlist name"
              />
              <span
                className="pill"
                title={`${Object.keys(p.tracks).length} songs · ${p.days.length} days · ${p.blocks.reduce((n, b) => n + b.entries.length, 0)} placed`}
              >
                {Object.keys(p.tracks).length}♪ · {p.days.length}d
              </span>
              {!sourceOf(p) && <span className="tiny faint">no playlist yet</span>}
              {p.id !== state.activePlanId && (
                <button className="btn sm" onClick={() => dispatch({ type: 'setActivePlan', id: p.id })}>
                  Open
                </button>
              )}
              <button className="btn sm" onClick={() => dispatch({ type: 'duplicatePlan', id: p.id })}>
                Duplicate
              </button>
              <button
                className="btn sm danger"
                disabled={state.plans.length === 1}
                onClick={() => {
                  const placed = p.blocks.reduce((n, b) => n + b.entries.length, 0)
                  if (
                    confirm(
                      `Delete “${planLabel(p)}”?\n\n` +
                        `${Object.keys(p.tracks).length} songs, ${p.days.length} days and ` +
                        `${placed} placed song${placed === 1 ? '' : 's'} go with it. ` +
                        `This cannot be undone.`,
                    )
                  ) {
                    dispatch({ type: 'deletePlan', id: p.id })
                  }
                }}
              >
                Delete
              </button>
            </div>
          ))}
          <button
            className="btn"
            style={{ marginTop: 8 }}
            onClick={() => dispatch({ type: 'createPlan', name: `Camp Week ${state.plans.length + 1}` })}
          >
            + New week
          </button>
        </div>

        <div className="card">
          <h3>Your data</h3>
          <p className="tiny muted" style={{ marginTop: 4 }}>
            Everything lives in this browser only — nothing is sent anywhere except Spotify. Export a
            backup before switching computers, or to hand the plan to next year’s music person.
          </p>
          <div className="row wrap">
            <button className="btn" onClick={download}>
              Export backup (.json)
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Restore backup
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
