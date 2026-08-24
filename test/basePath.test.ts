import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mountPath, mountedUrl, stripMount } from '../worker/basePath.ts'

// The worker half of the mount logic. The browser half lives in
// src/lib/basePath.ts and reads import.meta.env, which is a build-time
// substitution Node cannot evaluate — so the shared behaviour is pinned
// here, where it can run unmodified.

test('mountPath defaults to root when unset', () => {
  assert.equal(mountPath({}), '/')
  assert.equal(mountPath({ APP_BASE: '/' }), '/')
  assert.equal(mountPath({ APP_BASE: '' }), '/')
})

test('mountPath normalises a subpath to a leading slash and no trailing slash', () => {
  assert.equal(mountPath({ APP_BASE: '/playlist-builder' }), '/playlist-builder')
  assert.equal(mountPath({ APP_BASE: 'playlist-builder' }), '/playlist-builder')
  assert.equal(mountPath({ APP_BASE: '/playlist-builder/' }), '/playlist-builder')
})

test('stripMount removes the prefix so routes match unchanged', () => {
  const url = new URL('https://bmxc.camp/playlist-builder/api/session')
  assert.equal(stripMount(url, '/playlist-builder').pathname, '/api/session')
})

test('stripMount maps the bare mount to the app root', () => {
  const url = new URL('https://bmxc.camp/playlist-builder')
  assert.equal(stripMount(url, '/playlist-builder').pathname, '/')
})

test('stripMount preserves the query string', () => {
  const url = new URL('https://bmxc.camp/playlist-builder/api/auth/callback?code=abc&state=xyz')
  const out = stripMount(url, '/playlist-builder')
  assert.equal(out.pathname, '/api/auth/callback')
  assert.equal(out.searchParams.get('code'), 'abc')
  assert.equal(out.searchParams.get('state'), 'xyz')
})

test('stripMount is a no-op at the root mount', () => {
  const url = new URL('https://example.workers.dev/api/session')
  assert.equal(stripMount(url, '/').pathname, '/api/session')
})

test('stripMount does not strip a path that merely shares a prefix', () => {
  // `/playlist-builder-extra` must not be mangled into `-extra`.
  const url = new URL('https://bmxc.camp/playlist-builder-extra/thing')
  assert.equal(stripMount(url, '/playlist-builder').pathname, '/playlist-builder-extra/thing')
})

test('stripMount leaves the original URL untouched', () => {
  const url = new URL('https://bmxc.camp/playlist-builder/api/session')
  stripMount(url, '/playlist-builder')
  assert.equal(url.pathname, '/playlist-builder/api/session')
})

test('mountedUrl rebuilds a browser-facing URL with the prefix', () => {
  const url = new URL('https://bmxc.camp/playlist-builder/api/auth/login')
  assert.equal(
    mountedUrl(url, '/api/auth/callback', '/playlist-builder'),
    'https://bmxc.camp/playlist-builder/api/auth/callback',
  )
  assert.equal(mountedUrl(url, '/', '/playlist-builder'), 'https://bmxc.camp/playlist-builder/')
})

test('mountedUrl omits the prefix at the root mount', () => {
  const url = new URL('https://example.workers.dev/api/auth/login')
  assert.equal(
    mountedUrl(url, '/api/auth/callback', '/'),
    'https://example.workers.dev/api/auth/callback',
  )
  assert.equal(mountedUrl(url, '/', '/'), 'https://example.workers.dev/')
})

test('the OAuth redirect URI round-trips through both halves', () => {
  // Spotify matches the redirect_uri byte for byte between the authorize
  // call and the token exchange, and the two are built in different
  // functions — so pin that they agree.
  const mount = mountPath({ APP_BASE: '/playlist-builder' })

  const authorizeReq = new URL('https://bmxc.camp/playlist-builder/api/auth/login')
  const atAuthorize = mountedUrl(authorizeReq, '/api/auth/callback', mount)

  const callbackReq = new URL('https://bmxc.camp/playlist-builder/api/auth/callback?code=abc')
  const atExchange = mountedUrl(stripMount(callbackReq, mount), '/api/auth/callback', mount)

  assert.equal(atAuthorize, atExchange)
  assert.equal(atAuthorize, 'https://bmxc.camp/playlist-builder/api/auth/callback')
})
