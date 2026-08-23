import { useCallback, useEffect, useState } from 'react'
import App from './App.tsx'
import JoinView from './components/JoinView.tsx'
import { StoreProvider } from './lib/store.tsx'
import { useSharedPlan } from './lib/useSharedPlan.ts'
import type { Role } from './lib/protocol.ts'

export type SessionInfo = {
  collaboratorId: string
  planId: string
  displayName: string
  role: Role
  planName: string
  spotifyPlaylistId: string | null
}

/** `/join/<token>` — the invite-link route. */
function joinTokenFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/join\/([A-Za-z0-9]+)\/?$/)
  return match?.[1] ?? null
}

/**
 * Decides which app the visitor gets.
 *
 * A share link shows the join screen. A valid session opens the shared,
 * live-synced plan. Anyone else gets the original local-only app, which
 * still works with no backend at all — that matters because the app has to
 * keep working offline at camp.
 */
function Shell({ session }: { session: SessionInfo | null }) {
  const shared = useSharedPlan(Boolean(session))

  // While a shared plan is still loading, render nothing rather than
  // flashing an empty local plan the user might start editing.
  if (session && !shared.plan) {
    return (
      <div className="join">
        <div className="card join-card">
          <div className="brand">
            <span className="brand-mark">♪</span>
            <span className="brand-text">Camp Playlist Sorter</span>
          </div>
          <p className="tiny faint">
            {shared.connection === 'offline'
              ? 'Reconnecting to the shared plan…'
              : 'Opening the shared plan…'}
          </p>
          {shared.error && <div className="notice error">{shared.error}</div>}
        </div>
      </div>
    )
  }

  return (
    <StoreProvider shared={session ? { plan: shared.plan, send: shared.send } : undefined}>
      <App session={session} shared={shared} />
    </StoreProvider>
  )
}

export default function Root() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [checked, setChecked] = useState(false)
  const [joinToken, setJoinToken] = useState<string | null>(joinTokenFromUrl)

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch('/api/session')
      const data = res.ok ? ((await res.json()) as SessionInfo | { session: null }) : null
      // The endpoint answers `{session: null}` when nobody is signed in.
      setSession(data && 'planId' in data ? data : null)
    } catch {
      // No backend (or offline): fall back to the local-only app rather
      // than blocking on a server that may not exist.
      setSession(null)
    } finally {
      setChecked(true)
    }
  }, [])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  if (joinToken) {
    return (
      <JoinView
        token={joinToken}
        onJoined={() => {
          setJoinToken(null)
          setChecked(false)
          void loadSession()
        }}
      />
    )
  }

  // Avoid rendering the local app for a split second before discovering the
  // visitor actually has a shared plan.
  if (!checked) return null

  return <Shell session={session} />
}
