// Pure state maths for the DuckPal companion. Kept free of React and of
// `Date.now()` so it can be tested by feeding in timestamps.

export type Mood = 'happy' | 'content' | 'sleepy' | 'lonely'

export type DuckState = {
  bond: number
  energy: number
  /** When we last ran a tick, as epoch ms. */
  lastTick: number
  /** Placed-song count at the last tick, so we can reward increases. */
  lastPlaced: number
  /** Epoch ms of the most recent boop, for rate limiting. */
  lastBoop: number
  dismissed: boolean
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Both stats run 0-100. */
export const MAX_STAT = 100

/** Per-hour decay. Energy fades faster than affection does. */
const BOND_DECAY_PER_HOUR = 2
const ENERGY_DECAY_PER_HOUR = 6

/**
 * Coming back after a long break should find the ducks droopy, not dead - a
 * two-week holiday shouldn't zero a pet you spent a month raising.
 */
const MAX_OFFLINE_DECAY_HOURS = 12

/** A boop is worth this much energy, at most once per cooldown. */
const BOOP_ENERGY = 9
export const BOOP_COOLDOWN_MS = 20_000

/** Each newly placed song feeds the pair this much bond. */
const BOND_PER_PLACED_SONG = 4

const MOOD_SLEEPY_BELOW = 25
const MOOD_LONELY_BELOW = 30
const MOOD_HAPPY_AT_OR_ABOVE = 65

const clamp = (n: number) => Math.max(0, Math.min(MAX_STAT, n))

export function initialState(now: number, placed = 0): DuckState {
  return {
    bond: 55,
    energy: 70,
    lastTick: now,
    lastPlaced: placed,
    lastBoop: 0,
    dismissed: false,
  }
}

/**
 * Mood is derived, never stored, so it can never disagree with the stats.
 * Sleepiness wins over loneliness: a duck too tired to stand reads as asleep
 * regardless of how it feels about its neighbour.
 */
export function moodFor(state: Pick<DuckState, 'bond' | 'energy'>): Mood {
  if (state.energy < MOOD_SLEEPY_BELOW) return 'sleepy'
  if (state.bond < MOOD_LONELY_BELOW) return 'lonely'
  if (state.bond >= MOOD_HAPPY_AT_OR_ABOVE && state.energy >= MOOD_SLEEPY_BELOW) return 'happy'
  return 'content'
}

export function moodLabel(mood: Mood): string {
  switch (mood) {
    case 'happy':
      return 'smitten'
    case 'content':
      return 'pottering about'
    case 'sleepy':
      return 'napping'
    case 'lonely':
      return 'missing you'
  }
}

/**
 * Advance the simulation to `now`, applying time decay and rewarding any songs
 * placed since the last tick. Pure: returns a new state, never mutates.
 */
export function tick(state: DuckState, now: number, placed: number): DuckState {
  const elapsedMs = Math.max(0, now - state.lastTick)
  const hours = Math.min(elapsedMs / HOUR, MAX_OFFLINE_DECAY_HOURS)

  // Placing songs is the main way the pair is fed. Only increases count, so
  // deleting songs never punishes the ducks.
  const newlyPlaced = Math.max(0, placed - state.lastPlaced)

  return {
    ...state,
    bond: clamp(state.bond - hours * BOND_DECAY_PER_HOUR + newlyPlaced * BOND_PER_PLACED_SONG),
    energy: clamp(state.energy - hours * ENERGY_DECAY_PER_HOUR),
    lastTick: now,
    lastPlaced: placed,
  }
}

/**
 * Boop the ducks. Rate limited so the meter can't be filled by mashing, which
 * would make the whole stat model meaningless.
 */
export function boop(state: DuckState, now: number): DuckState {
  if (now - state.lastBoop < BOOP_COOLDOWN_MS) return state
  return { ...state, energy: clamp(state.energy + BOOP_ENERGY), lastBoop: now }
}

export function canBoop(state: DuckState, now: number): boolean {
  return now - state.lastBoop >= BOOP_COOLDOWN_MS
}
