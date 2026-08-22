/** Shared drag-and-drop payload shapes for the planner. */

export const TRACK_MIME = 'application/x-cps-track'
export const ENTRY_MIME = 'application/x-cps-entry'

export type TrackPayload = { trackIds: string[] }
export type EntryPayload = { blockId: string; entryId: string }

export function setTrackDrag(e: React.DragEvent, trackIds: string[]): void {
  e.dataTransfer.setData(TRACK_MIME, JSON.stringify({ trackIds } satisfies TrackPayload))
  e.dataTransfer.effectAllowed = 'copy'
}

export function setEntryDrag(e: React.DragEvent, payload: EntryPayload): void {
  e.dataTransfer.setData(ENTRY_MIME, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'move'
}

export function readDrag(
  e: React.DragEvent,
): { kind: 'track'; data: TrackPayload } | { kind: 'entry'; data: EntryPayload } | null {
  const track = e.dataTransfer.getData(TRACK_MIME)
  if (track) {
    try {
      return { kind: 'track', data: JSON.parse(track) as TrackPayload }
    } catch {
      return null
    }
  }
  const entry = e.dataTransfer.getData(ENTRY_MIME)
  if (entry) {
    try {
      return { kind: 'entry', data: JSON.parse(entry) as EntryPayload }
    } catch {
      return null
    }
  }
  return null
}

/** True when the drag carries something this app knows how to drop. */
export function isPlannerDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(TRACK_MIME) || e.dataTransfer.types.includes(ENTRY_MIME)
}
