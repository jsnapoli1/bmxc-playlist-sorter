/**
 * The reason a Spotify sign-in failed.
 *
 * The Worker redirects back to "/" with ?auth_error=... when Spotify
 * refuses. Nothing used to read it, so a refusal looked identical to a
 * successful sign-in that simply did nothing — you landed back on the
 * calendar with no explanation.
 */

export type AuthError = { code: string; detail: string; advice: string }

/** Plain-English advice for the refusals Spotify actually sends. */
function adviceFor(code: string, detail: string): string {
  const text = `${code} ${detail}`.toLowerCase()

  if (code === 'access_denied') {
    return 'You cancelled the Spotify sign-in, or declined the permissions. Try again and choose Agree.'
  }
  if (text.includes('redirect uri')) {
    return 'The redirect URI registered in the Spotify dashboard does not match this site exactly. It must be https://bmxc-playlist-sorter.simplifai-ai.workers.dev/api/auth/callback, character for character.'
  }
  if (text.includes('invalid client') || text.includes('invalid_client')) {
    return 'The Client ID or Client Secret does not match the Spotify app. Check both in the Spotify dashboard.'
  }
  if (text.includes('user management') || text.includes('development mode') || text.includes('forbidden')) {
    return 'This Spotify app is in Development mode, so only accounts listed under User Management in the Spotify dashboard can sign in. Add this account there, then try again.'
  }
  if (text.includes('cookie') || text.includes('could not be verified')) {
    return 'The browser did not send the sign-in cookie back. Private or incognito browsing and strict tracking protection can cause this.'
  }
  return 'Try again. If it keeps failing, check the Spotify app dashboard: the redirect URI, the Client ID, and whether this account is listed under User Management.'
}

/**
 * Read and clear an auth error from the address bar.
 *
 * Clearing it means a reload does not resurrect a stale message, and the
 * failure code does not linger in browser history.
 *
 * Read once at module load rather than during render: StrictMode invokes a
 * state initialiser twice, and the second call would find the URL already
 * cleaned and report no error at all.
 */
function readAuthErrorOnce(): AuthError | null {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('auth_error')
  if (!code) return null

  const detail = url.searchParams.get('auth_error_detail') ?? ''

  url.searchParams.delete('auth_error')
  url.searchParams.delete('auth_error_detail')
  window.history.replaceState({}, '', url.toString())

  return { code, detail, advice: adviceFor(code, detail) }
}

/** The error this page load arrived with, if any. Captured at import time. */
const captured: AuthError | null =
  typeof window === 'undefined' ? null : readAuthErrorOnce()

export function takeAuthError(): AuthError | null {
  return captured
}
