import { useRef, useState } from 'react'
import { useStore } from '../lib/store.tsx'
import { useSpotify } from '../spotify/SpotifyProvider.tsx'
import SpotifySetup from './SpotifySetup.tsx'
import SpotifyDiagnostics from './SpotifyDiagnostics.tsx'
import { createPlaylistWithTracks } from '../spotify/api.ts'
import { minutesOf } from '../lib/time.ts'
import { loadToken } from '../spotify/auth.ts'

export default function SettingsView() {
  const { state, plan, dispatch, exportJson, importJson } = useStore()
  const { status, user, disconnect, redirectUri, error: connectionError } = useSpotify()
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

        <div className="card">
          <h3>Spotify</h3>
          {status === 'connected' ? (
            <>
              <div className="row" style={{ marginTop: 10 }}>
                {user?.image ? <img className="art" src={user.image} alt="" /> : <div className="art">♪</div>}
                <div className="grow">
                  <div className="track-name">{user?.displayName}</div>
                  <div className="track-sub">Connected</div>
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

        <div className="card">
          <h3>Weeks</h3>
          <p className="tiny muted" style={{ marginTop: 4 }}>
            Keep a separate plan per camp session, and duplicate one to start the next week from a
            schedule you already like.
          </p>
          {state.plans.map((p) => (
            <div className="row" key={p.id} style={{ marginBottom: 6 }}>
              <input
                type="text"
                value={p.name}
                onChange={(e) => dispatch({ type: 'renamePlan', id: p.id, name: e.target.value })}
              />
              <span className="pill">
                {p.days.length}d · {p.blocks.reduce((n, b) => n + b.entries.length, 0)}♪
              </span>
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
                  if (confirm(`Delete the plan “${p.name}”? This cannot be undone.`)) {
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
