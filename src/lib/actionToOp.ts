/**
 * Translating a local store action into a wire op.
 *
 * The store's actions let the reducer mint ids (`uid('sec')`) as it applies
 * them. That is fine locally but wrong over the wire: two clients applying
 * the "same" action would invent different ids and diverge. So actions that
 * create something get their ids assigned *here*, before the op is sent, and
 * the op carries them.
 *
 * Returns null for actions that are purely local — switching plans, editing
 * a local-only plan — which are never shared.
 */

import type { Op } from './protocol.ts'
import type { Action } from './store.tsx'

/** Generates ids for ops that create things. Injected so tests can be exact. */
export type IdMaker = (prefix: string) => string

export function actionToOp(action: Action, uid: IdMaker): Op | null {
  switch (action.type) {
    // The op has no id: a socket is bound to exactly one plan, so the
    // server already knows which one this is.
    case 'renamePlan':
      return { type: 'renamePlan', name: action.name }

    case 'moveTracks':
      return {
        type: 'moveTracks',
        trackIds: action.trackIds,
        beforeId: action.beforeId,
        sectionId: action.sectionId,
      }
    case 'setTrackSection':
      return { type: 'setTrackSection', trackIds: action.trackIds, sectionId: action.sectionId }
    case 'addSection':
      return {
        type: 'addSection',
        id: uid('sec'),
        name: action.name,
        color: action.color ?? '#64748b',
      }
    case 'updateSection':
      return { type: 'updateSection', id: action.id, patch: action.patch }
    case 'deleteSection':
      return { type: 'deleteSection', id: action.id }
    case 'moveSection':
      return { type: 'moveSection', id: action.id, delta: action.delta }

    case 'addTracks':
      return { type: 'addTracks', tracks: action.tracks }
    case 'syncTracks':
      return { type: 'syncTracks', tracks: action.tracks, sourceId: action.sourceId }
    case 'addSource':
      return { type: 'addSource', source: action.source }
    case 'removeSource':
      return { type: 'removeSource', id: action.id }

    case 'importSchedule':
      return { type: 'importSchedule', parsed: action.parsed, mode: action.mode }
    case 'addDay':
      return { type: 'addDay', id: uid('day'), label: action.label }
    case 'updateDay':
      return { type: 'updateDay', id: action.id, patch: action.patch }
    case 'deleteDay':
      return { type: 'deleteDay', id: action.id }
    case 'moveDay':
      return { type: 'moveDay', id: action.id, delta: action.delta }

    case 'addBlock':
      return { type: 'addBlock', id: uid('blk'), dayId: action.dayId, block: action.block }
    case 'updateBlock':
      return { type: 'updateBlock', id: action.id, patch: action.patch }
    case 'deleteBlock':
      return { type: 'deleteBlock', id: action.id }
    case 'moveBlockToDay':
      return { type: 'moveBlockToDay', id: action.id, dayId: action.dayId }
    case 'sortDayByTime':
      return { type: 'sortDayByTime', dayId: action.dayId }

    case 'assign':
      return {
        type: 'assign',
        blockId: action.blockId,
        // One entry id per track, minted now so a replay is idempotent.
        entryIds: action.trackIds.map(() => uid('ent')),
        trackIds: action.trackIds,
        index: action.index,
      }
    case 'unassign':
      return { type: 'unassign', blockId: action.blockId, entryId: action.entryId }
    case 'moveEntry':
      return {
        type: 'moveEntry',
        fromBlockId: action.fromBlockId,
        entryId: action.entryId,
        toBlockId: action.toBlockId,
        toIndex: action.toIndex,
      }
    case 'reorderEntry':
      return { type: 'reorderEntry', blockId: action.blockId, entryId: action.entryId, delta: action.delta }
    case 'setEntryNote':
      return {
        type: 'setEntryNote',
        blockId: action.blockId,
        entryId: action.entryId,
        note: action.note,
      }
    case 'setTrackNotes':
      return { type: 'setTrackNotes', trackId: action.trackId, notes: action.notes }
    case 'clearBlockEntries':
      return { type: 'clearBlockEntries', blockId: action.blockId }

    // Local-only: these manage the browser's own list of plans and never
    // belong to a shared document.
    case 'createPlan':
    case 'deletePlan':
    case 'duplicatePlan':
    case 'setActivePlan':
    case 'replaceState':
      return null

    default:
      return null
  }
}
