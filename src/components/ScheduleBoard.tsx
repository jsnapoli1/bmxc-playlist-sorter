import { useState, type ReactNode } from 'react'
import { useStore } from '../lib/store.tsx'
import { categoryColor, type Block } from '../lib/types.ts'
import { blockMinutes, formatMinutes, formatRange, minutesOf } from '../lib/time.ts'
import { isPlannerDrag, readDrag } from '../lib/dnd.ts'

type Props = {
  selectedBlockId: string | null
  onSelectBlock: (id: string | null) => void
  onOpenImport: () => void
  /** Rendered above the days; used on mobile, where the top bar has no room. */
  toolbar?: ReactNode
}

function BlockCard({
  block,
  selected,
  onSelect,
}: {
  block: Block
  selected: boolean
  onSelect: () => void
}) {
  const { plan, dispatch } = useStore()
  const [over, setOver] = useState(false)

  const planned = block.entries.reduce(
    (sum, e) => sum + (plan.tracks[e.trackId]?.durationMs ?? 0),
    0,
  )
  const slot = blockMinutes(block.start, block.end)
  const overrun = slot !== null && planned / 60000 > slot + 0.5
  const cueCount = block.entries.filter((e) => e.note.trim()).length

  return (
    <div
      className={`block${selected ? ' selected' : ''}${over ? ' drop-target' : ''}`}
      style={{ borderLeftColor: categoryColor(block.category) }}
      onClick={onSelect}
      onDragOver={(e) => {
        if (!isPlannerDrag(e)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const payload = readDrag(e)
        if (!payload) return
        if (payload.kind === 'track') {
          dispatch({ type: 'assign', blockId: block.id, trackIds: payload.data.trackIds })
        } else if (payload.data.blockId !== block.id) {
          dispatch({
            type: 'moveEntry',
            fromBlockId: payload.data.blockId,
            entryId: payload.data.entryId,
            toBlockId: block.id,
            toIndex: Number.MAX_SAFE_INTEGER,
          })
        }
        onSelect()
      }}
    >
      <div className="block-time">
        {formatRange(block.start, block.end)}
        {slot !== null && ` · ${formatMinutes(slot)}`}
      </div>
      <div className="block-title">{block.title}</div>
      {block.location && <div className="tiny faint truncate">📍 {block.location}</div>}

      {block.entries.length > 0 && (
        <div className="mini-songs">
          {block.entries.slice(0, 4).map((entry, i) => {
            const track = plan.tracks[entry.trackId]
            return (
              <div className="mini-song truncate" key={entry.id}>
                <span className="idx">{i + 1}.</span>
                <span className="truncate">
                  {track ? `${track.name} — ${track.artists}` : 'Missing song'}
                </span>
              </div>
            )
          })}
          {block.entries.length > 4 && (
            <div className="mini-song faint">+{block.entries.length - 4} more</div>
          )}
        </div>
      )}

      <div className="block-foot">
        <span className={`songcount${block.entries.length ? '' : ' empty'}`}>
          ♪ {block.entries.length}
          {planned > 0 && ` · ${formatMinutes(planned / 60000)}`}
        </span>
        {overrun && (
          <span className="pill" style={{ color: 'var(--amber)' }} title="Music runs past this block">
            over
          </span>
        )}
        {block.notes.trim() && (
          <span className="songcount has-note" title="This block has notes">
            ✎ note
          </span>
        )}
        {cueCount > 0 && (
          <span className="songcount faint" title={`${cueCount} song cue notes`}>
            {cueCount} cue{cueCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  )
}

export default function ScheduleBoard({
  selectedBlockId,
  onSelectBlock,
  onOpenImport,
  toolbar,
}: Props) {
  const { plan, dispatch } = useStore()

  if (!plan.days.length) {
    return (
      <section className="board">
        {toolbar}
        <div className="page">
          <div className="page-inner">
            <div className="empty-state">
              <h3 style={{ marginBottom: 8 }}>No schedule yet</h3>
              <p className="muted">
                Import your camp week — paste it as text, or upload a CSV or calendar file.
              </p>
              <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
                <button className="btn primary" onClick={onOpenImport}>
                  Import a schedule
                </button>
                <button className="btn" onClick={() => dispatch({ type: 'addDay', label: 'Monday' })}>
                  Start a blank day
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="board">
      {toolbar}
      <div className="days">
        {plan.days.map((day, dayIndex) => {
          const blocks = plan.blocks
            .filter((b) => b.dayId === day.id)
            .sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
          const songTotal = blocks.reduce((n, b) => n + b.entries.length, 0)

          return (
            <div className="day" key={day.id}>
              <div className="day-head">
                <input
                  className="grow"
                  value={day.label}
                  aria-label="Day name"
                  onChange={(e) =>
                    dispatch({ type: 'updateDay', id: day.id, patch: { label: e.target.value } })
                  }
                />
                <span className="pill" title={`${songTotal} songs planned`}>
                  ♪ {songTotal}
                </span>
                <button
                  className="btn ghost icon sm"
                  title="Move day earlier"
                  disabled={dayIndex === 0}
                  onClick={() => dispatch({ type: 'moveDay', id: day.id, delta: -1 })}
                >
                  ‹
                </button>
                <button
                  className="btn ghost icon sm"
                  title="Move day later"
                  disabled={dayIndex === plan.days.length - 1}
                  onClick={() => dispatch({ type: 'moveDay', id: day.id, delta: 1 })}
                >
                  ›
                </button>
                <button
                  className="btn ghost icon sm"
                  title="Delete this day and its blocks"
                  onClick={() => {
                    if (confirm(`Delete “${day.label}” and its ${blocks.length} blocks?`)) {
                      dispatch({ type: 'deleteDay', id: day.id })
                    }
                  }}
                >
                  ×
                </button>
              </div>

              <div className="day-blocks">
                {blocks.map((block) => (
                  <BlockCard
                    key={block.id}
                    block={block}
                    selected={block.id === selectedBlockId}
                    onSelect={() => onSelectBlock(block.id)}
                  />
                ))}
                {!blocks.length && <div className="empty-state tiny">No blocks yet</div>}
                <button
                  className="btn ghost sm"
                  onClick={() => dispatch({ type: 'addBlock', dayId: day.id })}
                >
                  + Add block
                </button>
              </div>
            </div>
          )
        })}

        <div className="day" style={{ width: 180, background: 'transparent', border: 'none' }}>
          <button
            className="btn"
            onClick={() => dispatch({ type: 'addDay', label: `Day ${plan.days.length + 1}` })}
          >
            + Add day
          </button>
        </div>
      </div>
    </section>
  )
}
