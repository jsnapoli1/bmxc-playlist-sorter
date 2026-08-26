import { useState } from 'react'
import { appUrl } from '../lib/basePath.ts'

/**
 * Get back into a shared plan with the name and password chosen when
 * joining — for when the invite link is long gone.
 *
 * The case this exists for: someone joined weeks ago, their browser dropped
 * the session cookie, and the app quietly opened the empty local-only plan
 * instead. Their work looked lost, and the only way back was asking for the
 * invite link again — which used to create a second copy of them in the
 * participant list.
 */
export default function SignInModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(appUrl('api/signin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), password }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not sign you in.')
      // The session cookie is set; reload so the app boots straight into the
      // shared plan rather than re-pointing the live socket by hand.
      window.location.reload()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Sign back in</h3>
        <p className="tiny faint">
          Use the name and password you chose when you joined. This brings back the shared
          plan you were working on — no invite link needed.
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
        {error && <div className="notice error">{error}</div>}
        <div className="row wrap" style={{ marginTop: 10 }}>
          <button className="btn primary" type="submit" disabled={busy || !name.trim() || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
