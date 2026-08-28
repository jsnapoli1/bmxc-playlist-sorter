import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { adoptOrder } from '../src/lib/adoptSpotifyOrder.ts'

const SECTIONS = ['sec_run', 'sec_lake']

/** sectionOf built from a plain object, for readability in the cases below. */
function sectionOf(map: Record<string, string | undefined>) {
  return (id: string) => map[id]
}

test('a reorder within one section is adopted and moves nobody', () => {
  // Patrick dragged c above b, both already in Run.
  const { order, moved } = adoptOrder({
    spotifyOrder: ['a', 'c', 'b'],
    currentOrder: ['a', 'b', 'c'],
    sectionOf: sectionOf({ a: 'sec_run', b: 'sec_run', c: 'sec_run' }),
    sectionIds: SECTIONS,
  })

  assert.deepEqual(order, ['a', 'c', 'b'])
  assert.equal(moved.size, 0)
})

test('a song dragged into another section run changes section', () => {
  // 'x' was in Run; it now sits between two Lake songs, so it was carried
  // there. Adopting the order without this would let the next push move it
  // straight back.
  const { moved } = adoptOrder({
    spotifyOrder: ['a', 'l1', 'x', 'l2'],
    currentOrder: ['a', 'x', 'l1', 'l2'],
    sectionOf: sectionOf({ a: 'sec_run', x: 'sec_run', l1: 'sec_lake', l2: 'sec_lake' }),
    sectionIds: SECTIONS,
  })

  assert.equal(moved.get('x'), 'sec_lake')
})

test('a song on a boundary keeps its section', () => {
  // Neighbours disagree, so there is no run to have been carried into.
  const { moved } = adoptOrder({
    spotifyOrder: ['a', 'x', 'l1'],
    currentOrder: ['a', 'x', 'l1'],
    sectionOf: sectionOf({ a: 'sec_run', x: 'sec_run', l1: 'sec_lake' }),
    sectionIds: SECTIONS,
  })

  assert.equal(moved.size, 0)
})

test('songs Spotify does not have are kept, not dropped', () => {
  // A local-only song has no Spotify uri and never appears in the read. It
  // must survive the adopt, or reordering in Spotify would delete it.
  const { order } = adoptOrder({
    spotifyOrder: ['a', 'b'],
    currentOrder: ['a', 'local_1', 'b'],
    sectionOf: sectionOf({ a: 'sec_run', b: 'sec_run', local_1: 'sec_run' }),
    sectionIds: SECTIONS,
  })

  assert.equal(order.length, 3)
  assert.ok(order.includes('local_1'))
  // Kept behind the song it followed.
  assert.equal(order[order.indexOf('a') + 1], 'local_1')
})

test('a local-only song at the very start stays at the start', () => {
  const { order } = adoptOrder({
    spotifyOrder: ['a', 'b'],
    currentOrder: ['local_1', 'a', 'b'],
    sectionOf: sectionOf({ a: 'sec_run', b: 'sec_run', local_1: 'sec_run' }),
    sectionIds: SECTIONS,
  })

  assert.equal(order[0], 'local_1')
})

test('a section that no longer exists is treated as unsorted', () => {
  // A deleted section leaves stale sectionIds behind; they must not read as
  // a run that other songs get pulled into.
  const { moved } = adoptOrder({
    spotifyOrder: ['g1', 'x', 'g2'],
    currentOrder: ['g1', 'x', 'g2'],
    sectionOf: sectionOf({ g1: 'sec_gone', x: 'sec_run', g2: 'sec_gone' }),
    sectionIds: SECTIONS,
  })

  // Both neighbours resolve to undefined, so nothing claims 'x'.
  assert.equal(moved.get('x'), undefined)
})

test('adopting is idempotent', () => {
  // Applying the same Spotify order twice must not keep changing the plan,
  // or every poll would broadcast a fresh op forever.
  const args = {
    spotifyOrder: ['a', 'c', 'b'],
    currentOrder: ['a', 'c', 'b'],
    sectionOf: sectionOf({ a: 'sec_run', b: 'sec_run', c: 'sec_run' }),
    sectionIds: SECTIONS,
  }
  const first = adoptOrder(args)
  const second = adoptOrder({ ...args, currentOrder: first.order })

  assert.deepEqual(second.order, first.order)
  assert.equal(second.moved.size, 0)
})

test('an unsorted song pulled into a section is filed', () => {
  const { moved } = adoptOrder({
    spotifyOrder: ['r1', 'u', 'r2'],
    currentOrder: ['r1', 'r2', 'u'],
    sectionOf: sectionOf({ r1: 'sec_run', r2: 'sec_run', u: undefined }),
    sectionIds: SECTIONS,
  })

  assert.equal(moved.get('u'), 'sec_run')
})

// The convergence property. Adopting is only safe if the order the app would
// push *after* adopting equals what Spotify already has — otherwise the next
// sync rewrites the playlist and the two sides fight forever.
//
// displayOrderedTracks groups by section, so this reproduces that grouping
// over the adopted result.
function pushOrder(
  order: string[],
  sectionOf: (id: string) => string | undefined,
  sectionIds: string[],
): string[] {
  const out: string[] = []
  for (const sid of sectionIds) out.push(...order.filter((id) => sectionOf(id) === sid))
  out.push(...order.filter((id) => !sectionIds.includes(sectionOf(id) ?? '')))
  return out
}

test('after adopting, the app would push exactly what Spotify has', () => {
  // Patrick moved a Run song into the middle of the Lake run.
  const before: Record<string, string | undefined> = {
    r1: 'sec_run',
    x: 'sec_run',
    l1: 'sec_lake',
    l2: 'sec_lake',
  }
  const spotifyOrder = ['r1', 'l1', 'x', 'l2']

  const { order, moved } = adoptOrder({
    spotifyOrder,
    currentOrder: ['r1', 'x', 'l1', 'l2'],
    sectionOf: sectionOf(before),
    sectionIds: SECTIONS,
  })

  // Apply the section moves the adopt reported.
  const after = { ...before }
  for (const [id, section] of moved) after[id] = section ?? undefined

  const next = pushOrder(order, sectionOf(after), SECTIONS)

  // No moves left to make: the playlist is already how the app sees it.
  assert.deepEqual(next, spotifyOrder)
})

test('a reorder inside one section also converges', () => {
  const sections: Record<string, string | undefined> = {
    a: 'sec_run',
    b: 'sec_run',
    c: 'sec_run',
  }
  const spotifyOrder = ['c', 'a', 'b']

  const { order, moved } = adoptOrder({
    spotifyOrder,
    currentOrder: ['a', 'b', 'c'],
    sectionOf: sectionOf(sections),
    sectionIds: SECTIONS,
  })

  const after = { ...sections }
  for (const [id, section] of moved) after[id] = section ?? undefined

  assert.deepEqual(pushOrder(order, sectionOf(after), SECTIONS), spotifyOrder)
})
