import { useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store.tsx'
import { detectFormat, parseSchedule, type ParsedSchedule } from '../lib/parseSchedule.ts'
import { formatRange } from '../lib/time.ts'

const SAMPLE = `Monday
7:30-8:00 Wake up @ Cabins | speaker on the porch, not inside
8:00-8:45 Breakfast @ Dining Hall
  note: keep it quiet until announcements are done
9:00-10:15 Activity Period 1 @ Waterfront
12:00-1:00 Lunch @ Dining Hall
2:00-4:00 Free swim @ Lake
8:00-9:30 Campfire @ Fire Ring | slow songs only, no explicit
9:45 Lights out

Tuesday
7:30-8:00 Wake up @ Cabins
8:00-8:45 Breakfast @ Dining Hall
9:00-11:30 All-camp game @ Field
8:00-10:00 Dance @ Rec Hall`

export default function ImportScheduleModal({ onClose }: { onClose: () => void }) {
  const { plan, dispatch } = useStore()
  const [text, setText] = useState('')
  const [forced, setForced] = useState<'auto' | 'text' | 'csv' | 'ics'>('auto')
  const [mode, setMode] = useState<'replace' | 'append'>(plan.days.length ? 'append' : 'replace')
  const fileRef = useRef<HTMLInputElement>(null)

  const parsed: ParsedSchedule | null = useMemo(() => {
    if (!text.trim()) return null
    try {
      return parseSchedule(text, forced === 'auto' ? undefined : forced)
    } catch {
      return null
    }
  }, [text, forced])

  const detected = text.trim() ? detectFormat(text) : null

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setText(await file.text())
  }

  const apply = () => {
    if (!parsed?.blocks.length) return
    dispatch({ type: 'importSchedule', parsed, mode })
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 className="grow">Import a schedule</h2>
          <button className="btn ghost" onClick={onClose}>
            ×
          </button>
        </div>

        <p className="muted tiny" style={{ marginTop: 0 }}>
          Paste your camp schedule, or upload a <strong>.csv</strong>, <strong>.txt</strong> or{' '}
          <strong>.ics</strong> calendar export. Days, times, locations and notes are picked up
          automatically — you can fix anything afterwards.
        </p>

        <div className="row wrap" style={{ marginBottom: 8 }}>
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            Upload file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.ics,.tsv,text/plain,text/calendar,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button className="btn sm ghost" onClick={() => setText(SAMPLE)}>
            Paste an example
          </button>
          <div className="grow" />
          <select
            style={{ width: 'auto' }}
            value={forced}
            onChange={(e) => setForced(e.target.value as typeof forced)}
          >
            <option value="auto">Format: auto{detected ? ` (${detected})` : ''}</option>
            <option value="text">Plain text</option>
            <option value="csv">CSV</option>
            <option value="ics">Calendar (.ics)</option>
          </select>
        </div>

        <textarea
          rows={10}
          className="mono"
          style={{ fontSize: 12.5 }}
          placeholder={'Monday\n7:30-8:00 Wake up @ Cabins\n8:00-8:45 Breakfast @ Dining Hall'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <details style={{ marginTop: 8 }}>
          <summary className="tiny faint" style={{ cursor: 'pointer' }}>
            What formats work?
          </summary>
          <ul className="tiny muted" style={{ paddingLeft: 18 }}>
            <li>
              A line with no time starts a new day (<code className="inline">Monday</code>,{' '}
              <code className="inline">Day 3</code>, <code className="inline">2026-06-22</code>).
            </li>
            <li>
              A line starting with a time is a block:{' '}
              <code className="inline">9:00-10:15 Activity Period 1</code>.
            </li>
            <li>
              <code className="inline">@ Place</code> sets a location,{' '}
              <code className="inline">| text</code> and{' '}
              <code className="inline">note:</code> lines become notes,{' '}
              <code className="inline">[Meal]</code> sets a category.
            </li>
            <li>
              CSV: any of <code className="inline">day/date</code>,{' '}
              <code className="inline">start</code>, <code className="inline">end</code>,{' '}
              <code className="inline">title/activity</code>,{' '}
              <code className="inline">location</code>, <code className="inline">notes</code>{' '}
              headers.
            </li>
            <li>Calendar exports (.ics) from Google Calendar or Outlook work directly.</li>
          </ul>
        </details>

        {parsed && (
          <>
            <div className="section-label">
              Preview — {parsed.days.length} day{parsed.days.length === 1 ? '' : 's'},{' '}
              {parsed.blocks.length} block{parsed.blocks.length === 1 ? '' : 's'}
            </div>
            {parsed.warnings.map((w) => (
              <div className="banner tiny" key={w}>
                {w}
              </div>
            ))}
            <div
              style={{
                maxHeight: 190,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 8,
              }}
            >
              {parsed.days.map((day) => (
                <div key={day.id} style={{ marginBottom: 8 }}>
                  <strong className="tiny">{day.label}</strong>
                  {parsed.blocks
                    .filter((b) => b.dayId === day.id)
                    .map((b) => (
                      <div className="tiny muted truncate" key={b.id}>
                        <span className="mono faint">{formatRange(b.start, b.end)}</span> · {b.title}
                        {b.location && ` · ${b.location}`}
                        {b.notes && ' · ✎'}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="row wrap" style={{ marginTop: 14 }}>
          {plan.days.length > 0 && (
            <select
              style={{ width: 'auto' }}
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="append">Add to existing schedule</option>
              <option value="replace">Replace existing schedule</option>
            </select>
          )}
          <div className="grow" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={apply} disabled={!parsed?.blocks.length}>
            Import {parsed?.blocks.length ? `${parsed.blocks.length} blocks` : ''}
          </button>
        </div>
        {mode === 'replace' && plan.days.length > 0 && (
          <div className="hint">
            Replacing removes the current days and blocks — any songs you already placed in them go
            with it. Your song library stays.
          </div>
        )}
      </div>
    </div>
  )
}
