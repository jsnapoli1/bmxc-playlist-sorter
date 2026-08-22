import type { Block, Day } from './types.ts'
import { WEEKDAYS, isoDateToLabel, minutesOf, parseClock, parseLeadingTimeRange } from './time.ts'

export type ParsedSchedule = {
  days: Day[]
  blocks: Block[]
  warnings: string[]
  format: 'text' | 'csv' | 'ics'
}

let counter = 0
function uid(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}

/** Keyword -> category, so an imported schedule arrives pre-colored. */
const CATEGORY_HINTS: [RegExp, string][] = [
  [/wake|reveille|rise\s*(and|&)\s*shine|morning bell/i, 'Wake up'],
  [/breakfast|lunch|dinner|supper|brunch|meal|canteen|snack/i, 'Meal'],
  [/free\s*time|free\s*swim|rest hour|siesta|open rec|hang/i, 'Free time'],
  [/chapel|devotion|quiet|vespers|worship|reflection|prayer/i, 'Chapel / Quiet'],
  [/campfire|evening|night\s*game|dance|banquet|talent|skit|carnival/i, 'Evening program'],
  [/all[-\s]?camp|assembly|flag|announcement|opening|closing|ceremony/i, 'All-camp'],
  [/lights\s*out|bedtime|cabin (chat|time)|wind\s*down|taps/i, 'Wind down'],
  [/bus|travel|departure|arrival|check[-\s]?in|check[-\s]?out|drive/i, 'Travel'],
  [/activity|period|elective|workshop|class|session|sports|swim|climb|arts/i, 'Activity'],
]

export function guessCategory(title: string): string {
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(title)) return cat
  return 'Other'
}

function newBlock(dayId: string, partial: Partial<Block> = {}): Block {
  const title = partial.title ?? 'Untitled'
  return {
    id: uid('blk'),
    dayId,
    title,
    start: '',
    end: '',
    location: '',
    category: guessCategory(title),
    notes: '',
    entries: [],
    ...partial,
  }
}

/** Per-block record of which times were written without AM/PM. */
type Ambiguity = Map<string, { start: boolean; end: boolean }>

function shift12(hhmm: string): string | null {
  const [h, m] = hhmm.split(':').map(Number)
  const next = h + 12
  if (next > 23) return null
  return `${String(next).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Camp schedules are written "2:00-4:00 Free swim", meaning the afternoon.
 * A day is read top to bottom, so any bare time that would move the clock
 * backwards is nudged forward twelve hours. Times that stated AM/PM, or that
 * could only be 24-hour, are never touched.
 */
export function resolveAmbiguousTimes(
  days: Day[],
  blocks: Block[],
  ambiguity: Ambiguity,
): string[] {
  const adjusted: string[] = []

  for (const day of days) {
    let clock = -1
    for (const block of blocks.filter((b) => b.dayId === day.id)) {
      const flags = ambiguity.get(block.id) ?? { start: false, end: false }

      if (block.start) {
        if (flags.start && minutesOf(block.start) < clock) {
          const bumped = shift12(block.start)
          if (bumped && minutesOf(bumped) >= clock) {
            adjusted.push(`${day.label} · ${block.title}: read ${block.start} as ${bumped}`)
            block.start = bumped
          }
        }
        clock = Math.max(clock, minutesOf(block.start))
      }

      if (block.end) {
        if (flags.end && minutesOf(block.end) < minutesOf(block.start)) {
          const bumped = shift12(block.end)
          if (bumped && minutesOf(bumped) > minutesOf(block.start)) block.end = bumped
        }
        clock = Math.max(clock, minutesOf(block.end))
      }
    }
  }
  return adjusted
}

function summarizeAdjustments(adjusted: string[]): string[] {
  if (!adjusted.length) return []
  const shown = adjusted.slice(0, 3).join('; ')
  const more = adjusted.length > 3 ? `, and ${adjusted.length - 3} more` : ''
  return [
    `Times without AM/PM were read in schedule order — ${shown}${more}. Fix any that look wrong after importing.`,
  ]
}

// ---------------------------------------------------------------- day headers

const DATE_PATTERNS: RegExp[] = [
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/,
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}/i,
  /^day\s*\d+/i,
]

function looksLikeDayHeader(line: string): boolean {
  const s = line.replace(/[:•\-–—*#]+$/g, '').replace(/^[#*•\s]+/, '').trim()
  if (!s) return false
  if (s.length > 60) return false
  const first = s.split(/[\s,]+/)[0]
  if (WEEKDAYS.some((d) => new RegExp(`^${d.slice(0, 3)}`, 'i').test(first))) return true
  return DATE_PATTERNS.some((re) => re.test(s))
}

function normalizeDayLabel(line: string): string {
  return line.replace(/^[#*•\s]+/, '').replace(/[:•\s]+$/g, '').trim() || 'Day'
}

// ------------------------------------------------------------------ text form

function parseText(text: string): ParsedSchedule {
  const days: Day[] = []
  const blocks: Block[] = []
  const warnings: string[] = []
  const ambiguity: Ambiguity = new Map()
  let current: Day | null = null
  let lastBlock: Block | null = null

  const ensureDay = (label: string): Day => {
    const day: Day = { id: uid('day'), label }
    days.push(day)
    return day
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ')
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('//')) continue

    // Continuation note: "> ...", "note: ...", or a bullet under a block.
    const noteMatch = trimmed.match(/^(?:>|note\s*:|\*|•)\s*(.+)$/i)
    if (noteMatch && lastBlock) {
      lastBlock.notes = lastBlock.notes ? `${lastBlock.notes}\n${noteMatch[1]}` : noteMatch[1]
      continue
    }

    const timed = parseLeadingTimeRange(trimmed)
    if (!timed) {
      if (looksLikeDayHeader(trimmed) || !current) {
        current = ensureDay(normalizeDayLabel(trimmed))
        lastBlock = null
      } else {
        // Untimed line inside a day: still a block (e.g. "Cabin cleanup").
        lastBlock = newBlock(current.id, { title: trimmed })
        blocks.push(lastBlock)
      }
      continue
    }

    if (!current) current = ensureDay('Day 1')

    let rest = timed.rest
    let category = ''
    const catTag = rest.match(/\[([^\]]+)\]/)
    if (catTag) {
      category = catTag[1].trim()
      rest = rest.replace(catTag[0], ' ').trim()
    }

    // `|` splits title | location | notes; `@` marks a location.
    const parts = rest.split('|').map((p) => p.trim())
    let title = parts[0] ?? ''
    let location = ''
    let notes = parts.slice(1).join(' — ')

    const at = title.match(/\s+@\s*(.+)$/)
    if (at) {
      location = at[1].trim()
      title = title.slice(0, at.index).trim()
    }
    if (!location && parts[1] && parts.length > 2) {
      location = parts[1]
      notes = parts.slice(2).join(' — ')
    }
    if (!title) title = 'Untitled'

    lastBlock = newBlock(current.id, {
      title,
      start: timed.start,
      end: timed.end,
      location,
      notes,
      category: category || guessCategory(title),
    })
    ambiguity.set(lastBlock.id, { start: !timed.startExplicit, end: !timed.endExplicit })
    blocks.push(lastBlock)
  }

  if (!blocks.length) warnings.push('No time-stamped rows were found in that text.')
  warnings.push(...summarizeAdjustments(resolveAmbiguousTimes(days, blocks, ambiguity)))
  return { days, blocks, warnings, format: 'text' }
}

// ------------------------------------------------------------------- CSV form

/** Minimal RFC-4180 reader: handles quoted fields, embedded commas/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const HEADER_ALIASES: Record<string, string[]> = {
  day: ['day', 'date', 'weekday', 'when'],
  start: ['start', 'start time', 'from', 'begin', 'time'],
  end: ['end', 'end time', 'to', 'finish', 'until'],
  title: ['title', 'event', 'activity', 'name', 'block', 'session', 'summary'],
  location: ['location', 'place', 'where', 'venue', 'area'],
  category: ['category', 'type', 'kind', 'tag'],
  notes: ['notes', 'note', 'description', 'details', 'comment', 'info'],
}

function headerIndex(headers: string[]): Record<string, number> {
  const norm = headers.map((h) => h.trim().toLowerCase())
  const out: Record<string, number> = {}
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = norm.findIndex((h) => aliases.includes(h))
    if (idx >= 0) out[key] = idx
  }
  return out
}

function looksLikeCsvHeader(row: string[]): boolean {
  const map = headerIndex(row)
  return map.title !== undefined || (map.day !== undefined && map.start !== undefined)
}

function parseCsvSchedule(text: string): ParsedSchedule {
  const rows = parseCsv(text)
  const warnings: string[] = []
  if (!rows.length) return { days: [], blocks: [], warnings: ['That file was empty.'], format: 'csv' }

  let map = headerIndex(rows[0])
  let body = rows
  if (looksLikeCsvHeader(rows[0])) body = rows.slice(1)
  else {
    // Positional fallback: day, start, end, title, location, notes
    map = { day: 0, start: 1, end: 2, title: 3, location: 4, notes: 5 }
    warnings.push('No header row detected — read columns as day, start, end, title, location, notes.')
  }

  const days: Day[] = []
  const byLabel = new Map<string, Day>()
  const blocks: Block[] = []
  const ambiguity: Ambiguity = new Map()

  const dayFor = (label: string): Day => {
    const key = label.trim().toLowerCase() || 'day 1'
    const existing = byLabel.get(key)
    if (existing) return existing
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(label.trim())
    const day: Day = {
      id: uid('day'),
      label: iso ? isoDateToLabel(label.trim()) : label.trim() || 'Day 1',
      date: iso ? label.trim() : undefined,
    }
    byLabel.set(key, day)
    days.push(day)
    return day
  }

  for (const row of body) {
    const cell = (key: string) => (map[key] === undefined ? '' : (row[map[key]] ?? '').trim())
    const title = cell('title') || 'Untitled'
    const day = dayFor(cell('day') || 'Day 1')

    // A single "time" column may hold a whole range.
    const startClock = parseClock(cell('start'))
    const endClock = parseClock(cell('end'))
    let start = startClock?.hhmm ?? ''
    let end = endClock?.hhmm ?? ''
    let startExplicit = startClock?.explicit ?? true
    let endExplicit = endClock?.explicit ?? true
    if (!start && cell('start')) {
      const range = parseLeadingTimeRange(cell('start'))
      if (range) {
        start = range.start
        startExplicit = range.startExplicit
        if (!end) {
          end = range.end
          endExplicit = range.endExplicit
        }
      }
    }

    const block = newBlock(day.id, {
      title,
      start,
      end,
      location: cell('location'),
      notes: cell('notes'),
      category: cell('category') || guessCategory(title),
    })
    ambiguity.set(block.id, { start: !startExplicit, end: !endExplicit })
    blocks.push(block)
  }

  if (!blocks.length) warnings.push('No rows found in that CSV.')
  warnings.push(...summarizeAdjustments(resolveAmbiguousTimes(days, blocks, ambiguity)))
  return { days, blocks, warnings, format: 'csv' }
}

// ------------------------------------------------------------------- ICS form

function unfoldIcs(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1)
    else out.push(line)
  }
  return out
}

function icsValue(line: string): { key: string; value: string } {
  const idx = line.indexOf(':')
  if (idx === -1) return { key: line, value: '' }
  const key = line.slice(0, idx).split(';')[0].toUpperCase()
  const value = line
    .slice(idx + 1)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\;/g, ';')
    .replace(/\\\\/g, '\\')
  return { key, value }
}

function parseIcsDate(raw: string): { iso: string; time: string } | null {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/)
  if (!m) return null
  return {
    iso: `${m[1]}-${m[2]}-${m[3]}`,
    time: m[4] ? `${m[4]}:${m[5]}` : '',
  }
}

function parseIcs(text: string): ParsedSchedule {
  const lines = unfoldIcs(text)
  const days: Day[] = []
  const byDate = new Map<string, Day>()
  const blocks: Block[] = []
  const warnings: string[] = []

  let inEvent = false
  let cur: Record<string, string> = {}

  const flush = () => {
    const startInfo = cur.DTSTART ? parseIcsDate(cur.DTSTART) : null
    if (!startInfo) {
      warnings.push(`Skipped an event with no start time${cur.SUMMARY ? `: ${cur.SUMMARY}` : ''}.`)
      return
    }
    const endInfo = cur.DTEND ? parseIcsDate(cur.DTEND) : null
    let day = byDate.get(startInfo.iso)
    if (!day) {
      day = { id: uid('day'), label: isoDateToLabel(startInfo.iso), date: startInfo.iso }
      byDate.set(startInfo.iso, day)
      days.push(day)
    }
    const title = cur.SUMMARY || 'Untitled'
    blocks.push(
      newBlock(day.id, {
        title,
        start: startInfo.time,
        end: endInfo && endInfo.iso === startInfo.iso ? endInfo.time : (endInfo?.time ?? ''),
        location: cur.LOCATION ?? '',
        notes: cur.DESCRIPTION ?? '',
        category: guessCategory(title),
      }),
    )
  }

  for (const line of lines) {
    const { key, value } = icsValue(line)
    if (key === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      inEvent = true
      cur = {}
      continue
    }
    if (key === 'END' && value.toUpperCase() === 'VEVENT') {
      inEvent = false
      flush()
      continue
    }
    if (inEvent) cur[key] = value
  }

  days.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  if (!blocks.length) warnings.push('No calendar events found in that file.')
  return { days, blocks, warnings, format: 'ics' }
}

// ---------------------------------------------------------------- entry point

export function detectFormat(text: string): 'text' | 'csv' | 'ics' {
  const head = text.trimStart().slice(0, 200).toUpperCase()
  if (head.includes('BEGIN:VCALENDAR') || head.includes('BEGIN:VEVENT')) return 'ics'
  const rows = parseCsv(text.split(/\r?\n/).slice(0, 5).join('\n'))
  if (rows.length && rows[0].length >= 3 && rows.every((r) => r.length >= 3)) return 'csv'
  return 'text'
}

/** Parse pasted or uploaded schedule text. Format is sniffed unless forced. */
export function parseSchedule(text: string, format?: 'text' | 'csv' | 'ics'): ParsedSchedule {
  const fmt = format ?? detectFormat(text)
  if (fmt === 'ics') return parseIcs(text)
  if (fmt === 'csv') return parseCsvSchedule(text)
  return parseText(text)
}
