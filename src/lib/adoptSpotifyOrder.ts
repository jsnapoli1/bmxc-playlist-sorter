/**
 * Taking an order edited in the Spotify app back into the plan.
 *
 * Sync used to be one-directional: the app pushed its order and any reorder
 * made in Spotify was silently reverted on the next push. Someone tuning the
 * playlist in Spotify would see their work shuffled back with no explanation.
 *
 * Adopting the order is not just storing the new list. The app pushes songs
 * *grouped by section*, so Spotify's flat order is a sequence of section
 * runs. Moving a song across a boundary there is a statement about which
 * section it belongs to now — and if only the order were adopted while the
 * section stayed put, the very next push would move it straight back.
 */

export type SectionOf = (trackId: string) => string | undefined

/**
 * Where each song sits after adopting `spotifyOrder`.
 *
 * Returns the new track order and any songs whose section changed as a
 * result. Songs the plan knows but Spotify does not (local-only songs, or
 * ones still placed on a block) keep their place relative to the songs
 * around them rather than being dropped.
 */
export function adoptOrder(args: {
  /** Track ids in the order Spotify now reports them. */
  spotifyOrder: string[]
  /** The plan's current order, including songs Spotify does not have. */
  currentOrder: string[]
  /** Section a song is currently filed under, or undefined for Unsorted. */
  sectionOf: SectionOf
  /** Section ids that exist, in the order the app lays them out. */
  sectionIds: string[]
}): { order: string[]; moved: Map<string, string | undefined> } {
  const { spotifyOrder, currentOrder, sectionOf, sectionIds } = args

  const onSpotify = new Set(spotifyOrder)
  const moved = new Map<string, string | undefined>()

  // Which section each position in Spotify's list belongs to, read from the
  // songs whose section is unambiguous. A song sitting inside a run of one
  // section has been moved into it.
  const runSection = sectionRuns(spotifyOrder, sectionOf, sectionIds)
  for (const [id, section] of runSection) {
    if (section !== sectionOf(id)) moved.set(id, section)
  }

  // Songs the plan has but Spotify does not must not vanish. Keep them
  // anchored behind whichever known song they currently follow.
  const order: string[] = [...spotifyOrder]
  const absent = currentOrder.filter((id) => !onSpotify.has(id))
  for (const id of absent) {
    const at = currentOrder.indexOf(id)
    let anchor = -1
    for (let i = at - 1; i >= 0 && anchor === -1; i--) {
      const candidate = order.indexOf(currentOrder[i])
      if (candidate !== -1) anchor = candidate
    }
    if (anchor === -1) order.unshift(id)
    else order.splice(anchor + 1, 0, id)
  }

  return { order, moved }
}

/**
 * The section each song belongs to after the reorder, judged by the run it
 * now sits in.
 *
 * A song keeps its own section when its neighbours agree with it. It changes
 * only when it has clearly been carried into a different run — both nearest
 * neighbours on either side belong to one other section. Boundaries and
 * ambiguity leave a song where it was, for the same reason the add-time
 * inference is conservative: guessing wrong reshuffles someone's work.
 */
function sectionRuns(
  order: string[],
  sectionOf: SectionOf,
  sectionIds: string[],
): Map<string, string | undefined> {
  const live = new Set(sectionIds)
  const out = new Map<string, string | undefined>()
  const sectionAt = (i: number): string | undefined => {
    const s = sectionOf(order[i])
    return s && live.has(s) ? s : undefined
  }

  for (let i = 0; i < order.length; i++) {
    const own = sectionAt(i)
    const before = i > 0 ? sectionAt(i - 1) : undefined
    const after = i < order.length - 1 ? sectionAt(i + 1) : undefined

    // Inside a run that disagrees with this song: it was moved here.
    if (before !== undefined && before === after && before !== own) {
      out.set(order[i], before)
      continue
    }
    out.set(order[i], own)
  }
  return out
}
