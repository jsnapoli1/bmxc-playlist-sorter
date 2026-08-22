import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  beginLogin,
  clearClientIdOverride,
  clearToken,
  completeLoginFromUrl,
  getClientId,
  getClientIdOverride,
  hasBuiltInClientId,
  isConnected,
  redirectUri,
  setClientId as persistClientId,
} from './auth.ts'
import { getMe, getMyPlaylists, type SpotifyPlaylist, type SpotifyUser } from './api.ts'

type Status = 'idle' | 'connecting' | 'connected' | 'error'

type SpotifyValue = {
  status: Status
  user: SpotifyUser | null
  error: string | null
  clientId: string
  /** Non-empty only when the user supplied their own Client ID. */
  clientIdOverride: string
  /** True when the deployment ships with a Client ID, so users just sign in. */
  hasBuiltInClientId: boolean
  /** Set when the profile call failed but playlists may still work. */
  profileNote: string | null
  redirectUri: string
  playlists: SpotifyPlaylist[]
  playlistsLoading: boolean
  setClientId: (id: string) => void
  resetClientId: () => void
  connect: () => Promise<void>
  disconnect: () => void
  refreshPlaylists: () => Promise<void>
  clearError: () => void
}

const SpotifyContext = createContext<SpotifyValue | null>(null)

/**
 * The redirect back from Spotify carries a one-time code. React StrictMode
 * runs effects twice in development, so memoize the exchange — otherwise the
 * second run finds an already-consumed code and reports "not connected".
 */
let loginExchange: Promise<boolean> | null = null
function completeLoginOnce(): Promise<boolean> {
  loginExchange ??= completeLoginFromUrl()
  return loginExchange
}

export function SpotifyProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() => (isConnected() ? 'connecting' : 'idle'))
  const [user, setUser] = useState<SpotifyUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clientId, setClientIdState] = useState(getClientId)
  const [clientIdOverride, setClientIdOverrideState] = useState(getClientIdOverride)
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [playlistsLoading, setPlaylistsLoading] = useState(false)

  /** Non-blocking note: the profile call failed but the connection is usable. */
  const [profileNote, setProfileNote] = useState<string | null>(null)

  // Handle the redirect back from Spotify, then load the profile.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await completeLoginOnce()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setStatus('error')
        }
        return
      }
      if (!isConnected()) {
        if (!cancelled) setStatus('idle')
        return
      }
      // Holding a usable token is what "connected" means. The profile is
      // only a display name and avatar — it has no functional use since
      // playlists are created through /me/playlists — so a failure there
      // must not take down playlist access with it.
      if (!cancelled) setStatus('connected')
      try {
        const me = await getMe()
        if (!cancelled) {
          setUser(me)
          setProfileNote(null)
        }
      } catch (err) {
        if (cancelled) return
        setUser(null)
        setProfileNote(
          `Could not read your Spotify profile: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refreshPlaylists = useCallback(async () => {
    setPlaylistsLoading(true)
    try {
      setPlaylists(await getMyPlaylists())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPlaylistsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'connected' && !playlists.length) void refreshPlaylists()
    // Only kick this off on the transition into `connected`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const connect = useCallback(async () => {
    setError(null)
    try {
      await beginLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [])

  const disconnect = useCallback(() => {
    clearToken()
    setUser(null)
    setPlaylists([])
    setStatus('idle')
    setError(null)
  }, [])

  const setClientId = useCallback((id: string) => {
    persistClientId(id)
    setClientIdState(getClientId())
    setClientIdOverrideState(getClientIdOverride())
  }, [])

  const resetClientId = useCallback(() => {
    clearClientIdOverride()
    setClientIdState(getClientId())
    setClientIdOverrideState(getClientIdOverride())
  }, [])

  const value = useMemo<SpotifyValue>(
    () => ({
      status,
      user,
      error,
      clientId,
      clientIdOverride,
      hasBuiltInClientId: hasBuiltInClientId(),
      profileNote,
      redirectUri: redirectUri(),
      playlists,
      playlistsLoading,
      setClientId,
      resetClientId,
      connect,
      disconnect,
      refreshPlaylists,
      clearError: () => setError(null),
    }),
    [
      status,
      user,
      error,
      clientId,
      clientIdOverride,
      profileNote,
      playlists,
      playlistsLoading,
      setClientId,
      resetClientId,
      connect,
      disconnect,
      refreshPlaylists,
    ],
  )

  return <SpotifyContext.Provider value={value}>{children}</SpotifyContext.Provider>
}

export function useSpotify(): SpotifyValue {
  const ctx = useContext(SpotifyContext)
  if (!ctx) throw new Error('useSpotify must be used inside <SpotifyProvider>')
  return ctx
}
