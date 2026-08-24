/**
 * Where this Worker is mounted.
 *
 * On workers.dev the app owns the whole origin and the mount is `/`. On
 * bmxc.camp a route sends only `/playlist-builder/*` here, so every path the
 * Worker sees carries that prefix while the routing table below is written
 * in terms of the app's own paths.
 *
 * The entrypoint strips the prefix once so route matching stays mount-
 * agnostic; anything that builds a URL for the *browser* (OAuth redirects,
 * cookie Path) has to put it back, which is what `mountedUrl` is for.
 */

/**
 * Set at build/deploy time via the APP_BASE var in wrangler.jsonc. Normalised
 * to either `/` or `/prefix` — leading slash, no trailing slash — because
 * that is the form path comparison and cookie Path both want.
 */
export function mountPath(env: { APP_BASE?: string }): string {
  const raw = (env.APP_BASE ?? '/').trim()
  if (!raw || raw === '/') return '/'
  const withLead = raw.startsWith('/') ? raw : `/${raw}`
  return withLead.replace(/\/+$/, '')
}

/**
 * The request URL with the mount prefix removed, so `/playlist-builder/api/x`
 * becomes `/api/x`. Returns a new URL; the original is left alone.
 */
export function stripMount(url: URL, mount: string): URL {
  if (mount === '/') return url
  const stripped = new URL(url.toString())
  if (stripped.pathname === mount) {
    stripped.pathname = '/'
  } else if (stripped.pathname.startsWith(`${mount}/`)) {
    stripped.pathname = stripped.pathname.slice(mount.length)
  }
  return stripped
}

/**
 * An app-relative path turned back into an absolute URL the browser can use,
 * including the mount prefix. `mountedUrl(url, '/', mount)` is the app root.
 */
export function mountedUrl(url: URL, path: string, mount: string): string {
  const prefix = mount === '/' ? '' : mount
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${url.origin}${prefix}${suffix}`
}
