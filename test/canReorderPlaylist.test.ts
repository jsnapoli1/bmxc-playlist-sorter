import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { canReorderPlaylist } from '../worker/playlistAccess.ts'

// Who is allowed to reorder. Both the turn-it-on check (setPlaylist) and the
// per-sync check (PlanRoom) call this one function, so these cases pin the
// rule for both — the failure mode when they disagreed was a playlist that
// saved fine and then failed silently on every sync.

const ME = 'spotify_me'

test('the connected account can reorder its own playlist', () => {
  assert.equal(canReorderPlaylist({ owner: { id: ME } }, ME), true)
})

test('a collaborative playlist owned by someone else can be reordered', () => {
  // The case this rule was relaxed for: a shared camp playlist someone else
  // created and added the connected account to.
  assert.equal(canReorderPlaylist({ owner: { id: 'someone_else' }, collaborative: true }, ME), true)
})

test('a playlist owned by someone else and not collaborative cannot be reordered', () => {
  assert.equal(
    canReorderPlaylist({ owner: { id: 'someone_else' }, collaborative: false }, ME),
    false,
  )
})

test('a missing collaborative flag is treated as not collaborative', () => {
  // Spotify omits the field on some responses. Absent must not read as
  // permission — that would let a write be attempted on a playlist the
  // account cannot edit.
  assert.equal(canReorderPlaylist({ owner: { id: 'someone_else' }, collaborative: undefined }, ME), false)
  assert.equal(canReorderPlaylist({ owner: { id: 'someone_else' }, collaborative: true }, ME), true)
})

test('an own playlist is editable whether or not it is collaborative', () => {
  assert.equal(canReorderPlaylist({ owner: { id: ME }, collaborative: false }, ME), true)
  assert.equal(canReorderPlaylist({ owner: { id: ME }, collaborative: true }, ME), true)
})

test('an unknown connected account cannot reorder a non-collaborative playlist', () => {
  // owner_id lookup can come back undefined; that must not match an owner
  // id that is itself missing and let the write through.
  assert.equal(canReorderPlaylist({ owner: { id: 'someone_else' } }, undefined), false)
})
