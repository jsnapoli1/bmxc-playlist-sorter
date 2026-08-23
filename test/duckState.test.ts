import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  BOOP_COOLDOWN_MS,
  boop,
  canBoop,
  initialState,
  moodFor,
  tick,
  type DuckState,
} from '../src/components/duckpal/duckState.ts'

const HOUR = 3_600_000
const T0 = 1_700_000_000_000

function state(over: Partial<DuckState> = {}): DuckState {
  return { ...initialState(T0), ...over }
}

test('decays bond and energy over elapsed time', () => {
  // Arrange
  const before = state({ bond: 80, energy: 80 })

  // Act
  const after = tick(before, T0 + 5 * HOUR, 0)

  // Assert
  assert.equal(after.bond, 70) // 80 - 5h * 2/h
  assert.equal(after.energy, 50) // 80 - 5h * 6/h
})

test('caps offline decay so a long absence does not zero the pair', () => {
  // Arrange
  const before = state({ bond: 90, energy: 90 })

  // Act - two weeks away
  const after = tick(before, T0 + 24 * 14 * HOUR, 0)

  // Assert - decay stops at the 12h cap, not 14 days' worth
  assert.equal(after.bond, 90 - 12 * 2)
  assert.equal(after.energy, 90 - 12 * 6)
})

test('never decays below zero', () => {
  const after = tick(state({ bond: 1, energy: 1 }), T0 + 12 * HOUR, 0)
  assert.equal(after.bond, 0)
  assert.equal(after.energy, 0)
})

test('rewards bond for newly placed songs', () => {
  // Arrange - no time passes, so decay cannot confound the reward
  const before = state({ bond: 50, lastPlaced: 3 })

  // Act - three more songs placed
  const after = tick(before, T0, 6)

  // Assert
  assert.equal(after.bond, 62) // 50 + 3 * 4
  assert.equal(after.lastPlaced, 6)
})

test('removing songs does not punish bond', () => {
  // Arrange
  const before = state({ bond: 50, lastPlaced: 10 })

  // Act - songs were removed from the schedule
  const after = tick(before, T0, 2)

  // Assert - bond holds, and the lower count becomes the new baseline
  assert.equal(after.bond, 50)
  assert.equal(after.lastPlaced, 2)
})

test('bond reward is clamped to the maximum', () => {
  const after = tick(state({ bond: 95, lastPlaced: 0 }), T0, 50)
  assert.equal(after.bond, 100)
})

test('boop raises energy and starts the cooldown', () => {
  // Arrange
  const before = state({ energy: 40 })

  // Act
  const after = boop(before, T0)

  // Assert
  assert.equal(after.energy, 49)
  assert.equal(after.lastBoop, T0)
})

test('boops within the cooldown are ignored', () => {
  // Arrange
  const first = boop(state({ energy: 40 }), T0)

  // Act - mash the ducks a moment later
  const second = boop(first, T0 + 1_000)

  // Assert - unchanged, and identity is preserved so React can skip a render
  assert.equal(second.energy, 49)
  assert.equal(second, first)
})

test('boop works again once the cooldown expires', () => {
  const first = boop(state({ energy: 40 }), T0)
  const second = boop(first, T0 + BOOP_COOLDOWN_MS)
  assert.equal(second.energy, 58)
})

test('canBoop reports cooldown status', () => {
  const after = boop(state(), T0)
  assert.equal(canBoop(after, T0 + 1_000), false)
  assert.equal(canBoop(after, T0 + BOOP_COOLDOWN_MS), true)
})

test('derives mood from stats', () => {
  assert.equal(moodFor({ bond: 80, energy: 80 }), 'happy')
  assert.equal(moodFor({ bond: 45, energy: 80 }), 'content')
  assert.equal(moodFor({ bond: 10, energy: 80 }), 'lonely')
  assert.equal(moodFor({ bond: 80, energy: 10 }), 'sleepy')
})

test('exhaustion reads as sleepy even when the pair is lonely', () => {
  // Both thresholds are breached; sleepiness must win so the pose is coherent.
  assert.equal(moodFor({ bond: 5, energy: 5 }), 'sleepy')
})
