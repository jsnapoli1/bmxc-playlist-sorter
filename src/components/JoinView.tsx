import { useState } from 'react'
import { appUrl, BASE } from '../lib/basePath.ts'

/**
 * What someone sees when they open an invite link.
 *
 * A name *and* a password, because a session cookie alone could not survive
 * a cleared browser or a new phone — and re-joining with just a name added a
 * second collaborator row every time, filling the participant list with
 * duplicates of the same people. The password is what lets someone come back
 * and be recognised as themselves.
 *
 * Still no Spotify account and no email: the invite link plus a password
 * they choose is the whole of it.
 */
export default function JoinView({ token, onJoined }: { token: string; onJoined: () => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = name.trim().length > 0 && password.length >= 4

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(appUrl(`api/join/${token}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), password }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'That invite link did not work.')
      // Drop the token from the address bar so it is not left in history.
      window.history.replaceState({}, '', BASE)
      onJoined()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="join">
      <form className="card join-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark">♪</span>
          <span className="brand-text">Camp Playlist Sorter</span>
        </div>
        <h3>You have been invited to a camp playlist</h3>
        <p className="tiny faint">
          Pick a name so the others can see who is editing, and a password so you can get
          back in later on any device. You do not need a Spotify account.
        </p>
        <input
          autoFocus
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          aria-label="Your name"
          autoComplete="username"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
          autoComplete="current-password"
        />
        <p className="tiny faint" style={{ marginTop: -2 }}>
          Been here before? Use the same name and password to pick up where you left off.
        </p>
        {error && <div className="notice error">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy || !ready}>
          {busy ? 'Signing in…' : 'Start editing'}
        </button>
      </form>
    </div>
  )
}
