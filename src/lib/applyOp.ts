/**
 * Applying an `Op` to a `Plan`.
 *
 * The browser and the Worker both run this, on the same input, to reach the
 * same output — that is what makes optimistic local edits safe to confirm
 * against the server's version later. Keep it pure: no Date.now(), no
 * randomness, no I/O. Anything non-deterministic must arrive inside the op
 * (which is why ops carry client-generated ids).
 */

import type { Block, Day, Plan, Section, SourcePlaylist, Track } from './types.ts'
import type { Op } from './protocol.ts'
import { assignSection, moveTracks, orderedTrackIds, UNSORTED } from './playlistOrder.ts'

function mapBlock(plan: Plan, blockId: string, fn: (block: Block) => Block): Plan {
  return { ...plan, blocks: plan.blocks.map((b) => (b.id === blockId ? fn(b) : b)) }
}

function moveInArray<T>(items: T[], index: number, delta: number): T[] {
  const next = index + delta
  if (index < 0 || next < 0 || next >= items.length) return items
  const copy = [...items]
  const [moved] = copy.splice(index, 1)
  copy.splice(next, 0, moved)
  return copy
}

/**
 * Apply one op. Returns the plan unchanged when the op refers to something
 * that no longer exists — a collaborator may have deleted it first, and a
 * late-arriving op about it should be a no-op rather than an error.
 */
export function applyOp(plan: Plan, op: Op): Plan {
  switch (op.type) {
    case 'renamePlan':
      return { ...plan, name: op.name }

    // --- master playlist --------------------------------------------
    case 'moveTracks': {
      const next: Plan = {
        ...plan,
        trackOrder: moveTracks(orderedTrackIds(plan), op.trackIds, op.beforeId),
      }
      if (op.sectionId === undefined) return next
      return { ...next, tracks: assignSection(next.tracks, op.trackIds, op.sectionId) }
    }
    case 'setTrackSection':
      return { ...plan, tracks: assignSection(plan.tracks, op.trackIds, op.sectionId) }

    case 'addSection': {
      const sections = plan.sections ?? []
      // Replaying an already-applied add must not duplicate it.
      if (sections.some((s) => s.id === op.id)) return plan
      const section: Section = { id: op.id, name: op.name, color: op.color }
      return { ...plan, sections: [...sections, section] }
    }
    case 'updateSection':
      return {
        ...plan,
        sections: (plan.sections ?? []).map((s) => (s.id === op.id ? { ...s, ...op.patch } : s)),
      }
    case 'deleteSection':
      return {
        ...plan,
        sections: (plan.sections ?? []).filter((s) => s.id !== op.id),
        tracks: assignSection(
          plan.tracks,
          Object.values(plan.tracks)
            .filter((t) => t.sectionId === op.id)
            .map((t) => t.id),
          UNSORTED,
        ),
      }
    case 'moveSection': {
      const sections = plan.sections ?? []
      const idx = sections.findIndex((s) => s.id === op.id)
      return { ...plan, sections: moveInArray(sections, idx, op.delta) }
    }

    // --- songs --------------------------------------------------------
    case 'addTracks': {
      const tracks = { ...plan.tracks }
      const added: string[] = []
      for (const raw of op.tracks as Track[]) {
        if (!tracks[raw.id]) added.push(raw.id)
        tracks[raw.id] = { ...tracks[raw.id], ...raw }
      }
      return { ...plan, tracks, trackOrder: [...orderedTrackIds(plan), ...added] }
    }
    case 'syncTracks': {
      const incoming = op.tracks as Track[]
      const present = new Set(incoming.map((t) => t.id))

      // A song still placed on a block is kept even when it has left the
      // Spotify playlist: silently emptying part of the schedule would be
      // worse than a stale entry the run sheet can still name.
      const placed = new Set<string>()
      for (const block of plan.blocks) {
        for (const entry of block.entries) placed.add(entry.trackId)
      }

      const tracks: Record<string, Track> = {}
      for (const [id, track] of Object.entries(plan.tracks)) {
        // Only songs from this playlist are subject to removal; anything
        // imported from elsewhere is left alone.
        const mine = track.sourceId === op.sourceId
        if (!mine || present.has(id) || placed.has(id)) tracks[id] = track
      }
      for (const raw of incoming) {
        // Keep the section a song was filed into across a refresh.
        tracks[raw.id] = { ...tracks[raw.id], ...raw }
      }

      const order = orderedTrackIds(plan).filter((id) => tracks[id])
      const added = incoming.map((t) => t.id).filter((id) => !order.includes(id))

      // A song that arrived already filed into a section was placed there
      // deliberately in Spotify, so put it beside the song it followed
      // rather than at the very end — appending would file it correctly but
      // drop it to the bottom of its section, which is not where it was put.
      const incomingOrder = incoming.map((t) => t.id)
      const next = [...order]
      const appended: string[] = []
      for (const id of added) {
        const section = tracks[id]?.sectionId
        if (!section) {
          appended.push(id)
          continue
        }
        // The song it sits behind on Spotify, if that one is already placed.
        const at = incomingOrder.indexOf(id)
        let anchor = -1
        for (let i = at - 1; i >= 0 && anchor === -1; i--) {
          const candidate = next.indexOf(incomingOrder[i])
          if (candidate !== -1 && tracks[incomingOrder[i]]?.sectionId === section) anchor = candidate
        }
        if (anchor === -1) appended.push(id)
        else next.splice(anchor + 1, 0, id)
      }

      return { ...plan, tracks, trackOrder: [...next, ...appended] }
    }

    case 'addSource': {
      const source = op.source as SourcePlaylist
      return {
        ...plan,
        sources: [...plan.sources.filter((s) => s.id !== source.id), source],
      }
    }
    case 'removeSource': {
      const keep: Record<string, Track> = Object.fromEntries(
        Object.entries(plan.tracks).filter(([, t]) => t.sourceId !== op.id),
      )
      for (const block of plan.blocks) {
        for (const entry of block.entries) {
          const track = plan.tracks[entry.trackId]
          if (track) keep[track.id] = track
        }
      }
      return {
        ...plan,
        sources: plan.sources.filter((s) => s.id !== op.id),
        tracks: keep,
        trackOrder: orderedTrackIds(plan).filter((id) => keep[id]),
      }
    }

    // --- schedule -----------------------------------------------------
    case 'importSchedule': {
      const parsed = op.parsed as { days: Day[]; blocks: Block[] }
      if (op.mode === 'replace') return { ...plan, days: parsed.days, blocks: parsed.blocks }
      return {
        ...plan,
        days: [...plan.days, ...parsed.days],
        blocks: [...plan.blocks, ...parsed.blocks],
      }
    }
    case 'addDay':
      if (plan.days.some((d) => d.id === op.id)) return plan
      return { ...plan, days: [...plan.days, { id: op.id, label: op.label }] }
    case 'updateDay':
      return {
        ...plan,
        days: plan.days.map((d) => (d.id === op.id ? { ...d, ...(op.patch as Partial<Day>) } : d)),
      }
    case 'deleteDay':
      return {
        ...plan,
        days: plan.days.filter((d) => d.id !== op.id),
        blocks: plan.blocks.filter((b) => b.dayId !== op.id),
      }
    case 'moveDay': {
      const idx = plan.days.findIndex((d) => d.id === op.id)
      return { ...plan, days: moveInArray(plan.days, idx, op.delta) }
    }

    case 'addBlock': {
      if (plan.blocks.some((b) => b.id === op.id)) return plan
      const block: Block = {
        id: op.id,
        dayId: op.dayId,
        title: 'New block',
        start: '',
        end: '',
        location: '',
        category: 'Other',
        notes: '',
        entries: [],
        ...(op.block as Partial<Block> | undefined),
      }
      return { ...plan, blocks: [...plan.blocks, block] }
    }
    case 'updateBlock':
      return mapBlock(plan, op.id, (b) => ({ ...b, ...(op.patch as Partial<Block>) }))
    case 'deleteBlock':
      return { ...plan, blocks: plan.blocks.filter((b) => b.id !== op.id) }
    case 'moveBlockToDay':
      return mapBlock(plan, op.id, (b) => ({ ...b, dayId: op.dayId }))
    case 'sortDayByTime': {
      const inDay = plan.blocks.filter((b) => b.dayId === op.dayId)
      const sorted = [...inDay].sort((a, b) => (a.start || '99').localeCompare(b.start || '99'))
      let i = 0
      return {
        ...plan,
        blocks: plan.blocks.map((b) => (b.dayId === op.dayId ? sorted[i++] : b)),
      }
    }

    // --- songs on blocks ----------------------------------------------
    case 'assign':
      return mapBlock(plan, op.blockId, (b) => {
        // Entry ids come from the client so a replay is a no-op.
        const fresh = op.entryIds.filter((id) => !b.entries.some((e) => e.id === id))
        if (!fresh.length) return b
        const additions = op.trackIds
          .map((trackId, i) => ({ id: op.entryIds[i], trackId, note: '' }))
          .filter((e) => fresh.includes(e.id))
        const entries = [...b.entries]
        entries.splice(op.index ?? entries.length, 0, ...additions)
        return { ...b, entries }
      })
    case 'unassign':
      return mapBlock(plan, op.blockId, (b) => ({
        ...b,
        entries: b.entries.filter((e) => e.id !== op.entryId),
      }))
    case 'moveEntry': {
      const from = plan.blocks.find((b) => b.id === op.fromBlockId)
      const entry = from?.entries.find((e) => e.id === op.entryId)
      if (!from || !entry) return plan
      return {
        ...plan,
        blocks: plan.blocks.map((b) => {
          if (b.id === op.fromBlockId && b.id === op.toBlockId) {
            const rest = b.entries.filter((e) => e.id !== op.entryId)
            rest.splice(Math.min(op.toIndex, rest.length), 0, entry)
            return { ...b, entries: rest }
          }
          if (b.id === op.fromBlockId) {
            return { ...b, entries: b.entries.filter((e) => e.id !== op.entryId) }
          }
          if (b.id === op.toBlockId) {
            const next = [...b.entries]
            next.splice(Math.min(op.toIndex, next.length), 0, entry)
            return { ...b, entries: next }
          }
          return b
        }),
      }
    }
    case 'reorderEntry':
      return mapBlock(plan, op.blockId, (b) => {
        const idx = b.entries.findIndex((e) => e.id === op.entryId)
        return { ...b, entries: moveInArray(b.entries, idx, op.delta) }
      })
    case 'setEntryNote':
      return mapBlock(plan, op.blockId, (b) => ({
        ...b,
        entries: b.entries.map((e) => (e.id === op.entryId ? { ...e, note: op.note } : e)),
      }))
    case 'setTrackNotes': {
      const track = plan.tracks[op.trackId]
      // A note for a song that is no longer in the library is dropped
      // rather than resurrecting the song as a bare id.
      if (!track) return plan
      return {
        ...plan,
        tracks: { ...plan.tracks, [op.trackId]: { ...track, notes: op.notes } },
      }
    }
    case 'adoptOrder': {
      // The order Spotify now has, plus any section moves that order
      // implies. Applied together: adopting one without the other would let
      // the next push undo the move.
      const tracks: Record<string, Track> = { ...plan.tracks }
      for (const [id, sectionId] of Object.entries(op.sections)) {
        const track = tracks[id]
        if (!track) continue
        tracks[id] = { ...track, sectionId: sectionId ?? undefined }
      }
      // Ignore ids the plan does not know; a song can leave between the read
      // and the apply.
      const order = op.order.filter((id) => tracks[id])
      // Anything the op did not mention keeps its place at the end rather
      // than being dropped.
      const missing = orderedTrackIds(plan).filter((id) => tracks[id] && !order.includes(id))
      return { ...plan, tracks, trackOrder: [...order, ...missing] }
    }
    case 'clearBlockEntries':
      return mapBlock(plan, op.blockId, (b) => ({ ...b, entries: [] }))

    default:
      return plan
  }
}

/** Apply a batch in order. */
export function applyOps(plan: Plan, ops: Op[]): Plan {
  return ops.reduce(applyOp, plan)
}
