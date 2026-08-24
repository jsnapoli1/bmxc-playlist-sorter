/**
 * Where this app is mounted, e.g. `/` locally and `/playlist-builder/` on
 * bmxc.camp.
 *
 * Vite bakes `BASE_URL` in from the `base` config at build time, so the same
 * source works at either mount point without a runtime flag. Everything that
 * builds a URL the browser will send — API calls, the WebSocket, share links,
 * the join route — goes through here rather than assuming the app owns `/`.
 */

/** Always has a leading and a trailing slash: `/` or `/playlist-builder/`. */
export const BASE: string = (() => {
  const raw = import.meta.env.BASE_URL || '/'
  const withLead = raw.startsWith('/') ? raw : `/${raw}`
  return withLead.endsWith('/') ? withLead : `${withLead}/`
})()

/**
 * An app-relative path resolved against the mount point.
 *
 * `appUrl('api/session')` → `/api/session` or `/playlist-builder/api/session`.
 * Leading slashes on the argument are ignored so callers can write either.
 */
export function appUrl(path: string): string {
  return `${BASE}${path.replace(/^\/+/, '')}`
}

/**
 * The visitor's path *within* the app, with the mount prefix removed and a
 * leading slash kept. At `/playlist-builder/join/abc` this returns
 * `/join/abc`, so route matching never has to know where the app is mounted.
 */
export function appPathname(pathname: string): string {
  if (BASE === '/') return pathname
  const withoutSlash = BASE.slice(0, -1)
  if (pathname === withoutSlash) return '/'
  if (pathname.startsWith(BASE)) return pathname.slice(withoutSlash.length)
  return pathname
}
