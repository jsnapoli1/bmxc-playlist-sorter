import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { applyOp, applyOps } from '../src/lib/applyOp.ts'
import { orderedTrackIds } from '../src/lib/playlistOrder.ts'
import type { Op } from '../src/lib/protocol.ts'
import type { Plan, Track } from '../src/lib/types.ts'

function track(id: string, over: Partial<Track> = {}): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: id,
    artists: 'A',
    album: 'B',
    durationMs: 1000,
    explicit: false,
    ...over,
  }
}

function plan(over: Partial<Plan> = {}): Plan {
  return {
    version: 1,
    id: 'p',
    name: 'Plan',
    days: [],
    blocks: [],
    tracks: {},
    sources: [],
    updatedAt: 0,
    ...over,
  }
}

test('ops do not mutate the plan they are applied to', () => {
  // Arrange
  const before = plan({ tracks: { a: track('a'), b: track('b') }, trackOrder: ['a', 'b'] })
  const snapshot = JSON.stringify(before)

  // Act
  applyOp(before, { type: 'moveTracks', trackIds: ['b'], beforeId: 'a' })

  // Assert
  assert.equal(JSON.stringify(before), snapshot)
})

test('the same ops in the same order reach the same plan', () => {
  // Arrange — this is what makes client and server converge.
  const start = plan({
    tracks: { a: track('a'), b: track('b'), c: track('c') },
    trackOrder: ['a', 'b', 'c'],
    sections: [{ id: 's1', name: 'Run', color: '#ef4444' }],
  })
  const ops: Op[] = [
    { type: 'moveTracks', trackIds: ['c'], beforeId: 'a', sectionId: 's1' },
    { type: 'addSection', id: 's2', name: 'Lake', color: '#0ea5e9' },
    { type: 'setTrackSection', trackIds: ['b'], sectionId: 's2' },
    { type: 'moveTracks', trackIds: ['a'], beforeId: null },
  ]

  // Act — two independent runs, as two clients would do.
  const first = applyOps(start, ops)
  const second = applyOps(start, ops)

  // Assert
  assert.deepEqual(first, second)
})

test('applying ops one at a time matches applying them as a batch', () => {
  // Arrange
  const start = plan({ tracks: { a: track('a'), b: track('b') }, trackOrder: ['a', 'b'] })
  const ops: Op[] = [
    { type: 'addSection', id: 's1', name: 'Run', color: '#ef4444' },
    { type: 'setTrackSection', trackIds: ['a'], sectionId: 's1' },
  ]

  // Act
  const stepwise = ops.reduce(applyOp, start)
  const batched = applyOps(start, ops)

  // Assert
  assert.deepEqual(stepwise, batched)
})

test('replaying an addSection does not duplicate it', () => {
  // Arrange — a reconnect can resend an op the server already applied.
  const start = plan()
  const op: Op = { type: 'addSection', id: 's1', name: 'Run', color: '#ef4444' }

  // Act
  const once = applyOp(start, op)
  const twice = applyOp(once, op)

  // Assert
  assert.equal(twice.sections?.length, 1)
})

test('replaying an assign does not duplicate the entry', () => {
  // Arrange
  const start = plan({
    tracks: { a: track('a') },
    blocks: [
      { id: 'b1', dayId: 'd1', title: 'T', start: '', end: '', location: '', category: 'Other', notes: '', entries: [] },
    ],
  })
  const op: Op = { type: 'assign', blockId: 'b1', entryIds: ['e1'], trackIds: ['a'] }

  // Act
  const once = applyOp(start, op)
  const twice = applyOp(once, op)

  // Assert
  assert.equal(twice.blocks[0].entries.length, 1)
})

test('replaying addBlock does not duplicate the block', () => {
  // Arrange
  const start = plan({ days: [{ id: 'd1', label: 'Mon' }] })
  const op: Op = { type: 'addBlock', id: 'b1', dayId: 'd1' }

  // Act
  const twice = applyOp(applyOp(start, op), op)

  // Assert
  assert.equal(twice.blocks.length, 1)
})

test('replaying addDay does not duplicate the day', () => {
  // Arrange
  const op: Op = { type: 'addDay', id: 'd1', label: 'Monday' }

  // Act
  const twice = applyOp(applyOp(plan(), op), op)

  // Assert
  assert.equal(twice.days.length, 1)
})

test('an op naming a deleted block is ignored, not an error', () => {
  // Arrange — a collaborator deleted the block first.
  const start = plan()

  // Act
  const next = applyOp(start, { type: 'unassign', blockId: 'gone', entryId: 'e1' })

  // Assert
  assert.deepEqual(next.blocks, [])
})

test('moveEntry for an entry that no longer exists leaves the plan alone', () => {
  // Arrange
  const start = plan({
    blocks: [
      { id: 'b1', dayId: 'd', title: '', start: '', end: '', location: '', category: 'Other', notes: '', entries: [] },
    ],
  })

  // Act
  const next = applyOp(start, {
    type: 'moveEntry',
    fromBlockId: 'b1',
    entryId: 'nope',
    toBlockId: 'b1',
    toIndex: 0,
  })

  // Assert
  assert.equal(next, start)
})

test('deleting a section moves its songs to unsorted rather than losing them', () => {
  // Arrange
  const start = plan({
    tracks: { a: track('a', { sectionId: 's1' }) },
    sections: [{ id: 's1', name: 'Run', color: '#ef4444' }],
  })

  // Act
  const next = applyOp(start, { type: 'deleteSection', id: 's1' })

  // Assert
  assert.equal(Object.keys(next.tracks).length, 1)
  assert.equal(next.tracks.a.sectionId, undefined)
})

test('adding tracks appends them without moving what is already ordered', () => {
  // Arrange
  const start = plan({ tracks: { a: track('a'), b: track('b') }, trackOrder: ['b', 'a'] })

  // Act
  const next = applyOp(start, { type: 'addTracks', tracks: [track('c')] })

  // Assert
  assert.deepEqual(orderedTrackIds(next), ['b', 'a', 'c'])
})

test('re-adding an existing track leaves its place and section alone', () => {
  // Arrange
  const start = plan({
    tracks: { a: track('a', { sectionId: 's1' }), b: track('b') },
    trackOrder: ['b', 'a'],
  })

  // Act — a re-import of the same playlist.
  const next = applyOp(start, { type: 'addTracks', tracks: [track('a')] })

  // Assert
  assert.deepEqual(orderedTrackIds(next), ['b', 'a'])
  assert.equal(next.tracks.a.sectionId, 's1')
})

test('removing a source drops its songs from the order too', () => {
  // Arrange
  const start = plan({
    tracks: { a: track('a', { sourceId: 's' }), b: track('b') },
    trackOrder: ['a', 'b'],
    sources: [{ id: 's', name: 'S', owner: 'o', trackCount: 1, importedAt: 0 }],
  })

  // Act
  const next = applyOp(start, { type: 'removeSource', id: 's' })

  // Assert
  assert.deepEqual(orderedTrackIds(next), ['b'])
})

test('a song still used in the schedule survives removing its source', () => {
  // Arrange
  const start = plan({
    tracks: { a: track('a', { sourceId: 's' }) },
    trackOrder: ['a'],
    sources: [{ id: 's', name: 'S', owner: 'o', trackCount: 1, importedAt: 0 }],
    blocks: [
      {
        id: 'b1', dayId: 'd', title: '', start: '', end: '', location: '',
        category: 'Other', notes: '', entries: [{ id: 'e1', trackId: 'a', note: '' }],
      },
    ],
  })

  // Act
  const next = applyOp(start, { type: 'removeSource', id: 's' })

  // Assert
  assert.ok(next.tracks.a)
})

test('an unknown op type leaves the plan untouched', () => {
  // Arrange — a newer client sending an op this build does not know.
  const start = plan()

  // Act
  const next = applyOp(start, { type: 'somethingNew' } as unknown as Op)

  // Assert
  assert.equal(next, start)
})

test('order of independent edits by two people does not matter', () => {
  // Arrange — one person files a song, another renames a section.
  const start = plan({
    tracks: { a: track('a') },
    trackOrder: ['a'],
    sections: [{ id: 's1', name: 'Run', color: '#ef4444' }],
  })
  const mine: Op = { type: 'setTrackSection', trackIds: ['a'], sectionId: 's1' }
  const theirs: Op = { type: 'updateSection', id: 's1', patch: { name: 'Trail' } }

  // Act
  const a = applyOps(start, [mine, theirs])
  const b = applyOps(start, [theirs, mine])

  // Assert
  assert.deepEqual(a, b)
})
