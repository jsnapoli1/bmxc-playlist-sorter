/**
 * Spotify Authorization Code + PKCE.
 *
 * This app has no server, so there is no client secret anywhere. The user
 * supplies the Client ID of a Spotify app they created; PKCE proves the
 * token request came from the same browser that started the login.
 */

const CLIENT_ID_KEY = 'cps.spotify.clientId'
const VERIFIER_KEY = 'cps.spotify.verifier'
const TOKEN_KEY = 'cps.spotify.token'
const STATE_KEY = 'cps.spotify.state'

export const SCOPES = [
  // Reading /me needs these; without them Spotify can reject the profile call
  // outright rather than just omitting fields.
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
]

export type TokenSet = {
  access_token: string
  refresh_token?: string
  /** Absolute epoch ms when the access token stops working. */
  expires_at: number
  scope?: string
}

/** Exact URI to register in the Spotify dashboard. Must match byte for byte. */
export function redirectUri(): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${window.location.origin}${base}`.replace(/\/+$/, '/')
}

/**
 * A Client ID baked in at build time (VITE_SPOTIFY_CLIENT_ID).
 *
 * This is what turns the app from "every user registers their own Spotify
 * app" into "every user clicks one button". A PKCE client ID is public by
 * design — it is not a secret, and shipping it in the bundle is the intended
 * use. What protects it is Spotify's redirect-URI allowlist: a code can only
 * ever be sent back to a URI registered on the app.
 */
export const BUILT_IN_CLIENT_ID = (
  (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) ?? ''
).trim()

export function hasBuiltInClientId(): boolean {
  return BUILT_IN_CLIENT_ID.length > 0
}

/** A Client ID the user typed in, overriding the built-in one. */
export function getClientIdOverride(): string {
  return localStorage.getItem(CLIENT_ID_KEY)?.trim() ?? ''
}

export function getClientId(): string {
  return getClientIdOverride() || BUILT_IN_CLIENT_ID
}

export function setClientId(id: string): void {
  const trimmed = id.trim()
  if (!trimmed || trimmed === BUILT_IN_CLIENT_ID) localStorage.removeItem(CLIENT_ID_KEY)
  else localStorage.setItem(CLIENT_ID_KEY, trimmed)
}

/** Drop a manual Client ID and fall back to the one shipped with the app. */
export function clearClientIdOverride(): void {
  localStorage.removeItem(CLIENT_ID_KEY)
}

export function loadToken(): TokenSet | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    return raw ? (JSON.parse(raw) as TokenSet) : null
  } catch {
    return null
  }
}

function saveToken(token: TokenSet): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(VERIFIER_KEY)
  localStorage.removeItem(STATE_KEY)
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

function base64Url(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(digest)
}

/** Send the browser to Spotify's consent screen. */
export async function beginLogin(): Promise<void> {
  const clientId = getClientId()
  if (!clientId) throw new Error('Add your Spotify Client ID first.')

  const verifier = randomString(96)
  const state = randomString(16)
  localStorage.setItem(VERIFIER_KEY, verifier)
  localStorage.setItem(STATE_KEY, state)

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    state,
    scope: SCOPES.join(' '),
  })
  window.location.href = `https://accounts.spotify.com/authorize?${params}`
}

async function requestToken(body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    const detail = (json.error_description || json.error) as string | undefined
    throw new Error(detail || `Spotify rejected the token request (${res.status}).`)
  }
  const token: TokenSet = {
    access_token: json.access_token as string,
    refresh_token: json.refresh_token as string | undefined,
    expires_at: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    scope: json.scope as string | undefined,
  }
  return token
}

/**
 * If the URL carries ?code=..., trade it for tokens and clean the address bar.
 * Returns true when a login just completed.
 */
export async function completeLoginFromUrl(): Promise<boolean> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const state = url.searchParams.get('state')
  if (!code && !error) return false

  const clean = () => {
    url.searchParams.delete('code')
    url.searchParams.delete('error')
    url.searchParams.delete('state')
    window.history.replaceState({}, '', url.toString())
  }

  if (error) {
    clean()
    throw new Error(`Spotify login was cancelled (${error}).`)
  }

  const expectedState = localStorage.getItem(STATE_KEY)
  const verifier = localStorage.getItem(VERIFIER_KEY)
  clean()

  if (expectedState && state !== expectedState) {
    throw new Error('Login state did not match. Please try connecting again.')
  }
  if (!verifier) throw new Error('Login session expired. Please try connecting again.')

  const token = await requestToken(
    new URLSearchParams({
      client_id: getClientId(),
      grant_type: 'authorization_code',
      code: code as string,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  )
  localStorage.removeItem(VERIFIER_KEY)
  localStorage.removeItem(STATE_KEY)
  saveToken(token)
  return true
}

let refreshInFlight: Promise<TokenSet> | null = null

/** A valid access token, refreshing when it is within a minute of expiry. */
export async function getAccessToken(): Promise<string> {
  const token = loadToken()
  if (!token) throw new Error('Not connected to Spotify.')
  if (Date.now() < token.expires_at - 60_000) return token.access_token
  if (!token.refresh_token) {
    clearToken()
    throw new Error('Your Spotify session expired. Please connect again.')
  }

  refreshInFlight ??= requestToken(
    new URLSearchParams({
      client_id: getClientId(),
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }),
  )
    .then((fresh) => {
      const merged = { ...fresh, refresh_token: fresh.refresh_token ?? token.refresh_token }
      saveToken(merged)
      return merged
    })
    .catch((err) => {
      clearToken()
      throw err
    })
    .finally(() => {
      refreshInFlight = null
    })

  return (await refreshInFlight).access_token
}

/** Scopes Spotify actually granted the stored token, if it reported them. */
export function grantedScopes(): string[] {
  const scope = loadToken()?.scope
  return scope ? scope.split(' ').filter(Boolean) : []
}

/**
 * Scopes this build asks for that the stored token does not carry.
 *
 * Tokens never gain scopes retroactively, so after this app starts
 * requesting a new one, everyone already signed in keeps a token without it
 * until they consent again. Empty when the token reported no scopes at all,
 * since then nothing can be concluded.
 */
export function missingScopes(): string[] {
  const granted = grantedScopes()
  if (!granted.length) return []
  return SCOPES.filter((s) => !granted.includes(s))
}

export function isConnected(): boolean {
  const token = loadToken()
  return Boolean(token && (token.refresh_token || Date.now() < token.expires_at))
}
