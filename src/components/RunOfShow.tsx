import { useMemo, useState } from 'react'
import { useStore } from '../lib/store.tsx'
import { categoryColor } from '../lib/types.ts'
import { formatDuration, formatMinutes, formatRange, minutesOf } from '../lib/time.ts'

/**
 * The read-only view for whoever is actually running music: every block in
 * order, its notes, and the songs with their cue notes. Prints cleanly.
 */
export default function RunOfShow() {
  const { plan } = useStore()
  const [dayFilter, setDayFilter] = useState('all')
  const [onlyWithSongs, setOnlyWithSongs] = useState(false)
  const [showNotes, setShowNotes] = useState(true)

  const days = useMemo(
    () => plan.days.filter((d) => dayFilter === 'all' || d.id === dayFilter),
    [plan.days, dayFilter],
  )

  const totals = useMemo(() => {
    const songs = plan.blocks.reduce((n, b) => n + b.entries.length, 0)
    const blocksWithMusic = plan.blocks.filter((b) => b.entries.length).length
    const ms = plan.blocks.reduce(
      (sum, b) => sum + b.entries.reduce((s, e) => s + (plan.tracks[e.trackId]?.durationMs ?? 0), 0),
      0,
    )
    return { songs, blocksWithMusic, minutes: ms / 60000 }
  }, [plan])

  const copyAsText = async () => {
    const lines: string[] = [plan.name, '']
    for (const day of days) {
      lines.push(day.label.toUpperCase())
      const blocks = plan.blocks
        .filter((b) => b.dayId === day.id)
        .filter((b) => !onlyWithSongs || b.entries.length)
        .sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
      for (const block of blocks) {
        lines.push(`${formatRange(block.start, block.end)}  ${block.title}${block.location ? ` (${block.location})` : ''}`)
        if (showNotes && block.notes.trim()) {
          for (const line of block.notes.split('\n')) lines.push(`    ! ${line}`)
        }
        block.entries.forEach((entry, i) => {
          const track = plan.tracks[entry.trackId]
          lines.push(`    ${i + 1}. ${track ? `${track.name} — ${track.artists}` : 'Missing song'}${entry.note.trim() ? `  [${entry.note.trim()}]` : ''}`)
        })
        lines.push('')
      }
      lines.push('')
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      alert('Run sheet copied to your clipboard.')
    } catch {
      alert('Could not access the clipboard in this browser.')
    }
  }

  if (!plan.days.length) {
    return (
      <div className="page">
        <div className="page-inner">
          <div className="empty-state">Import a schedule first — then this becomes your run sheet.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="runsheet">
        <div className="row wrap no-print" style={{ marginBottom: 16 }}>
          <select style={{ width: 'auto' }} value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}>
            <option value="all">Whole week</option>
            {plan.days.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <label className="toggle tiny">
            <input
              type="checkbox"
              checked={onlyWithSongs}
              onChange={(e) => setOnlyWithSongs(e.target.checked)}
            />
            Only blocks with music
          </label>
          <label className="toggle tiny">
            <input type="checkbox" checked={showNotes} onChange={(e) => setShowNotes(e.target.checked)} />
            Show notes
          </label>
          <div className="grow" />
          <button className="btn sm" onClick={() => void copyAsText()}>
            Copy as text
          </button>
          <button className="btn sm" onClick={() => window.print()}>
            Print / PDF
          </button>
        </div>

        <h1 style={{ marginBottom: 4 }}>{plan.name}</h1>
        <p className="muted tiny" style={{ marginTop: 0 }}>
          {totals.songs} song{totals.songs === 1 ? '' : 's'} across {totals.blocksWithMusic} block
          {totals.blocksWithMusic === 1 ? '' : 's'} · {formatMinutes(totals.minutes)} of music
        </p>

        {days.map((day) => {
          const blocks = plan.blocks
            .filter((b) => b.dayId === day.id)
            .filter((b) => !onlyWithSongs || b.entries.length)
            .sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
          if (!blocks.length) return null

          return (
            <section className="run-day" key={day.id}>
              <h2>{day.label}</h2>
              {blocks.map((block) => (
                <article className="run-block" key={block.id}>
                  <div className="run-when">
                    <div>{formatRange(block.start, block.end)}</div>
                    <span className="pill" style={{ marginTop: 4 }}>
                      <span className="dot" style={{ background: categoryColor(block.category) }} />
                      {block.category}
                    </span>
                  </div>
                  <div>
                    <div className="run-title">{block.title}</div>
                    {block.location && <div className="tiny muted">📍 {block.location}</div>}

                    {showNotes && block.notes.trim() && <div className="run-note">{block.notes}</div>}

                    {block.entries.length > 0 ? (
                      <ol className="run-songs">
                        {block.entries.map((entry, i) => {
                          const track = plan.tracks[entry.trackId]
                          return (
                            <li key={entry.id}>
                              <span className="num">{i + 1}.</span>
                              <span>
                                <strong>{track?.name ?? 'Song not in library'}</strong>
                                {track?.artists ? ` — ${track.artists}` : ''}
                                {track ? (
                                  <span className="faint tiny"> · {formatDuration(track.durationMs)}</span>
                                ) : null}
                                {entry.note.trim() && <div className="cue">↳ {entry.note}</div>}
                              </span>
                            </li>
                          )
                        })}
                      </ol>
                    ) : (
                      <div className="tiny faint" style={{ marginTop: 6 }}>
                        No music planned
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
