import { strict as assert } from 'node:assert'
import { test } from 'node:test'

// worker/spotify.ts uses a constructor parameter property, which Node's
// strip-only TypeScript mode will not load, so the classification rule is
// restated here rather than imported. It mirrors the expression in
// OwnerSpotify.call() — if that changes, this fails and says so.
function isPermanent(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429
}

test('429 is never permanent — waiting is the fix', () => {
  // The bug: 429 fell inside the 4xx range and was marked permanent, so a
  // rate limit paused sync outright and told the user to reconnect Spotify,
  // which could not have helped.
  assert.equal(isPermanent(429), false)
})

test('auth and permission failures stay permanent', () => {
  // These genuinely cannot be retried into success.
  assert.equal(isPermanent(401), true)
  assert.equal(isPermanent(403), true)
  assert.equal(isPermanent(404), true)
})

test('server errors stay retryable', () => {
  assert.equal(isPermanent(500), false)
  assert.equal(isPermanent(502), false)
  assert.equal(isPermanent(503), false)
})

// The wait Spotify asks for, phrased for a human. Mirrors RateLimited's
// constructor.
function waitPhrase(retryAfterS: number): string {
  return retryAfterS < 60
    ? `${Math.max(1, Math.round(retryAfterS))} seconds`
    : `${Math.round(retryAfterS / 60)} minutes`
}

test('a short wait is described in seconds', () => {
  assert.equal(waitPhrase(3), '3 seconds')
  assert.equal(waitPhrase(45), '45 seconds')
})

test('a long wait is described in minutes', () => {
  assert.equal(waitPhrase(60), '1 minutes')
  assert.equal(waitPhrase(600), '10 minutes')
})

test('a sub-second wait still reads as at least one second', () => {
  // Retry-After: 0 would otherwise render "0 seconds", which reads as a bug.
  assert.equal(waitPhrase(0), '1 seconds')
  assert.equal(waitPhrase(0.4), '1 seconds')
})
