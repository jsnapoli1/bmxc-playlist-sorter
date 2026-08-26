import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { actionToOp } from '../src/lib/actionToOp.ts'

/** Predictable ids so an op can be asserted exactly. */
function counter(): (prefix: string) => string {
  let n = 0
  return (prefix) => `${prefix}_${++n}`
}

test('a new section always reaches the wire with a name', () => {
  // The bug: PlaylistView dispatched addSection with an empty name, the
  // local reducer substituted "Section N", but actionToOp passed the empty
  // string straight through. A shared plan got a nameless section, which
  // rendered as a zero-width button with nothing to click — created, then
  // impossible to rename.
  const op = actionToOp({ type: 'addSection', name: '' }, counter())
  assert.equal(op?.type, 'addSection')
  assert.notEqual((op as { name: string }).name, '')
})

test('a section name the user supplied is kept as-is', () => {
  const op = actionToOp({ type: 'addSection', name: 'Lake' }, counter())
  assert.equal((op as { name: string }).name, 'Lake')
})

test('a new section always has a colour', () => {
  const op = actionToOp({ type: 'addSection', name: 'Run' }, counter())
  assert.match((op as { color: string }).color, /^#[0-9a-f]{6}$/i)
})

test('ids for created things are minted before the op is sent', () => {
  // Two clients applying the "same" action must not invent different ids.
  const op = actionToOp({ type: 'addSection', name: 'Vibes' }, counter())
  assert.equal((op as { id: string }).id, 'sec_1')
})

test('renaming a section carries only the patch', () => {
  const op = actionToOp(
    { type: 'updateSection', id: 'sec_1', patch: { name: 'Feels' } },
    counter(),
  )
  assert.deepEqual(op, { type: 'updateSection', id: 'sec_1', patch: { name: 'Feels' } })
})

test('browser-local plan management is never shared', () => {
  // These manage the browser's own list of plans; sending them would mean
  // one person switching plans switched everyone.
  for (const type of ['createPlan', 'deletePlan', 'duplicatePlan', 'setActivePlan'] as const) {
    assert.equal(actionToOp({ type, id: 'plan_1', name: 'x' } as never, counter()), null, type)
  }
})
