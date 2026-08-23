import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { migrateState, planLabel, sourceOf, splitBySource } from '../src/lib/planMigration.ts'
import { orderedTrackIds } from '../src/lib/playlistOrder.ts'
import type { Plan, SourcePlaylist, Track } from '../src/lib/types.ts'

/** Deterministic ids so a migration can be asserted exactly. */
function counter(): (prefix: string) => string {
  let n = 0
  return (prefix) => `${prefix}_${++n}`
}

function track(id: string, sourceId?: string, over: Partial<Track> = {}): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: id,
    artists: 'A',
    album: 'B',
    durationMs: 1000,
    explicit: false,
    ...(sourceId ? { sourceId } : {}),
    ...over,
  }
}

function source(id: string, name: string): SourcePlaylist {
  return { id, name, owner: 'jack', trackCount: 0, importedAt: 0 }
}

function plan(over: Partial<Plan> = {}): Plan {
  return {
    version: 1,
    id: 'plan_original',
    name: 'Camp Week 1',
    days: [],
    blocks: [],
    tracks: {},
    sources: [],
    updatedAt: 7,
    ...over,
  }
}

test('a plan with one playlist is left alone', () => {
  // Arrange
  const p = plan({ sources: [source('s1', 'Camp 2026')], tracks: { a: track('a', 's1') } })

  // Act
  const out = splitBySource(p, counter())

  // Assert
  assert.equal(out.length, 1)
  assert.equal(out[0], p)
})

test('a plan with no playlist yet is left alone', () => {
  // Arrange
  const p = plan()

  // Act / Assert
  assert.deepEqual(splitBySource(p, counter()), [p])
})

test('two playlists split into two plans', () => {
  // Arrange
  const p = plan({
    sources: [source('s1', 'Camp 2026'), source('s2', 'Camp 2027')],
    tracks: { a: track('a', 's1'), b: track('b', 's2') },
    trackOrder: ['a', 'b'],
  })

  // Act
  const out = splitBySource(p, counter())

  // Assert
  assert.equal(out.length, 2)
  assert.deepEqual(Object.keys(out[0].tracks), ['a'])
  assert.deepEqual(Object.keys(out[1].tracks), ['b'])
})

test('each split plan is named after its playlist', () => {
  // Arrange
  const p = plan({
    sources: [source('s1', 'Camp 2026'), source('s2', 'Camp 2027')],
    tracks: { a: track('a', 's1'), b: track('b', 's2') },
  })

  // Act
  const out = splitBySource(p, counter())

  // Assert
  assert.equal(planLabel(out[0]), 'Camp 2026')
  assert.equal(planLabel(out[1]), 'Camp 2027')
})

test('the original plan keeps its id and its schedule', () => {
  // Arrange — the week someone already built must not move.
  const p = plan({
    sources: [source('s1', 'A'), source('s2', 'B')],
    tracks: { a: track('a', 's1'), b: track('b', 's2') },
    days: [{ id: 'd1', label: 'Monday' }],
    blocks: [
      { id: 'b1', dayId: 'd1', title: 'Breakfast', start: '08:00', end: '09:00',
        location: '', category: 'Meal', notes: 'keep it quiet',
        entries: [{ id: 'e1', trackId: 'a', note: 'fade at 2:10' }] },
    ],
  })

  // Act
  const out = splitBySource(p, counter())

  // Assert
  assert.equal(out[0].id, 'plan_original')
  assert.equal(out[0].blocks.length, 1)
  assert.equal(out[0].blocks[0].entries[0].note, 'fade at 2:10')
})

test('a split-off playlist starts with an empty schedule', () => {
  // Arrange
  const p = plan({
    sources: [source('s1', 'A'), source('s2', 'B')],
    tracks: { a: track('a', 's1'), b: track('b', 's2') },
    days: [{ id: 'd1', label: 'Monday' }],
    blocks: [
      { id: 'b1', dayId: 'd1', title: 'T', start: '', end: '', location: '',
        category: 'Other', notes: '', entries: [] },
    ],
  })

  // Act
  const out = splitBySource(p, counter())

  // Assert
  assert.deepEqual(out[1].days, [])
  assert.deepEqual(out[1].blocks, [])
})

test('playlist order is preserved within each split plan', () => {
  // Arrange — interleaved, and deliberately not in insertion order.
  const p = plan({
    sources: [source('s1', 'A'), source('s2', 'B')],
    tracks: {
      a: track('a', 's1'), b: track('b', 's2'),
      c: track('c', 's1'), d: track('d', 's2'),
    },
    trackOrder: ['d', 'c', 'b', 'a'],
  })

  // Act
  const out = splitBySource(p, counter())

  // Assert
  assert.deepEqual(orderedTrackIds(out[0]), ['c', 'a'])
  assert.deepEqual(orderedTrackIds(out[1]), ['d', 'b'])
})

test('section names and colors carry to every split plan', () => {
  // Arrange
  const p = plan({
    sources: [source('s1', 'A'), source('s2', 'B')],
    tracks: { a: track('a', 's1'), b: track('b', 's2') },
    sections: [
      { id: 'sec_run', name: 'Run', color: '#ef4444' },
      { id: 'sec_lake', name: 'Lake', color: '#0ea5e9' },
    ],
  })

  // Act
  const out = splitBySource(p, counter())

  // Assert
  assert.deepEqual(
    out[1].sections?.map((s) => [s.name, s.color]),
    [['Run', '#ef4444'], ['Lake', '#0ea5e9']],
  )
})

test('split plans get their own section ids', () => {
  // Arrange — otherwise renaming one plan's "Lake" would rename another's.
  const p = plan({
    sources: [source('s1', 'A'), source('s2', 'B')],
    tracks: { a: track('a', 's1'), b: track('b', 's2') },
    sections: [{ id: 'sec_run', name: 'Run', color: '#ef4444' }],
  })

  // Act
  const out = splitBySource(p, counter())

  // Assert
  assert.notEqual(out[1].sections?.[0].id, out[0].sections?.[0].id)
})

test('a filed song stays filed under the equivalent section', () => {
  // Arrange — 'b' was in Lake; after the split it must still be in Lake.
  const p = plan({
    sources: [source('s1', 'A'), source('s2', 'B')],
    tracks: {
      a: track('a', 's1'),
      b: track('b', 's2', { sectionId: 'sec_lake' }),
    },
    sections: [
      { id: 'sec_run', name: 'Run', color: '#ef4444' },
      { id: 'sec_lake', name: 'Lake', color: '#0ea5e9' },
    ],
  })

  // Act
  const out = splitBySource(p, counter())

  // Assert
  const lake = out[1].sections?.find((s) => s.name === 'Lake')
  assert.equal(out[1].tracks.b.sectionId, lake?.id)
})

test('songs with no playlist stay with the original plan', () => {
  // Arrange — manually added, or left from a removed source.
  const p = plan({
    sources: [source('s1', 'A'), source('s2', 'B')],
    tracks: {
      a: track('a', 's1'),
      b: track('b', 's2'),
      orphan: track('orphan'),
      stale: track('stale', 'deleted_source'),
    },
    trackOrder: ['a', 'b', 'orphan', 'stale'],
  })

  // Act
  const out = splitBySource(p, counter())

  // Assert
  assert.ok(out[0].tracks.orphan)
  assert.ok(out[0].tracks.stale)
  assert.equal(out[1].tracks.orphan, undefined)
})

test('migrating twice changes nothing the second time', () => {
  // Arrange — this runs on every load, so it has to be idempotent.
  const state = {
    plans: [
      plan({
        sources: [source('s1', 'A'), source('s2', 'B')],
        tracks: { a: track('a', 's1'), b: track('b', 's2') },
      }),
    ],
    activePlanId: 'plan_original',
  }

  // Act
  const once = migrateState(state, counter())
  const twice = migrateState(once, counter())

  // Assert
  assert.deepEqual(twice, once)
})

test('an already-migrated state is returned untouched', () => {
  // Arrange
  const state = {
    plans: [plan({ sources: [source('s1', 'A')] })],
    activePlanId: 'plan_original',
  }

  // Act / Assert
  assert.equal(migrateState(state, counter()), state)
})

test('migration keeps the plan that was open', () => {
  // Arrange
  const state = {
    plans: [
      plan({ id: 'plan_a', sources: [source('s1', 'A'), source('s2', 'B')],
             tracks: { a: track('a', 's1'), b: track('b', 's2') } }),
    ],
    activePlanId: 'plan_a',
  }

  // Act
  const out = migrateState(state, counter())

  // Assert
  assert.equal(out.activePlanId, 'plan_a')
  assert.ok(out.plans.some((p) => p.id === 'plan_a'))
})

test('no song is lost across a split', () => {
  // Arrange
  const p = plan({
    sources: [source('s1', 'A'), source('s2', 'B'), source('s3', 'C')],
    tracks: {
      a: track('a', 's1'), b: track('b', 's2'),
      c: track('c', 's3'), d: track('d', 's1'), e: track('e'),
    },
    trackOrder: ['a', 'b', 'c', 'd', 'e'],
  })

  // Act
  const out = splitBySource(p, counter())

  // Assert
  const seen = out.flatMap((x) => Object.keys(x.tracks)).sort()
  assert.deepEqual(seen, ['a', 'b', 'c', 'd', 'e'])
})

test('sourceOf reads the plan playlist, or null before one is imported', () => {
  // Arrange / Act / Assert
  assert.equal(sourceOf(plan()), null)
  assert.equal(sourceOf(plan({ sources: [source('s1', 'Camp')] }))?.name, 'Camp')
})

test('a plan with no playlist falls back to its own name', () => {
  // Arrange / Act / Assert
  assert.equal(planLabel(plan({ name: 'Camp Week 1' })), 'Camp Week 1')
})
