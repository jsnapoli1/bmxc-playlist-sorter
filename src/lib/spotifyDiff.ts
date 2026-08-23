/**
 * Turning a desired playlist order into Spotify reorder calls.
 *
 * Spotify has no "set the whole order" endpoint. `PUT /playlists/{id}/items`
 * moves a run of items from one index to another, so reaching a target order
 * means issuing a sequence of moves, each of which shifts everything after
 * it. This module computes that sequence against a simulated copy of the
 * list, so the indices it emits are the ones Spotify will actually see.
 *
 * Pure — no network. The caller performs the moves.
 */

/** One `PUT /playlists/{id}/items` call. */
export type ReorderMove = {
  range_start: number
  insert_before: number
  range_length: number
}

/**
 * Moves that transform `current` into `target`.
 *
 * Both are lists of the same items (compared by string id). Items in
 * `current` that are absent from `target` are ignored — they stay wherever
 * Spotify has them, which keeps a song someone added in the Spotify app
 * from being silently deleted.
 *
 * Uses selection-sort order: walk the target from the top, and whenever the
 * item that belongs at position i is elsewhere, move it there. That is at
 * most one move per out-of-place item.
 */
export function reorderMoves(current: string[], target: string[]): ReorderMove[] {
  // Only reorder what Spotify actually has, in the order the app wants.
  const present = new Set(current)
  const wanted = target.filter((id) => present.has(id))

  // Anything Spotify has but the app does not know about keeps its relative
  // place at the end, so we never try to move it.
  const working = [...current]
  const moves: ReorderMove[] = []

  for (let i = 0; i < wanted.length; i++) {
    const id = wanted[i]
    const from = working.indexOf(id, i)
    // Already in place, or not found past the sorted prefix.
    if (from === i || from === -1) continue

    moves.push({ range_start: from, insert_before: i, range_length: 1 })

    // Mirror Spotify's own semantics: remove, then insert at the index the
    // caller asked for, computed against the list *after* the removal when
    // moving downward.
    const [moved] = working.splice(from, 1)
    working.splice(i, 0, moved)
  }

  return moves
}

/**
 * True when `current` already matches `target` for every item they share —
 * i.e. there is nothing to push.
 */
export function isInSync(current: string[], target: string[]): boolean {
  return reorderMoves(current, target).length === 0
}

/**
 * Apply a move the way Spotify does, for tests and for simulating a
 * partially-applied sequence after a failure.
 */
export function applyMove(items: string[], move: ReorderMove): string[] {
  const next = [...items]
  const chunk = next.splice(move.range_start, move.range_length)
  // Removing the chunk shifts everything after it left by range_length.
  const insertAt =
    move.insert_before > move.range_start ? move.insert_before - move.range_length : move.insert_before
  next.splice(insertAt, 0, ...chunk)
  return next
}

/** Items in `target` that Spotify's playlist does not contain. */
export function missingFromSpotify(current: string[], target: string[]): string[] {
  const have = new Set(current)
  return target.filter((id) => !have.has(id))
}

/** Items Spotify has that the app's order does not mention. */
export function extraOnSpotify(current: string[], target: string[]): string[] {
  const want = new Set(target)
  return current.filter((id) => !want.has(id))
}
