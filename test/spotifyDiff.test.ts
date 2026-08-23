import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  applyMove,
  extraOnSpotify,
  isInSync,
  missingFromSpotify,
  reorderMoves,
} from '../src/lib/spotifyDiff.ts'

/** Run a move sequence the way Spotify would, to check it reaches the goal. */
function simulate(current: string[], target: string[]): string[] {
  return reorderMoves(current, target).reduce(applyMove, current)
}

test('an already-correct order needs no moves', () => {
  // Arrange
  const list = ['a', 'b', 'c']

  // Act
  const moves = reorderMoves(list, list)

  // Assert
  assert.deepEqual(moves, [])
  assert.equal(isInSync(list, list), true)
})

test('moving one song up produces one move', () => {
  // Arrange
  const current = ['a', 'b', 'c']
  const target = ['c', 'a', 'b']

  // Act
  const moves = reorderMoves(current, target)

  // Assert
  assert.equal(moves.length, 1)
  assert.deepEqual(simulate(current, target), target)
})

test('a full reversal still lands exactly on the target', () => {
  // Arrange
  const current = ['a', 'b', 'c', 'd', 'e']
  const target = ['e', 'd', 'c', 'b', 'a']

  // Act / Assert
  assert.deepEqual(simulate(current, target), target)
})

test('a section-grouped regrouping lands on the target', () => {
  // Arrange — the real case: songs interleaved, then grouped by section.
  const current = ['run1', 'lake1', 'run2', 'vibes1', 'lake2', 'run3']
  const target = ['run1', 'run2', 'run3', 'lake1', 'lake2', 'vibes1']

  // Act / Assert
  assert.deepEqual(simulate(current, target), target)
})

test('moving a song down the list lands where intended', () => {
  // Arrange — downward moves are where insert_before is easiest to get wrong.
  const current = ['a', 'b', 'c', 'd']
  const target = ['b', 'c', 'd', 'a']

  // Act / Assert
  assert.deepEqual(simulate(current, target), target)
})

test('songs Spotify has but the app does not are left alone', () => {
  // Arrange — someone added 'x' in the Spotify app.
  const current = ['a', 'x', 'b']
  const target = ['b', 'a']

  // Act
  const result = simulate(current, target)

  // Assert — 'x' survives rather than being dropped.
  assert.equal(result.includes('x'), true)
  assert.equal(result.length, 3)
})

test('the app order is honoured for the songs Spotify does have', () => {
  // Arrange
  const current = ['a', 'x', 'b']
  const target = ['b', 'a']

  // Act
  const result = simulate(current, target).filter((id) => id !== 'x')

  // Assert
  assert.deepEqual(result, ['b', 'a'])
})

test('songs the app knows but Spotify lacks are reported, not moved', () => {
  // Arrange — a local song, or one added to the plan but not the playlist.
  const current = ['a', 'b']
  const target = ['a', 'local1', 'b']

  // Act
  const missing = missingFromSpotify(current, target)

  // Assert
  assert.deepEqual(missing, ['local1'])
  assert.deepEqual(simulate(current, target), ['a', 'b'])
})

test('extra Spotify songs are reported', () => {
  // Arrange
  const current = ['a', 'x', 'b']
  const target = ['a', 'b']

  // Act / Assert
  assert.deepEqual(extraOnSpotify(current, target), ['x'])
})

test('an empty target asks for no moves', () => {
  // Arrange / Act / Assert
  assert.deepEqual(reorderMoves(['a', 'b'], []), [])
})

test('an empty playlist asks for no moves', () => {
  // Arrange / Act / Assert
  assert.deepEqual(reorderMoves([], ['a', 'b']), [])
})

test('the move count stays at or below one per song', () => {
  // Arrange — a worst-case shuffle of a large playlist.
  const size = 200
  const current = Array.from({ length: size }, (_, i) => `t${i}`)
  const target = [...current].reverse()

  // Act
  const moves = reorderMoves(current, target)

  // Assert
  assert.ok(moves.length <= size, `${moves.length} moves for ${size} songs`)
  assert.deepEqual(simulate(current, target), target)
})

test('reorderMoves does not mutate its inputs', () => {
  // Arrange
  const current = ['a', 'b', 'c']
  const target = ['c', 'b', 'a']

  // Act
  reorderMoves(current, target)

  // Assert
  assert.deepEqual(current, ['a', 'b', 'c'])
  assert.deepEqual(target, ['c', 'b', 'a'])
})

test('a duplicated song id does not spin the diff forever', () => {
  // Arrange — Spotify allows the same track twice in a playlist.
  const current = ['a', 'b', 'a']
  const target = ['b', 'a', 'a']

  // Act
  const moves = reorderMoves(current, target)

  // Assert — terminates, and never emits more moves than there are items.
  assert.ok(moves.length <= current.length)
})

test('applyMove matches Spotify semantics moving upward', () => {
  // Arrange — take index 2, put it before index 0.
  const items = ['a', 'b', 'c', 'd']

  // Act
  const next = applyMove(items, { range_start: 2, insert_before: 0, range_length: 1 })

  // Assert
  assert.deepEqual(next, ['c', 'a', 'b', 'd'])
})

test('applyMove matches Spotify semantics moving downward', () => {
  // Arrange — take index 0, put it before index 3.
  const items = ['a', 'b', 'c', 'd']

  // Act
  const next = applyMove(items, { range_start: 0, insert_before: 3, range_length: 1 })

  // Assert — 'a' ends up after 'c', which is what insert_before:3 means once
  // the removal has shifted the list.
  assert.deepEqual(next, ['b', 'c', 'a', 'd'])
})

test('applyMove handles a multi-song range', () => {
  // Arrange
  const items = ['a', 'b', 'c', 'd', 'e']

  // Act
  const next = applyMove(items, { range_start: 0, insert_before: 4, range_length: 2 })

  // Assert
  assert.deepEqual(next, ['c', 'd', 'a', 'b', 'e'])
})
