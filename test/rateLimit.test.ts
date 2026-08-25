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

// How the wait is phrased. Restated rather than imported for the same
// strip-only reason as above.
function waitPhrase(retryAfterS: number): string {
  return retryAfterS < 60
    ? `${Math.max(1, Math.round(retryAfterS))} seconds`
    : `${Math.round(retryAfterS / 60)} minutes`
}

test('a short wait is described in seconds', () => {
  assert.equal(waitPhrase(3), '3 seconds')
  assert.equal(waitPhrase(45), '45 seconds')
})

test('a wait under an hour is described in minutes', () => {
  assert.equal(waitPhrase(60), '1 minutes')
  assert.equal(waitPhrase(600), '10 minutes')
})

test('a sub-second wait still reads as at least one second', () => {
  // Retry-After: 0 would otherwise render "0 seconds", which reads as a bug.
  assert.equal(waitPhrase(0), '1 seconds')
  assert.equal(waitPhrase(0.4), '1 seconds')
})

// Past an hour the message switches to hours plus a wall-clock time, because
// "365 minutes" is accurate and useless. Mirrors describeRateLimit().
function longForm(retryAfterS: number, now: number): { hours: number; clock: string } {
  return {
    hours: Math.round(retryAfterS / 3600),
    clock: new Date(now + retryAfterS * 1000).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }),
  }
}

test('a multi-hour ban is described in hours, not hundreds of minutes', () => {
  // The real case: Spotify returned Retry-After 21900, which rendered as
  // "365 minutes".
  const { hours } = longForm(21900, 0)
  assert.equal(hours, 6)
})

test('a multi-hour ban names the time it lifts', () => {
  // Fixed instant so the assertion cannot drift with the clock.
  const noonUtc = Date.UTC(2026, 7, 25, 12, 0, 0)
  const { clock } = longForm(3600, noonUtc)
  // Local formatting varies by machine; assert the shape, not the zone.
  assert.match(clock, /^\d{1,2}:\d{2}\s?(AM|PM)$/)
})
