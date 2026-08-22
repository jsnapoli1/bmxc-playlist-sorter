import { useState } from 'react'
import { probeEndpoint, type ProbeResult } from '../spotify/api.ts'
import { getClientId, loadToken, redirectUri, SCOPES } from '../spotify/auth.ts'

/**
 * Spotify's 403s do not say which of several unrelated causes applies, so
 * this reports the facts needed to tell them apart: which account the token
 * belongs to, which scopes were actually granted, and how each call answers.
 */
export default function SpotifyDiagnostics() {
  const [results, setResults] = useState<ProbeResult[] | null>(null)
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)

  const token = loadToken()
  const granted = token?.scope ? token.scope.split(' ').filter(Boolean) : []
  const missing = SCOPES.filter((s) => granted.length > 0 && !granted.includes(s))

  const run = async () => {
    setRunning(true)
    setCopied(false)
    const probes: [string, string][] = [
      ['Your profile', '/me'],
      ['Your playlists', '/me/playlists?limit=1'],
    ]
    const out: ProbeResult[] = []
    for (const [label, path] of probes) out.push(await probeEndpoint(label, path))
    setResults(out)
    setRunning(false)
  }

  const report = () =>
    [
      `client id: ${getClientId() || '(none)'}`,
      `redirect uri: ${redirectUri()}`,
      `token present: ${Boolean(token)}`,
      `granted scopes: ${granted.length ? granted.join(' ') : '(none reported)'}`,
      `missing scopes: ${missing.length ? missing.join(' ') : 'none'}`,
      ...(results ?? []).map(
        (r) => `${r.path} -> ${r.status || 'no response'}${r.detail ? ` "${r.detail}"` : ''}`,
      ),
    ].join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <div className="section-label">Connection test</div>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        If Spotify is refusing requests, this shows exactly which call fails and what it says.
      </p>
      <div className="row wrap">
        <button className="btn" onClick={() => void run()} disabled={running}>
          {running ? 'Testing…' : 'Run connection test'}
        </button>
        {results && (
          <button className="btn sm" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy results'}
          </button>
        )}
      </div>

      {granted.length > 0 && missing.length > 0 && (
        <div className="banner error tiny" style={{ marginTop: 10 }}>
          Spotify did not grant: {missing.join(', ')}. Disconnect and connect again to re-consent.
        </div>
      )}

      {results && (
        <div style={{ marginTop: 10 }}>
          {results.map((r) => (
            <div className="row tiny" key={r.path} style={{ alignItems: 'baseline', gap: 8 }}>
              <span className="dot" style={{ background: r.ok ? 'var(--accent)' : 'var(--danger)' }} />
              <strong style={{ minWidth: 100 }}>{r.label}</strong>
              <span className="mono faint">{r.status || 'no response'}</span>
              <span className="muted grow">{r.detail}</span>
            </div>
          ))}
          <details style={{ marginTop: 10 }}>
            <summary className="tiny faint" style={{ cursor: 'pointer' }}>
              Details to share when asking for help
            </summary>
            <pre
              className="mono tiny"
              style={{
                whiteSpace: 'pre-wrap',
                background: 'var(--bg-sunken)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 8,
                marginTop: 6,
              }}
            >
              {report()}
            </pre>
          </details>
        </div>
      )}

      {results?.some((r) => r.status === 403) && (
        <div className="banner tiny" style={{ marginTop: 10 }}>
          <strong>A 403 on every call means Spotify is rejecting the account, not the code.</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>
              The signed-in account must be listed under <strong>User Management</strong> in the
              Spotify app’s dashboard settings — check the name and email match this account exactly.
            </li>
            <li>
              Confirm which account actually authorised: Spotify’s consent screen uses whichever
              account the browser is already signed into, which may not be the one you added.
            </li>
            <li>
              The <strong>app owner</strong> must have an active Spotify Premium subscription; since
              February 2026 the app stops working without it.
            </li>
          </ul>
        </div>
      )}
    </>
  )
}
