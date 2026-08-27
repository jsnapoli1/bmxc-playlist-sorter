/**
 * Working out which section a song added in the Spotify app belongs to.
 *
 * The app pushes songs to Spotify grouped by section (see
 * `displayOrderedTracks`), so the playlist on Spotify is a run of section A,
 * then a run of section B, and so on. That means a song dropped into the
 * middle of one of those runs carries its intent in its position: whoever
 * added it there meant it to sit in that part of the week.
 *
 * Before this, every song added in Spotify landed in Unsorted no matter
 * where it was placed, and had to be filed by hand.
 */

/** A song already known to the plan, with the section it is filed under. */
export type Placed = { id: string; sectionId: string | undefined }

/**
 * The section a newly seen song should join, given the order Spotify now
 * reports and what the app already knows.
 *
 * The rule is "between two songs of the same section, join it" — deliberately
 * conservative:
 *
 *  - Neighbours disagreeing means the song is on a boundary, and guessing
 *    which side was meant would be wrong about half the time.
 *  - A song at the very start or end has only one neighbour, so there is no
 *    run to be inside of — appending to Spotify is the ordinary way to add a
 *    song and implies nothing about sections.
 *
 * Everything unresolved returns undefined, which is Unsorted: the same
 * behaviour as before, so this can only ever reduce manual filing.
 */
export function inferredSection(
  spotifyOrder: string[],
  known: Map<string, Placed>,
  newId: string,
): string | undefined {
  const at = spotifyOrder.indexOf(newId)
  if (at <= 0 || at >= spotifyOrder.length - 1) return undefined

  // Skip past other new songs: pasting three songs into the middle of a
  // section should file all three, not just give up because they neighbour
  // each other.
  const before = nearestKnown(spotifyOrder, known, at, -1)
  const after = nearestKnown(spotifyOrder, known, at, 1)
  if (!before || !after) return undefined

  const a = before.sectionId
  const b = after.sectionId
  if (!a || !b || a !== b) return undefined
  return a
}

function nearestKnown(
  order: string[],
  known: Map<string, Placed>,
  from: number,
  step: -1 | 1,
): Placed | undefined {
  for (let i = from + step; i >= 0 && i < order.length; i += step) {
    const found = known.get(order[i])
    if (found) return found
  }
  return undefined
}

/**
 * Sections for every song in `newIds`, resolved together.
 *
 * Returned as a map rather than applied here so the caller stays in charge
 * of building the op.
 */
export function inferSections(
  spotifyOrder: string[],
  known: Map<string, Placed>,
  newIds: string[],
): Map<string, string> {
  const out = new Map<string, string>()
  for (const id of newIds) {
    const section = inferredSection(spotifyOrder, known, id)
    if (section) out.set(id, section)
  }
  return out
}
