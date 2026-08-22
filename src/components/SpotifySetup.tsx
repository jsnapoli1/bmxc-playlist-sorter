import { useState } from 'react'
import { useSpotify } from '../spotify/SpotifyProvider.tsx'

/**
 * Onboarding for the Spotify connection. Because the app is entirely
 * client-side there is no shared secret, so each user registers their own
 * (free) Spotify app and pastes its Client ID here.
 */
export default function SpotifySetup() {
  const { clientId, setClientId, connect, redirectUri, status, error } = useSpotify()
  const [draft, setDraft] = useState(clientId)
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

  return (
    <div>
      {error && <div className="banner error tiny">{error}</div>}
      <ol className="steps">
        <li>
          Open the{' '}
          <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
            Spotify developer dashboard
          </a>{' '}
          and click <strong>Create app</strong>. Any name works — “Camp Playlist Sorter” is fine.
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
          Copy the app’s <strong>Client ID</strong> and paste it here:
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
              disabled={!draft.trim() || draft.trim() === clientId}
            >
              Save
            </button>
          </div>
          <div className="hint">
            There is no client secret — this app uses PKCE, and the ID stays in your browser.
          </div>
        </li>
        <li>
          <button
            className="btn primary"
            onClick={() => void connect()}
            disabled={!clientId || status === 'connecting'}
          >
            {status === 'connecting' ? 'Connecting…' : 'Connect to Spotify'}
          </button>
          {!clientId && <div className="hint">Save a Client ID first.</div>}
        </li>
      </ol>
    </div>
  )
}
