import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  assignSection,
  firstIdOfSection,
  formatLongDuration,
  moveTracks,
  orderedTrackIds,
  playlistRows,
  tracksInSection,
  UNSORTED,
} from '../src/lib/playlistOrder.ts'
import type { Plan, Track } from '../src/lib/types.ts'

function track(id: string, over: Partial<Track> = {}): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: id.toUpperCase(),
    artists: 'Someone',
    album: 'An album',
    durationMs: 180_000,
    explicit: false,
    ...over,
  }
}

function plan(tracks: Track[], over: Partial<Plan> = {}): Plan {
  return {
    version: 1,
    id: 'plan_1',
    name: 'Camp Week 1',
    days: [],
    blocks: [],
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    sources: [],
    updatedAt: 0,
    ...over,
  }
}

test('a plan with no saved order reads as insertion order', () => {
  // Arrange — plans saved before the playlist view have no trackOrder.
  const p = plan([track('a'), track('b'), track('c')])

  // Act
  const ids = orderedTrackIds(p)

  // Assert
  assert.deepEqual(ids, ['a', 'b', 'c'])
})

test('saved order wins, and songs missing from it are appended', () => {
  // Arrange — 'c' was imported after the order was last written.
  const p = plan([track('a'), track('b'), track('c')], { trackOrder: ['b', 'a'] })

  // Act
  const ids = orderedTrackIds(p)

  // Assert
  assert.deepEqual(ids, ['b', 'a', 'c'])
})

test('order entries naming a deleted song are dropped', () => {
  // Arrange — 'gone' was removed with its source playlist.
  const p = plan([track('a'), track('b')], { trackOrder: ['gone', 'b', 'a'] })

  // Act
  const ids = orderedTrackIds(p)

  // Assert
  assert.deepEqual(ids, ['b', 'a'])
})

test('a duplicated id in the saved order is only used once', () => {
  // Arrange — a duplicate would otherwise render two rows with one key.
  const p = plan([track('a'), track('b')], { trackOrder: ['a', 'a', 'b'] })

  // Act
  const ids = orderedTrackIds(p)

  // Assert
  assert.deepEqual(ids, ['a', 'b'])
})

test('moveTracks drops songs before the named anchor', () => {
  // Arrange
  const order = ['a', 'b', 'c', 'd']

  // Act
  const next = moveTracks(order, ['d'], 'b')

  // Assert
  assert.deepEqual(next, ['a', 'd', 'b', 'c'])
})

test('moveTracks with a null anchor moves to the end', () => {
  // Arrange
  const order = ['a', 'b', 'c']

  // Act
  const next = moveTracks(order, ['a'], null)

  // Assert
  assert.deepEqual(next, ['b', 'c', 'a'])
})

test('a multi-song move keeps the songs in list order, not click order', () => {
  // Arrange — picked bottom-up, but they should land top-down.
  const order = ['a', 'b', 'c', 'd', 'e']

  // Act
  const next = moveTracks(order, ['d', 'b'], 'a')

  // Assert
  assert.deepEqual(next, ['b', 'd', 'a', 'c', 'e'])
})

test('dropping a song onto itself leaves the order alone', () => {
  // Arrange
  const order = ['a', 'b', 'c']

  // Act — the anchor is part of the moving set, so there is no real target.
  const next = moveTracks(order, ['b'], 'b')

  // Assert
  assert.deepEqual(next, ['a', 'c', 'b'])
})

test('moveTracks does not mutate the array it was given', () => {
  // Arrange
  const order = ['a', 'b', 'c']

  // Act
  moveTracks(order, ['c'], 'a')

  // Assert
  assert.deepEqual(order, ['a', 'b', 'c'])
})

test('moving ids that are not in the list is a no-op', () => {
  // Arrange
  const order = ['a', 'b']

  // Act
  const next = moveTracks(order, ['zzz'], 'a')

  // Assert
  assert.equal(next, order)
})

test('songs group under their section, in playlist order', () => {
  // Arrange
  const p = plan(
    [
      track('a', { sectionId: 'lake' }),
      track('b', { sectionId: 'run' }),
      track('c', { sectionId: 'lake' }),
    ],
    {
      trackOrder: ['c', 'b', 'a'],
      sections: [
        { id: 'run', name: 'Run', color: '#ef4444' },
        { id: 'lake', name: 'Lake', color: '#0ea5e9' },
      ],
    },
  )

  // Act
  const lake = tracksInSection(p, 'lake').map((t) => t.id)

  // Assert
  assert.deepEqual(lake, ['c', 'a'])
})

test('songs whose section was deleted fall back to unsorted', () => {
  // Arrange — 'ghost' is not in the sections list.
  const p = plan([track('a', { sectionId: 'ghost' }), track('b')], {
    sections: [{ id: 'run', name: 'Run', color: '#ef4444' }],
  })

  // Act
  const unsorted = tracksInSection(p, UNSORTED).map((t) => t.id)

  // Assert
  assert.deepEqual(unsorted, ['a', 'b'])
})

test('rows interleave section headers with their songs', () => {
  // Arrange
  const p = plan([track('a', { sectionId: 'run' }), track('b')], {
    trackOrder: ['a', 'b'],
    sections: [{ id: 'run', name: 'Run', color: '#ef4444' }],
  })

  // Act
  const rows = playlistRows(p)

  // Assert
  assert.deepEqual(
    rows.map((r) => (r.kind === 'header' ? `#${r.section?.name ?? 'Unsorted'}` : r.track.id)),
    ['#Run', 'a', '#Unsorted', 'b'],
  )
})

test('an empty section keeps its header as a drop target', () => {
  // Arrange — nothing is filed under Run yet.
  const p = plan([track('a')], {
    sections: [{ id: 'run', name: 'Run', color: '#ef4444' }],
  })

  // Act
  const rows = playlistRows(p)

  // Assert
  const run = rows.find((r) => r.kind === 'header' && r.section?.id === 'run')
  assert.ok(run)
  assert.equal(run.kind === 'header' && run.count, 0)
})

test('the unsorted header disappears once everything is filed', () => {
  // Arrange
  const p = plan([track('a', { sectionId: 'run' })], {
    sections: [{ id: 'run', name: 'Run', color: '#ef4444' }],
  })

  // Act
  const rows = playlistRows(p)

  // Assert
  assert.equal(rows.filter((r) => r.kind === 'header').length, 1)
})

test('a section header reports its own count and runtime', () => {
  // Arrange
  const p = plan(
    [
      track('a', { sectionId: 'run', durationMs: 200_000 }),
      track('b', { sectionId: 'run', durationMs: 100_000 }),
      track('c'),
    ],
    { sections: [{ id: 'run', name: 'Run', color: '#ef4444' }] },
  )

  // Act
  const header = playlistRows(p).find((r) => r.kind === 'header' && r.section?.id === 'run')

  // Assert
  assert.ok(header?.kind === 'header')
  assert.equal(header.count, 2)
  assert.equal(header.durationMs, 300_000)
})

test('assigning a section returns a new record and leaves the old one alone', () => {
  // Arrange
  const tracks = { a: track('a'), b: track('b') }

  // Act
  const next = assignSection(tracks, ['a'], 'lake')

  // Assert
  assert.equal(next.a.sectionId, 'lake')
  assert.equal(tracks.a.sectionId, undefined)
})

test('filing a song as unsorted clears its section', () => {
  // Arrange
  const tracks = { a: track('a', { sectionId: 'lake' }) }

  // Act
  const next = assignSection(tracks, ['a'], UNSORTED)

  // Assert
  assert.equal('sectionId' in next.a, false)
})

test('assigning a section skips ids with no matching song', () => {
  // Arrange
  const tracks = { a: track('a') }

  // Act
  const next = assignSection(tracks, ['a', 'missing'], 'run')

  // Assert
  assert.deepEqual(Object.keys(next), ['a'])
})

test('a drop onto a header targets the first song not already moving', () => {
  // Arrange
  const p = plan([track('a', { sectionId: 'run' }), track('b', { sectionId: 'run' })], {
    trackOrder: ['a', 'b'],
    sections: [{ id: 'run', name: 'Run', color: '#ef4444' }],
  })

  // Act — 'a' is being dragged, so it cannot anchor its own move.
  const anchor = firstIdOfSection(p, 'run', new Set(['a']))

  // Assert
  assert.equal(anchor, 'b')
})

test('a drop onto an empty section has no anchor and appends', () => {
  // Arrange
  const p = plan([track('a')], {
    sections: [{ id: 'run', name: 'Run', color: '#ef4444' }],
  })

  // Act
  const anchor = firstIdOfSection(p, 'run', new Set())

  // Assert
  assert.equal(anchor, null)
})

test('section runtimes read in hours and minutes', () => {
  // Arrange / Act / Assert
  assert.equal(formatLongDuration(0), '0m')
  assert.equal(formatLongDuration(47 * 60_000), '47m')
  assert.equal(formatLongDuration(60 * 60_000), '1h')
  assert.equal(formatLongDuration(134 * 60_000), '2h 14m')
})

test('a song with no duration does not poison a section total', () => {
  // Arrange — Spotify can return a local/unavailable track with no duration.
  const p = plan(
    [
      track('a', { sectionId: 'run', durationMs: 120_000 }),
      track('b', { sectionId: 'run', durationMs: undefined as unknown as number }),
    ],
    { sections: [{ id: 'run', name: 'Run', color: '#ef4444' }] },
  )

  // Act
  const header = playlistRows(p).find((r) => r.kind === 'header' && r.section?.id === 'run')

  // Assert
  assert.ok(header?.kind === 'header')
  assert.equal(header.durationMs, 120_000)
})
