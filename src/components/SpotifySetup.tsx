import { useState } from 'react'
import { useSpotify } from '../spotify/SpotifyProvider.tsx'
import { hasBuiltInClientId } from '../spotify/auth.ts'

/**
 * When the app ships with a Client ID (VITE_SPOTIFY_CLIENT_ID) this is a
 * single button — which is all a camp counsellor should ever see. The
 * developer setup below it only appears when no Client ID was built in,
 * or when someone deliberately opens the advanced section.
 */
export default function SpotifySetup() {
  const { clientId, clientIdOverride, setClientId, resetClientId, connect, redirectUri, status, error } =
    useSpotify()
  const builtIn = hasBuiltInClientId()
  const [draft, setDraft] = useState(clientIdOverride)
  const [advanced, setAdvanced] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const connectButton = (
    <button
      className="btn primary connect-spotify"
      onClick={() => void connect()}
      disabled={!clientId || status === 'connecting'}
    >
      {status === 'connecting' ? 'Connecting…' : 'Connect Spotify'}
    </button>
  )

  const setupSteps = (
    <ol className="steps">
      <li>
        Open the{' '}
        <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
          Spotify developer dashboard
        </a>{' '}
        and click <strong>Create app</strong>. Any name works.
      </li>
      <li>
        Add this exact <strong>Redirect URI</strong>:
        <div className="row" style={{ marginTop: 6 }}>
          <code className="inline grow">{redirectUri}</code>
          <button className="btn sm" onClick={() => void copyRedirect()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="hint">
          Tick <strong>Web API</strong> as the API you plan to use, then save.
        </div>
      </li>
      <li>
        Paste the app’s <strong>Client ID</strong> here:
        <div className="row" style={{ marginTop: 6 }}>
          <input
            type="text"
            placeholder="e.g. 4f2a9c1e8b7d4a1fbc0e5d3a9c7b2e10"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="btn"
            onClick={() => setClientId(draft)}
            disabled={!draft.trim() || draft.trim() === clientIdOverride}
          >
            Save
          </button>
        </div>
        <div className="hint">
          There is no client secret — this app uses PKCE, and the ID stays in your browser.
        </div>
      </li>
      {!builtIn && <li>{connectButton}</li>}
    </ol>
  )

  // The everyday case: one button, no jargon.
  if (builtIn && !advanced) {
    return (
      <div className="connect-panel">
        {error && <div className="banner error tiny">{error}</div>}
        <p className="muted" style={{ marginTop: 0 }}>
          Sign in with your Spotify account to pull in your playlists. You’ll be sent to Spotify
          and straight back here.
        </p>
        {connectButton}
        {clientIdOverride && (
          <div className="hint">
            Using a custom Spotify app.{' '}
            <button className="btn ghost sm" onClick={resetClientId}>
              Reset to the built-in one
            </button>
          </div>
        )}
        <div className="hint">
          <button className="btn ghost sm" onClick={() => setAdvanced(true)}>
            Use my own Spotify app instead
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {error && <div className="banner error tiny">{error}</div>}
      {builtIn && (
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn ghost sm" onClick={() => setAdvanced(false)}>
            ‹ Back
          </button>
          <span className="tiny faint">Only needed if you want to use a different Spotify app.</span>
        </div>
      )}
      {setupSteps}
      {builtIn && <div style={{ marginTop: 10 }}>{connectButton}</div>}
      {!clientId && <div className="hint">Save a Client ID first.</div>}
    </div>
  )
}
