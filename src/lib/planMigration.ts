/**
 * Moving old saved state onto "one playlist per plan".
 *
 * Plans used to be able to hold several imported playlists at once, sharing
 * one song library, one set of sections and one schedule. Now a plan is
 * built around a single playlist. Anything saved before that has to be
 * split, and it has to happen without losing sorting work.
 *
 * Pure functions: the caller supplies id generation, so a migration is
 * reproducible and testable.
 */

import type { AppState, Plan, SourcePlaylist, Track } from './types.ts'
import { orderedTrackIds } from './playlistOrder.ts'

/** The playlist a plan is for, or null while none has been imported. */
export function sourceOf(plan: Plan): SourcePlaylist | null {
  return plan.sources[0] ?? null
}

/** A plan's display name: the playlist's, falling back to the plan's own. */
export function planLabel(plan: Plan): string {
  return sourceOf(plan)?.name ?? plan.name
}

type IdMaker = (prefix: string) => string

/**
 * Split a plan holding several playlists into one plan per playlist.
 *
 * The first playlist keeps the original plan — including its schedule, so
 * the week someone already built stays where it was. Later playlists get a
 * fresh plan carrying their songs and a copy of the section definitions, so
 * the categories are there to sort into.
 *
 * Songs are assigned by `sourceId`. A song belonging to no imported
 * playlist (added manually, or left over from a removed source) stays with
 * the first plan rather than being dropped.
 */
export function splitBySource(plan: Plan, uid: IdMaker): Plan[] {
  if (plan.sources.length <= 1) return [plan]

  const [first, ...rest] = plan.sources
  const order = orderedTrackIds(plan)

  const tracksFor = (sourceId: string | null): Record<string, Track> => {
    const out: Record<string, Track> = {}
    for (const id of order) {
      const track = plan.tracks[id]
      if (!track) continue
      const belongs =
        sourceId === null
          ? !track.sourceId || !plan.sources.some((s) => s.id === track.sourceId)
          : track.sourceId === sourceId
      if (belongs) out[id] = track
    }
    return out
  }

  const orderFor = (tracks: Record<string, Track>): string[] => order.filter((id) => tracks[id])

  // The original plan keeps its schedule and anything unattributed.
  const firstTracks = { ...tracksFor(first.id), ...tracksFor(null) }
  const head: Plan = {
    ...plan,
    sources: [first],
    tracks: firstTracks,
    trackOrder: orderFor(firstTracks),
  }

  const tail = rest.map((source): Plan => {
    const tracks = tracksFor(source.id)
    return {
      version: 1,
      id: uid('plan'),
      name: source.name,
      // A schedule belongs to the plan that owned it; a split-off playlist
      // starts with an empty week rather than a copy someone has to prune.
      days: [],
      blocks: [],
      tracks,
      sources: [source],
      trackOrder: orderFor(tracks),
      // Fresh section ids so renaming one plan's "Lake" never touches
      // another's, but the same names and colors to sort into.
      sections: (plan.sections ?? []).map((s) => ({ ...s, id: uid('sec') })),
      updatedAt: plan.updatedAt,
    }
  })

  // Songs keep pointing at section ids from the original plan, which the
  // copies renamed. Re-point them onto each copy's own sections.
  const withRemappedSections = tail.map((copy) => {
    const from = plan.sections ?? []
    const to = copy.sections ?? []
    const map = new Map(from.map((s, idx) => [s.id, to[idx]?.id]))
    return {
      ...copy,
      tracks: Object.fromEntries(
        Object.entries(copy.tracks).map(([id, track]) => [
          id,
          track.sectionId ? { ...track, sectionId: map.get(track.sectionId) } : track,
        ]),
      ),
    }
  })

  return [head, ...withRemappedSections]
}

/**
 * Apply the split across a whole saved state.
 *
 * Idempotent: a state where every plan already holds one playlist comes
 * back unchanged, so this can run on every load.
 */
export function migrateState(state: AppState, uid: IdMaker): AppState {
  if (!state.plans.some((p) => p.sources.length > 1)) return state

  const plans = state.plans.flatMap((p) => splitBySource(p, uid))
  return {
    plans,
    // Keep whichever plan was open; splitting preserves its id.
    activePlanId: state.activePlanId ?? plans[0]?.id ?? null,
  }
}
