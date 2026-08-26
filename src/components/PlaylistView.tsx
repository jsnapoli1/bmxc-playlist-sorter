import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store.tsx'
import type { Section, Track } from '../lib/types.ts'
import { SECTION_COLORS } from '../lib/types.ts'
import { formatDuration } from '../lib/time.ts'
import {
  firstIdOfSection,
  formatLongDuration,
  playlistRows,
  UNSORTED,
  type PlaylistRow,
} from '../lib/playlistOrder.ts'
import { isOrderDrag, readOrderDrag, setOrderDrag } from '../lib/dnd.ts'
import { useDragScroll } from '../lib/useDragScroll.ts'
import { useTouchDrag } from '../lib/useTouchDrag.ts'
import PreviewButton from './PreviewButton.tsx'

type Props = {
  onOpenImport: () => void
}

/** Where a drop would land: before a given row, or at the end of a section. */
type DropTarget = { beforeId: string | null; sectionId: string }

function SectionHeader({
  section,
  count,
  durationMs,
  isDropTarget,
  onRename,
  onRecolor,
  onDelete,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  section: Section | null
  count: number
  durationMs: number
  isDropTarget: boolean
  onRename: (name: string) => void
  onRecolor: (color: string) => void
  onDelete: () => void
  onMove: (delta: number) => void
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(section?.name ?? '')
  const [picking, setPicking] = useState(false)

  const commit = () => {
    const name = draft.trim()
    if (name) onRename(name)
    setEditing(false)
    setPicking(false)
  }

  // Unsorted is a bucket, not a real section — it can't be renamed or moved.
  const isUnsorted = section === null

  return (
    <div className={`pl-header${isDropTarget ? ' drop-into' : ''}`}>
      <span
        className="pl-swatch"
        style={{ background: isUnsorted ? 'var(--text-faint)' : section.color }}
        aria-hidden="true"
      />

      {editing && !isUnsorted ? (
        <input
          className="pl-rename"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(section.name)
              setEditing(false)
            }
          }}
          aria-label="Section name"
        />
      ) : (
        <button
          className="pl-title"
          onClick={() => {
            if (isUnsorted) return
            setDraft(section.name)
            setEditing(true)
          }}
          title={isUnsorted ? 'Songs you have not filed yet' : 'Rename this section'}
          disabled={isUnsorted}
        >
          {/* A section whose name is empty would render a zero-width button
              with nothing to click, stranding it un-renameable. Any already
              saved that way stay reachable through this placeholder. */}
          {isUnsorted ? 'Unsorted' : section.name.trim() || 'Untitled section'}
        </button>
      )}

      <span className="pl-count tiny faint">
        {count} {count === 1 ? 'song' : 'songs'}
        {count > 0 && ` · ${formatLongDuration(durationMs)}`}
      </span>

      <div className="spacer" />

      {!isUnsorted && (
        <div className="pl-header-actions">
          {picking && (
            <div className="pl-colors" role="group" aria-label="Section color">
              {SECTION_COLORS.map((c) => (
                <button
                  key={c}
                  className={`pl-color${c === section.color ? ' on' : ''}`}
                  style={{ background: c }}
                  onClick={() => {
                    onRecolor(c)
                    setPicking(false)
                  }}
                  aria-label={`Use ${c}`}
                />
              ))}
            </div>
          )}
          <button
            className="btn sm ghost"
            onClick={() => setPicking((v) => !v)}
            aria-expanded={picking}
            title="Change color"
          >
            ●
          </button>
          <button
            className="btn sm ghost"
            onClick={() => onMove(-1)}
            disabled={!canMoveUp}
            title="Move section up"
          >
            ↑
          </button>
          <button
            className="btn sm ghost"
            onClick={() => onMove(1)}
            disabled={!canMoveDown}
            title="Move section down"
          >
            ↓
          </button>
          <button
            className="btn sm ghost"
            onClick={onDelete}
            title="Delete this section — its songs move to Unsorted"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

function PlaylistTrack({
  track,
  sectionId,
  position,
  selected,
  dimmed,
  showDropLine,
  onPointerDown,
  onDragStart,
  onDragEnd,
  onTouchStart,
  onNote,
}: {
  track: Track
  sectionId: string
  position: number
  selected: boolean
  dimmed: boolean
  showDropLine: boolean
  onPointerDown: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onTouchStart: (e: React.TouchEvent) => void
  onNote: (notes: string) => void
}) {
  return (
    <div
      className={[
        'pl-track',
        selected ? ' selected' : '',
        dimmed ? ' dragging' : '',
        showDropLine ? ' drop-before' : '',
      ].join('')}
      draggable
      data-track-id={track.id}
      data-row-section={sectionId}
      onMouseDown={onPointerDown}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTouchStart={onTouchStart}
      aria-selected={selected}
    >
      <span className="pl-grip" aria-hidden="true">
        ⠿
      </span>
      <span className="pl-pos tiny faint">{position}</span>
      <PreviewButton track={track} />
      {track.albumArt ? (
        <img className="art" src={track.albumArt} alt="" />
      ) : (
        <div className="art">♪</div>
      )}
      <div className="track-meta">
        <div className="track-name truncate">{track.name}</div>
        <div className="track-sub truncate">
          {track.artists || 'Unknown artist'}
          {track.album ? ` · ${track.album}` : ''}
          {track.explicit ? ' · E' : ''}
        </div>
        {track.notes?.trim() && <div className="pl-note truncate">⊙ {track.notes}</div>}
      </div>
      {/* A prompt rather than an inline field: this row is a drag handle with
          mousedown-driven multi-select, and a focusable input inside it would
          swallow those gestures. */}
      <button
        className={`btn ghost icon sm${track.notes?.trim() ? ' has-note' : ''}`}
        title={track.notes?.trim() ? `Note: ${track.notes}` : 'Add a note about this song'}
        aria-label={track.notes?.trim() ? 'Edit song note' : 'Add song note'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          const next = window.prompt(`Note for “${track.name}”`, track.notes ?? '')
          if (next !== null) onNote(next)
        }}
      >
        ✎
      </button>
      <span className="tiny faint">{formatDuration(track.durationMs)}</span>
    </div>
  )
}

export default function PlaylistView({ onOpenImport }: Props) {
  const { plan, dispatch } = useStore()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dragging, setDragging] = useState<Set<string>>(new Set())
  // The drop target is mirrored into a ref because `drop` fires in the same
  // tick as the `dragover` that set it — reading React state there would see
  // the previous render's value and drop in the wrong place (or nowhere).
  // State drives the indicator; the ref is what the drop handler trusts.
  const [target, setTargetState] = useState<DropTarget | null>(null)
  const targetRef = useRef<DropTarget | null>(null)
  const setTarget = useCallback((next: DropTarget | null) => {
    targetRef.current = next
    setTargetState((prev) =>
      prev?.beforeId === next?.beforeId && prev?.sectionId === next?.sectionId ? prev : next,
    )
  }, [])
  // Anchor for shift-click ranges.
  const lastClicked = useRef<string | null>(null)
  const dragScroll = useDragScroll()
  const scrollRef = useRef<HTMLDivElement | null>(null)

  /**
   * Touch dragging. HTML5 drag events never fire on a touchscreen, so
   * without this the playlist cannot be sorted on a phone at all.
   */
  const touch = useTouchDrag({
    scrollRef,
    resolve: (el) => ({
      trackId: el.getAttribute('data-track-id') ?? undefined,
      sectionId: el.getAttribute('data-row-section') ?? undefined,
    }),
    selectionFor: (id) => (selected.has(id) && selected.size > 0 ? [...selected] : [id]),
    firstInSection: (sectionId, excluding) => firstIdOfSection(plan, sectionId, excluding),
    nextAfter: (id) => visibleIds[visibleIds.indexOf(id) + 1] ?? null,
    onDrop: (trackIds, to) =>
      dispatch({
        type: 'moveTracks',
        trackIds,
        beforeId: to.beforeId,
        sectionId: to.sectionId,
      }),
  })

  const rows = useMemo(() => playlistRows(plan), [plan])
  const sections = plan.sections ?? []
  const total = Object.keys(plan.tracks).length

  /** Visible track ids in render order — the basis for shift-click ranges. */
  const visibleIds = useMemo(
    () => rows.filter((r): r is Extract<PlaylistRow, { kind: 'track' }> => r.kind === 'track').map((r) => r.track.id),
    [rows],
  )

  const q = query.trim().toLowerCase()
  const matches = useCallback(
    (t: Track) => !q || `${t.name} ${t.artists} ${t.album}`.toLowerCase().includes(q),
    [q],
  )

  const select = useCallback(
    (id: string, e: React.MouseEvent) => {
      setSelected((prev) => {
        // Cmd/Ctrl toggles one song; shift extends from the last click.
        if (e.metaKey || e.ctrlKey) {
          const next = new Set(prev)
          next.has(id) ? next.delete(id) : next.add(id)
          return next
        }
        if (e.shiftKey && lastClicked.current) {
          const from = visibleIds.indexOf(lastClicked.current)
          const to = visibleIds.indexOf(id)
          if (from >= 0 && to >= 0) {
            const [lo, hi] = from < to ? [from, to] : [to, from]
            return new Set(visibleIds.slice(lo, hi + 1))
          }
        }
        // Dragging an unselected song should carry just that song, but
        // dragging one that's already part of a selection keeps the set.
        return prev.has(id) ? prev : new Set([id])
      })
      lastClicked.current = id
    },
    [visibleIds],
  )

  const beginDrag = useCallback(
    (e: React.DragEvent, id: string) => {
      const ids = selected.has(id) && selected.size > 0 ? [...selected] : [id]
      setOrderDrag(e, ids)
      setDragging(new Set(ids))
    },
    [selected],
  )

  const endDrag = useCallback(() => {
    setDragging(new Set())
    setTarget(null)
    dragScroll.stop()
  }, [setTarget, dragScroll])

  const drop = useCallback(
    (e: React.DragEvent) => {
      const payload = readOrderDrag(e)
      const to = targetRef.current
      if (!payload || !to) return
      e.preventDefault()
      e.stopPropagation()
      dispatch({
        type: 'moveTracks',
        trackIds: payload.trackIds,
        beforeId: to.beforeId,
        sectionId: to.sectionId,
      })
      endDrag()
    },
    [dispatch, endDrag],
  )

  /** Track rows accept a drop above themselves. */
  const overTrack = useCallback((e: React.DragEvent, id: string, sectionId: string) => {
    if (!isOrderDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // Past the midpoint means "after this song", which is the same as
    // "before the next one". Anchoring to the following song keeps a drop
    // at a section's last row inside that section.
    const box = e.currentTarget.getBoundingClientRect()
    const below = e.clientY > box.top + box.height / 2
    const beforeId = below ? (visibleIds[visibleIds.indexOf(id) + 1] ?? null) : id
    setTarget({ beforeId, sectionId })
  }, [visibleIds, setTarget])

  /** Headers accept a drop that files songs into that section, at the top. */
  const overHeader = useCallback(
    (e: React.DragEvent, sectionId: string) => {
      if (!isOrderDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setTarget({ beforeId: firstIdOfSection(plan, sectionId, dragging), sectionId })
    },
    [plan, dragging, setTarget],
  )

  if (total === 0) {
    return (
      <section className="playlist">
        <div className="empty-state" style={{ margin: 24 }}>
          <p style={{ marginTop: 0 }}>No playlist yet.</p>
          <p className="tiny faint">
            Pick a Spotify playlist to sort. It gets its own sections and its own
            schedule — import another later and it opens alongside this one, not on top
            of it.
          </p>
          <button className="btn primary" onClick={onOpenImport}>
            Choose a Spotify playlist
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="playlist" onDragOver={(e) => isOrderDrag(e) && e.preventDefault()} onDrop={drop}>
      <div className="panel-head pl-head">
        <div className="panel-title">
          <span>Master playlist</span>
          <span className="tiny faint">
            {total} {total === 1 ? 'song' : 'songs'}
          </span>
          <div className="spacer" />
          <button
            className="btn sm"
            onClick={() =>
              // Named and coloured here so the shared and local paths agree.
              // An empty name reached the wire unchanged and produced a
              // section that could not be clicked to rename.
              dispatch({
                type: 'addSection',
                name: `Section ${(plan.sections?.length ?? 0) + 1}`,
                color: SECTION_COLORS[(plan.sections?.length ?? 0) % SECTION_COLORS.length],
              })
            }
          >
            + Section
          </button>
          <button className="btn sm" onClick={onOpenImport}>
            Import
          </button>
        </div>
        <input
          type="search"
          placeholder="Find a song to file…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tiny faint">
          {selected.size > 0 ? (
            <>
              {selected.size} selected — drag to a section, or{' '}
              <button className="linklike" onClick={() => setSelected(new Set())}>
                clear
              </button>
            </>
          ) : (
            <span>
              <span className="only-desktop">
                Drag songs to reorder. Shift-click or ⌘-click to move several at once.
              </span>
              <span className="only-mobile">Press and hold a song to move it.</span>
            </span>
          )}
        </div>
      </div>

      <div
        className="scroll pl-scroll"
        ref={(node) => {
          scrollRef.current = node
          dragScroll.ref(node)
        }}
        onDragOver={(e) => {
          if (!isOrderDrag(e)) return
          e.preventDefault()
          dragScroll.update(e.clientY)
        }}
        onDragLeave={dragScroll.stop}
        onDrop={dragScroll.stop}
      >
        {rows.map((row) => {
          if (row.kind === 'header') {
            const id = row.section?.id ?? UNSORTED
            const idx = sections.findIndex((s) => s.id === id)
            return (
              <div
                key={`h_${id}`}
                data-section-id={id}
                onDragOver={(e) => overHeader(e, id)}
                onDrop={drop}
              >
                <SectionHeader
                  section={row.section}
                  count={row.count}
                  durationMs={row.durationMs}
                  isDropTarget={
                    (target?.sectionId === id && target.beforeId === null) ||
                    touch.state.overSection === id
                  }
                  onRename={(name) => dispatch({ type: 'updateSection', id, patch: { name } })}
                  onRecolor={(color) => dispatch({ type: 'updateSection', id, patch: { color } })}
                  onDelete={() => dispatch({ type: 'deleteSection', id })}
                  onMove={(delta) => dispatch({ type: 'moveSection', id, delta })}
                  canMoveUp={idx > 0}
                  canMoveDown={idx >= 0 && idx < sections.length - 1}
                />
                {/* An empty section is otherwise a 1px-tall drop target,
                    which matters most at the start when every section is
                    empty and everything is unsorted. */}
                {row.count === 0 && (
                  <div className={`pl-empty${target?.sectionId === id ? ' drop-into' : ''}`}>
                    Drop songs here
                  </div>
                )}
              </div>
            )
          }

          const { track, sectionId, index } = row
          // Searching filters what you see without collapsing the sections,
          // so a song stays findable in the context it lives in.
          if (!matches(track)) return null
          return (
            <div
              key={track.id}
              onDragOver={(e) => overTrack(e, track.id, sectionId)}
              onDrop={drop}
            >
              <PlaylistTrack
                track={track}
                sectionId={sectionId}
                position={index + 1}
                selected={selected.has(track.id)}
                dimmed={dragging.has(track.id) || touch.state.dragging.includes(track.id)}
                showDropLine={
                  target?.beforeId === track.id ||
                  (touch.state.over?.id === track.id && !touch.state.over.below)
                }
                onPointerDown={(e) => select(track.id, e)}
                onDragStart={(e) => beginDrag(e, track.id)}
                onDragEnd={endDrag}
                onTouchStart={(e) => touch.onTouchStart(e, track.id)}
                onNote={(notes) => dispatch({ type: 'setTrackNotes', trackId: track.id, notes })}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
