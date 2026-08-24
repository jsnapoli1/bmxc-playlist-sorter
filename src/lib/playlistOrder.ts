/**
 * Ordering for the master playlist view.
 *
 * The plan stores songs as an unordered `tracks` record plus a `trackOrder`
 * list of ids. Keeping those two in sync is this module's job: `trackOrder`
 * can be missing entirely (plans saved before this view existed), can lag
 * behind an import, or can name songs that have since been removed. Every
 * read goes through `orderedTrackIds`, which reconciles rather than trusting.
 *
 * Pure functions only — no React, no store, no network — so the reordering
 * rules can be tested directly.
 */

import type { Plan, Section, Track } from './types.ts'

/** The id used for songs that aren't in any section. */
export const UNSORTED = '__unsorted__'

/**
 * Every track id in hand-arranged order.
 *
 * Ids in `trackOrder` come first, in their stored order; any track missing
 * from it is appended in insertion order. Ids naming a track that no longer
 * exists are dropped. A plan with no `trackOrder` therefore reads as plain
 * insertion order, which is what the library showed before.
 */
export function orderedTrackIds(plan: Plan): string[] {
  const all = Object.keys(plan.tracks)
  if (!plan.trackOrder?.length) return all

  const known = new Set(all)
  const seen = new Set<string>()
  const out: string[] = []

  for (const id of plan.trackOrder) {
    // Guard against a duplicate id as well as a stale one; either would
    // otherwise render two rows sharing a React key.
    if (known.has(id) && !seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  for (const id of all) {
    if (!seen.has(id)) out.push(id)
  }
  return out
}

/** Every track in hand-arranged order, skipping ids with no track. */
export function orderedTracks(plan: Plan): Track[] {
  return orderedTrackIds(plan)
    .map((id) => plan.tracks[id])
    .filter(Boolean)
}

/** Sections of a plan, or an empty list when it has none yet. */
export function sectionsOf(plan: Plan): Section[] {
  return plan.sections ?? []
}

/**
 * A section's tracks, in playlist order.
 *
 * Pass `UNSORTED` for songs with no section, which also catches songs whose
 * section was deleted — their `sectionId` no longer resolves, so they fall
 * back to unsorted rather than vanishing.
 */
export function tracksInSection(plan: Plan, sectionId: string): Track[] {
  const live = new Set(sectionsOf(plan).map((s) => s.id))
  return orderedTracks(plan).filter((t) => {
    const id = t.sectionId && live.has(t.sectionId) ? t.sectionId : UNSORTED
    return id === sectionId
  })
}

/** A row in the flat, header-interleaved list the playlist view renders. */
export type PlaylistRow =
  | { kind: 'header'; section: Section | null; count: number; durationMs: number }
  | { kind: 'track'; track: Track; sectionId: string; index: number }

/**
 * The master playlist as a flat list of headers and songs.
 *
 * Sections render in their stored order, each followed by its songs.
 * Unsorted goes last and is omitted entirely once it is empty, so a fully
 * sorted playlist doesn't end in a stray empty header.
 */
export function playlistRows(plan: Plan): PlaylistRow[] {
  const rows: PlaylistRow[] = []

  const push = (section: Section | null, id: string) => {
    const tracks = tracksInSection(plan, id)
    // An empty user-made section still shows its header, so there is
    // somewhere to drop the first song.
    if (section === null && tracks.length === 0) return
    rows.push({
      kind: 'header',
      section,
      count: tracks.length,
      durationMs: tracks.reduce((n, t) => n + (t.durationMs || 0), 0),
    })
    tracks.forEach((track, index) => rows.push({ kind: 'track', track, sectionId: id, index }))
  }

  for (const section of sectionsOf(plan)) push(section, section.id)
  push(null, UNSORTED)
  return rows
}

/**
 * Every track in the order the playlist view shows them: section by
 * section, in each section's own order, with unsorted songs last.
 *
 * This — not `orderedTracks` — is what Spotify should receive. `trackOrder`
 * alone is the raw drag order and says nothing about section grouping, so
 * pushing it sends songs interleaved rather than gathered under their
 * sections.
 */
export function displayOrderedTracks(plan: Plan): Track[] {
  return playlistRows(plan)
    .filter((row): row is Extract<PlaylistRow, { kind: 'track' }> => row.kind === 'track')
    .map((row) => row.track)
}

/**
 * Move `movingIds` so they sit immediately before `beforeId`, or at the end
 * when it is null. Returns a new id list; the input is not mutated.
 *
 * Moved songs keep their relative order, which is what makes dragging a
 * multi-song selection behave predictably.
 */
export function moveTracks(
  order: string[],
  movingIds: string[],
  beforeId: string | null,
): string[] {
  const moving = new Set(movingIds)
  // Preserve the order the ids appear in the list, not the order they were
  // passed, so a selection dragged upward doesn't come out reversed.
  const picked = order.filter((id) => moving.has(id))
  if (!picked.length) return order

  const rest = order.filter((id) => !moving.has(id))
  // Dropping onto a song that is itself moving would otherwise lose the
  // anchor; fall through to the end, matching "drop below everything".
  const at = beforeId === null || moving.has(beforeId) ? rest.length : rest.indexOf(beforeId)
  const index = at < 0 ? rest.length : at

  return [...rest.slice(0, index), ...picked, ...rest.slice(index)]
}

/**
 * Reassign `trackIds` to `sectionId` (or clear it for `UNSORTED`).
 * Returns a new tracks record.
 */
export function assignSection(
  tracks: Record<string, Track>,
  trackIds: string[],
  sectionId: string,
): Record<string, Track> {
  const next = { ...tracks }
  for (const id of trackIds) {
    const track = next[id]
    if (!track) continue
    if (sectionId === UNSORTED) {
      const { sectionId: _drop, ...rest } = track
      next[id] = rest
    } else {
      next[id] = { ...track, sectionId }
    }
  }
  return next
}

/**
 * Where a song dropped onto a section header should land: at the top of
 * that section, i.e. before its current first song.
 */
export function firstIdOfSection(plan: Plan, sectionId: string, excluding: Set<string>): string | null {
  const tracks = tracksInSection(plan, sectionId)
  for (const t of tracks) {
    if (!excluding.has(t.id)) return t.id
  }
  return null
}

/**
 * Total runtime of a set of tracks, in ms. Songs missing a duration count
 * as zero rather than poisoning the sum with NaN.
 */
export function totalDurationMs(tracks: Track[]): number {
  return tracks.reduce((n, t) => n + (t.durationMs || 0), 0)
}

/** "2h 14m" / "47m" — coarser than a song's m:ss, for section headers. */
export function formatLongDuration(ms: number): string {
  const minutes = Math.round(ms / 60000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
