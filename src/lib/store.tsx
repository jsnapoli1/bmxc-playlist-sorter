import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import type { AppState, Block, Day, Plan, Section, SourcePlaylist, Track } from './types.ts'
import type { ParsedSchedule } from './parseSchedule.ts'
import { guessCategory } from './parseSchedule.ts'
import { DEFAULT_SECTIONS, SECTION_COLORS } from './types.ts'
import { assignSection, moveTracks, orderedTrackIds, UNSORTED } from './playlistOrder.ts'
import { actionToOp } from './actionToOp.ts'
import { applyOp } from './applyOp.ts'
import { migrateState } from './planMigration.ts'
import type { Op } from './protocol.ts'

const STORAGE_KEY = 'cps.state.v1'

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function emptyPlan(name = 'Camp Week 1'): Plan {
  return {
    version: 1,
    id: uid('plan'),
    name,
    days: [],
    blocks: [],
    tracks: {},
    sources: [],
    trackOrder: [],
    sections: DEFAULT_SECTIONS.map((s) => ({ ...s, id: uid('sec') })),
    updatedAt: Date.now(),
  }
}

export type Action =
  | { type: 'createPlan'; name: string }
  | { type: 'deletePlan'; id: string }
  | { type: 'renamePlan'; id: string; name: string }
  | { type: 'setActivePlan'; id: string }
  | { type: 'duplicatePlan'; id: string }
  | { type: 'importSchedule'; parsed: ParsedSchedule; mode: 'replace' | 'append' }
  | { type: 'addDay'; label: string }
  | { type: 'updateDay'; id: string; patch: Partial<Day> }
  | { type: 'deleteDay'; id: string }
  | { type: 'moveDay'; id: string; delta: number }
  | { type: 'addBlock'; dayId: string; block?: Partial<Block> }
  | { type: 'updateBlock'; id: string; patch: Partial<Block> }
  | { type: 'deleteBlock'; id: string }
  | { type: 'moveBlockToDay'; id: string; dayId: string }
  | { type: 'sortDayByTime'; dayId: string }
  | { type: 'addTracks'; tracks: Track[] }
  | { type: 'syncTracks'; tracks: Track[]; sourceId: string }
  | { type: 'addSource'; source: SourcePlaylist }
  /**
   * Import a playlist as a new plan of its own, and switch to it. This is
   * how a plan gets created: a plan is a playlist plus the sections and
   * schedule built around it.
   */
  | { type: 'createPlanFromPlaylist'; source: SourcePlaylist; tracks: Track[] }
  | { type: 'removeSource'; id: string }
  // Master-playlist ordering. Each edit is expressed as a small operation
  // ("move these before that") rather than a whole new array, so the same
  // actions can later replay onto a shared plan without clobbering a
  // collaborator's concurrent edit.
  | { type: 'moveTracks'; trackIds: string[]; beforeId: string | null; sectionId?: string }
  | { type: 'setTrackSection'; trackIds: string[]; sectionId: string }
  | { type: 'addSection'; name: string; color?: string }
  | { type: 'updateSection'; id: string; patch: Partial<Omit<Section, 'id'>> }
  | { type: 'deleteSection'; id: string }
  | { type: 'moveSection'; id: string; delta: number }
  | { type: 'assign'; blockId: string; trackIds: string[]; index?: number }
  | { type: 'unassign'; blockId: string; entryId: string }
  | { type: 'moveEntry'; fromBlockId: string; entryId: string; toBlockId: string; toIndex: number }
  | { type: 'reorderEntry'; blockId: string; entryId: string; delta: number }
  | { type: 'setEntryNote'; blockId: string; entryId: string; note: string }
  | { type: 'setTrackNotes'; trackId: string; notes: string }
  | { type: 'clearBlockEntries'; blockId: string }
  | { type: 'replaceState'; state: AppState }

function touch(plan: Plan): Plan {
  return { ...plan, updatedAt: Date.now() }
}

function mapActive(state: AppState, fn: (plan: Plan) => Plan): AppState {
  if (!state.activePlanId) return state
  return {
    ...state,
    plans: state.plans.map((p) => (p.id === state.activePlanId ? touch(fn(p)) : p)),
  }
}

function mapBlock(plan: Plan, blockId: string, fn: (block: Block) => Block): Plan {
  return { ...plan, blocks: plan.blocks.map((b) => (b.id === blockId ? fn(b) : b)) }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'createPlan': {
      const plan = emptyPlan(action.name || `Camp Week ${state.plans.length + 1}`)
      return { plans: [...state.plans, plan], activePlanId: plan.id }
    }
    case 'duplicatePlan': {
      const source = state.plans.find((p) => p.id === action.id)
      if (!source) return state
      // Fresh ids throughout so the copy edits independently.
      const dayIdMap = new Map(source.days.map((d) => [d.id, uid('day')]))
      const copy: Plan = {
        ...source,
        id: uid('plan'),
        name: `${source.name} (copy)`,
        days: source.days.map((d) => ({ ...d, id: dayIdMap.get(d.id)! })),
        blocks: source.blocks.map((b) => ({
          ...b,
          id: uid('blk'),
          dayId: dayIdMap.get(b.dayId) ?? b.dayId,
          entries: b.entries.map((e) => ({ ...e, id: uid('ent') })),
        })),
        updatedAt: Date.now(),
      }
      return { plans: [...state.plans, copy], activePlanId: copy.id }
    }
    case 'deletePlan': {
      const plans = state.plans.filter((p) => p.id !== action.id)
      return {
        plans,
        activePlanId: state.activePlanId === action.id ? (plans[0]?.id ?? null) : state.activePlanId,
      }
    }
    case 'renamePlan':
      return {
        ...state,
        plans: state.plans.map((p) => (p.id === action.id ? touch({ ...p, name: action.name }) : p)),
      }
    case 'setActivePlan':
      return { ...state, activePlanId: action.id }

    case 'importSchedule':
      return mapActive(state, (plan) => {
        if (action.mode === 'replace') {
          return { ...plan, days: action.parsed.days, blocks: action.parsed.blocks }
        }
        return {
          ...plan,
          days: [...plan.days, ...action.parsed.days],
          blocks: [...plan.blocks, ...action.parsed.blocks],
        }
      })

    case 'addDay':
      return mapActive(state, (plan) => ({
        ...plan,
        days: [...plan.days, { id: uid('day'), label: action.label || `Day ${plan.days.length + 1}` }],
      }))
    case 'updateDay':
      return mapActive(state, (plan) => ({
        ...plan,
        days: plan.days.map((d) => (d.id === action.id ? { ...d, ...action.patch } : d)),
      }))
    case 'deleteDay':
      return mapActive(state, (plan) => ({
        ...plan,
        days: plan.days.filter((d) => d.id !== action.id),
        blocks: plan.blocks.filter((b) => b.dayId !== action.id),
      }))
    case 'moveDay':
      return mapActive(state, (plan) => {
        const idx = plan.days.findIndex((d) => d.id === action.id)
        const next = idx + action.delta
        if (idx < 0 || next < 0 || next >= plan.days.length) return plan
        const days = [...plan.days]
        const [moved] = days.splice(idx, 1)
        days.splice(next, 0, moved)
        return { ...plan, days }
      })

    case 'addBlock':
      return mapActive(state, (plan) => ({
        ...plan,
        blocks: [
          ...plan.blocks,
          {
            id: uid('blk'),
            dayId: action.dayId,
            title: 'New block',
            start: '',
            end: '',
            location: '',
            category: 'Other',
            notes: '',
            entries: [],
            ...action.block,
          },
        ],
      }))
    case 'updateBlock':
      return mapActive(state, (plan) =>
        mapBlock(plan, action.id, (b) => {
          const next = { ...b, ...action.patch }
          // Re-guess the category only while the user hasn't set one.
          if (action.patch.title !== undefined && (b.category === 'Other' || !b.category)) {
            next.category = guessCategory(next.title)
          }
          return next
        }),
      )
    case 'deleteBlock':
      return mapActive(state, (plan) => ({
        ...plan,
        blocks: plan.blocks.filter((b) => b.id !== action.id),
      }))
    case 'moveBlockToDay':
      return mapActive(state, (plan) =>
        mapBlock(plan, action.id, (b) => ({ ...b, dayId: action.dayId })),
      )
    case 'sortDayByTime':
      return mapActive(state, (plan) => {
        const inDay = plan.blocks.filter((b) => b.dayId === action.dayId)
        const sorted = [...inDay].sort((a, b) => (a.start || '99').localeCompare(b.start || '99'))
        let i = 0
        return {
          ...plan,
          blocks: plan.blocks.map((b) => (b.dayId === action.dayId ? sorted[i++] : b)),
        }
      })

    case 'addTracks':
      return mapActive(state, (plan) => {
        const tracks = { ...plan.tracks }
        // Re-importing a song must not move it: it keeps its place in the
        // order and whatever section it was filed into.
        const added: string[] = []
        for (const t of action.tracks) {
          if (!tracks[t.id]) added.push(t.id)
          tracks[t.id] = { ...tracks[t.id], ...t }
        }
        return {
          ...plan,
          tracks,
          trackOrder: [...orderedTrackIds(plan), ...added],
        }
      })
    case 'syncTracks':
      return mapActive(state, (plan) =>
        applyOp(plan, { type: 'syncTracks', tracks: action.tracks, sourceId: action.sourceId }),
      )

    case 'addSource':
      return mapActive(state, (plan) => ({
        ...plan,
        // One playlist per plan: importing into a plan replaces whatever it
        // was for rather than accumulating.
        sources: [action.source],
      }))

    case 'createPlanFromPlaylist': {
      const tracks: Record<string, Track> = {}
      for (const t of action.tracks) tracks[t.id] = t
      const plan: Plan = {
        ...emptyPlan(action.source.name),
        tracks,
        trackOrder: action.tracks.map((t) => t.id),
        sources: [action.source],
      }
      return { plans: [...state.plans, plan], activePlanId: plan.id }
    }
    case 'removeSource':
      return mapActive(state, (plan) => {
        const keep = Object.fromEntries(
          Object.entries(plan.tracks).filter(([, t]) => t.sourceId !== action.id),
        )
        // Keep any track that is still slotted somewhere in the schedule.
        for (const block of plan.blocks) {
          for (const entry of block.entries) {
            const track = plan.tracks[entry.trackId]
            if (track) keep[track.id] = track
          }
        }
        return {
          ...plan,
          sources: plan.sources.filter((s) => s.id !== action.id),
          tracks: keep,
          // Drop removed songs from the order rather than leaving ids that
          // resolve to nothing.
          trackOrder: orderedTrackIds(plan).filter((id) => keep[id]),
        }
      })

    case 'moveTracks':
      return mapActive(state, (plan) => {
        const next: Plan = {
          ...plan,
          trackOrder: moveTracks(orderedTrackIds(plan), action.trackIds, action.beforeId),
        }
        // A drop lands in whichever section it was released over, so the
        // move and the re-filing are one edit.
        if (action.sectionId === undefined) return next
        return { ...next, tracks: assignSection(next.tracks, action.trackIds, action.sectionId) }
      })

    case 'setTrackSection':
      return mapActive(state, (plan) => ({
        ...plan,
        tracks: assignSection(plan.tracks, action.trackIds, action.sectionId),
      }))

    case 'addSection':
      return mapActive(state, (plan) => {
        const sections = plan.sections ?? []
        return {
          ...plan,
          sections: [
            ...sections,
            {
              id: uid('sec'),
              name: action.name || `Section ${sections.length + 1}`,
              color: action.color ?? SECTION_COLORS[sections.length % SECTION_COLORS.length],
            },
          ],
        }
      })

    case 'updateSection':
      return mapActive(state, (plan) => ({
        ...plan,
        sections: (plan.sections ?? []).map((s) =>
          s.id === action.id ? { ...s, ...action.patch } : s,
        ),
      }))

    case 'deleteSection':
      return mapActive(state, (plan) => ({
        ...plan,
        sections: (plan.sections ?? []).filter((s) => s.id !== action.id),
        // Songs outlive their section: clear the pointer so they fall back
        // to Unsorted instead of disappearing from the list.
        tracks: assignSection(
          plan.tracks,
          Object.values(plan.tracks)
            .filter((t) => t.sectionId === action.id)
            .map((t) => t.id),
          UNSORTED,
        ),
      }))

    case 'moveSection':
      return mapActive(state, (plan) => {
        const sections = [...(plan.sections ?? [])]
        const idx = sections.findIndex((s) => s.id === action.id)
        const next = idx + action.delta
        if (idx < 0 || next < 0 || next >= sections.length) return plan
        const [moved] = sections.splice(idx, 1)
        sections.splice(next, 0, moved)
        return { ...plan, sections }
      })

    case 'assign':
      return mapActive(state, (plan) =>
        mapBlock(plan, action.blockId, (b) => {
          const additions = action.trackIds.map((trackId) => ({
            id: uid('ent'),
            trackId,
            note: '',
          }))
          const entries = [...b.entries]
          entries.splice(action.index ?? entries.length, 0, ...additions)
          return { ...b, entries }
        }),
      )
    case 'unassign':
      return mapActive(state, (plan) =>
        mapBlock(plan, action.blockId, (b) => ({
          ...b,
          entries: b.entries.filter((e) => e.id !== action.entryId),
        })),
      )
    case 'moveEntry':
      return mapActive(state, (plan) => {
        const from = plan.blocks.find((b) => b.id === action.fromBlockId)
        const entry = from?.entries.find((e) => e.id === action.entryId)
        if (!from || !entry) return plan
        return {
          ...plan,
          blocks: plan.blocks.map((b) => {
            if (b.id === action.fromBlockId && b.id === action.toBlockId) {
              const rest = b.entries.filter((e) => e.id !== action.entryId)
              rest.splice(Math.min(action.toIndex, rest.length), 0, entry)
              return { ...b, entries: rest }
            }
            if (b.id === action.fromBlockId) {
              return { ...b, entries: b.entries.filter((e) => e.id !== action.entryId) }
            }
            if (b.id === action.toBlockId) {
              const next = [...b.entries]
              next.splice(Math.min(action.toIndex, next.length), 0, entry)
              return { ...b, entries: next }
            }
            return b
          }),
        }
      })
    case 'reorderEntry':
      return mapActive(state, (plan) =>
        mapBlock(plan, action.blockId, (b) => {
          const idx = b.entries.findIndex((e) => e.id === action.entryId)
          const next = idx + action.delta
          if (idx < 0 || next < 0 || next >= b.entries.length) return b
          const entries = [...b.entries]
          const [moved] = entries.splice(idx, 1)
          entries.splice(next, 0, moved)
          return { ...b, entries }
        }),
      )
    case 'setEntryNote':
      return mapActive(state, (plan) =>
        mapBlock(plan, action.blockId, (b) => ({
          ...b,
          entries: b.entries.map((e) => (e.id === action.entryId ? { ...e, note: action.note } : e)),
        })),
      )
    case 'setTrackNotes':
      return mapActive(state, (plan) => {
        const track = plan.tracks[action.trackId]
        if (!track) return plan
        return {
          ...plan,
          tracks: { ...plan.tracks, [action.trackId]: { ...track, notes: action.notes } },
        }
      })
    case 'clearBlockEntries':
      return mapActive(state, (plan) => mapBlock(plan, action.blockId, (b) => ({ ...b, entries: [] })))

    case 'replaceState':
      return action.state
    default:
      return state
  }
}

function initialState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (Array.isArray(parsed.plans) && parsed.plans.length) {
        // Plans used to hold several playlists at once; split any that
        // still do so each playlist gets its own sections and schedule.
        return migrateState(
          {
            plans: parsed.plans,
            activePlanId: parsed.activePlanId ?? parsed.plans[0].id,
          },
          uid,
        )
      }
    }
  } catch {
    /* corrupt or unavailable storage — start fresh rather than crash */
  }
  const plan = emptyPlan()
  return { plans: [plan], activePlanId: plan.id }
}

type StoreValue = {
  state: AppState
  plan: Plan
  dispatch: (action: Action) => void
  blocksForDay: (dayId: string) => Block[]
  exportJson: () => string
  importJson: (json: string) => void
}

const StoreContext = createContext<StoreValue | null>(null)

type ProviderProps = {
  children: ReactNode
  /**
   * When set, this plan is shared: edits are sent as ops instead of being
   * applied only locally, and `sharedPlan` is the server's copy.
   */
  shared?: {
    plan: Plan | null
    send: (ops: Op[]) => void
  }
}

export function StoreProvider({ children, shared }: ProviderProps) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {
        /* quota exceeded — the export button is the escape hatch */
      }
    }, 200)
    return () => clearTimeout(id)
  }, [state])

  const localPlan = useMemo(
    () => state.plans.find((p) => p.id === state.activePlanId) ?? state.plans[0] ?? emptyPlan(),
    [state],
  )

  // A shared plan's authoritative copy is the server's; a local one is the
  // browser's. Everything downstream just reads `plan`.
  const plan = shared?.plan ?? localPlan

  /**
   * Edits go to the server when the plan is shared, and to the local
   * reducer otherwise. Actions that manage the browser's own list of plans
   * (create, duplicate, switch) always stay local.
   */
  const routedDispatch = useCallback(
    (action: Action) => {
      if (!shared) {
        dispatch(action)
        return
      }
      const op = actionToOp(action, uid)
      if (op) shared.send([op])
      else dispatch(action)
    },
    [shared],
  )

  const blocksForDay = useCallback(
    (dayId: string) => plan.blocks.filter((b) => b.dayId === dayId),
    [plan],
  )

  const exportJson = useCallback(() => JSON.stringify(state, null, 2), [state])

  const importJson = useCallback((json: string) => {
    const parsed = JSON.parse(json) as AppState | Plan
    if ('plans' in parsed && Array.isArray(parsed.plans)) {
      dispatch({
        type: 'replaceState',
        state: { plans: parsed.plans, activePlanId: parsed.activePlanId ?? parsed.plans[0]?.id ?? null },
      })
      return
    }
    if ('blocks' in parsed && Array.isArray((parsed as Plan).blocks)) {
      const single = parsed as Plan
      dispatch({ type: 'replaceState', state: { plans: [single], activePlanId: single.id } })
      return
    }
    throw new Error('That file does not look like a Camp Playlist Sorter backup.')
  }, [])

  const value = useMemo<StoreValue>(
    () => ({ state, plan, dispatch: routedDispatch, blocksForDay, exportJson, importJson }),
    [state, plan, routedDispatch, blocksForDay, exportJson, importJson],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
