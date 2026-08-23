import { useState } from 'react'

/**
 * What someone sees when they open an invite link. They pick a name and are
 * in — no account, no password, no Spotify.
 */
export default function JoinView({ token, onJoined }: { token: string; onJoined: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/join/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'That invite link did not work.')
      // Drop the token from the address bar so it is not left in history.
      window.history.replaceState({}, '', '/')
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
          Pick a name so the others can see who is editing. You do not need a Spotify
          account.
        </p>
        <input
          autoFocus
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          aria-label="Your name"
        />
        {error && <div className="notice error">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </form>
    </div>
  )
}
