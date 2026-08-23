import { useMemo, useState } from 'react'
import { useStore } from '../lib/store.tsx'
import type { Track } from '../lib/types.ts'
import { formatDuration } from '../lib/time.ts'
import { setTrackDrag } from '../lib/dnd.ts'
import { UNSORTED } from '../lib/playlistOrder.ts'

type Props = {
  /** Block that "+" adds to; null when nothing is selected. */
  selectedBlockId: string | null
  selectedBlockLabel: string | null
  onOpenImport: () => void
}

function TrackRow({
  track,
  usedCount,
  onAdd,
  canAdd,
}: {
  track: Track
  usedCount: number
  onAdd: () => void
  canAdd: boolean
}) {
  const [dragging, setDragging] = useState(false)
  return (
    <div
      className={`track${dragging ? ' dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        setTrackDrag(e, [track.id])
        setDragging(true)
      }}
      onDragEnd={() => setDragging(false)}
      title={`${track.name} — ${track.artists}`}
    >
      {track.albumArt ? (
        <img className="art" src={track.albumArt} alt="" />
      ) : (
        <div className="art">♪</div>
      )}
      <div className="track-meta">
        <div className="track-name truncate">{track.name}</div>
        <div className="track-sub truncate">
          {track.artists || 'Unknown artist'} · {formatDuration(track.durationMs)}
          {track.explicit ? ' · E' : ''}
        </div>
      </div>
      {usedCount > 0 && (
        <span className="pill" title={`Already placed in ${usedCount} block(s)`}>
          {usedCount}×
        </span>
      )}
      <button
        className="btn sm"
        onClick={onAdd}
        disabled={!canAdd}
        title={canAdd ? 'Add to the selected block' : 'Select a block first'}
      >
        +
      </button>
    </div>
  )
}

export default function SongLibrary({ selectedBlockId, selectedBlockLabel, onOpenImport }: Props) {
  const { plan, dispatch } = useStore()
  const [query, setQuery] = useState('')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [hideUsed, setHideUsed] = useState(false)

  /** trackId -> how many blocks it already appears in. */
  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const block of plan.blocks) {
      for (const entry of block.entries) {
        counts.set(entry.trackId, (counts.get(entry.trackId) ?? 0) + 1)
      }
    }
    return counts
  }, [plan.blocks])

  const tracks = useMemo(() => {
    const q = query.trim().toLowerCase()
    return Object.values(plan.tracks)
      .filter((t) => {
        // Sections come from the master playlist view; filtering by one is
        // how you fill a waterfront block from the songs marked "Lake".
        if (sectionFilter === 'all') return true
        if (sectionFilter === UNSORTED) return !t.sectionId
        return t.sectionId === sectionFilter
      })
      .filter((t) => (hideUsed ? !usage.has(t.id) : true))
      .filter((t) =>
        !q ? true : `${t.name} ${t.artists} ${t.album}`.toLowerCase().includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [plan.tracks, query, sectionFilter, hideUsed, usage])

  const total = Object.keys(plan.tracks).length
  const unplaced = total - usage.size

  return (
    <aside className="library">
      <div className="panel-head">
        <div className="panel-title">
          <span>Song library</span>
          <button className="btn sm" onClick={onOpenImport}>
            Import
          </button>
        </div>
        <input
          type="search"
          placeholder="Search songs or artists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(plan.sections ?? []).length > 0 && (
          <select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            aria-label="Filter by section"
          >
            <option value="all">All sections</option>
            {(plan.sections ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value={UNSORTED}>Unsorted</option>
          </select>
        )}
        <div className="row tiny faint" style={{ justifyContent: 'space-between' }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={hideUsed}
              onChange={(e) => setHideUsed(e.target.checked)}
            />
            Unplaced only
          </label>
          <span>{unplaced} unplaced</span>
        </div>
        {selectedBlockLabel ? (
          <div className="tiny faint truncate">
            “+” adds to <strong style={{ color: 'var(--text-dim)' }}>{selectedBlockLabel}</strong>
          </div>
        ) : (
          <div className="tiny faint">Drag a song onto a block, or select a block to use “+”.</div>
        )}
      </div>

      <div className="scroll">
        {total === 0 && (
          <div className="empty-state" style={{ margin: 12 }}>
            <p style={{ marginTop: 0 }}>No songs yet.</p>
            <button className="btn primary" onClick={onOpenImport}>
              Import a Spotify playlist
            </button>
          </div>
        )}
        {total > 0 && tracks.length === 0 && (
          <div className="empty-state" style={{ margin: 12 }}>
            Nothing matches that filter.
          </div>
        )}
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            usedCount={usage.get(track.id) ?? 0}
            canAdd={Boolean(selectedBlockId)}
            onAdd={() =>
              selectedBlockId &&
              dispatch({ type: 'assign', blockId: selectedBlockId, trackIds: [track.id] })
            }
          />
        ))}
      </div>
    </aside>
  )
}
