/** Time + date helpers shared by the parser and the UI. */

const AMPM = /(a\.?m\.?|p\.?m\.?)$/i

/** A parsed clock time plus whether AM/PM was actually stated. */
export type ParsedClock = { hhmm: string; explicit: boolean }

/**
 * Parse a human-written time. `explicit` is false when the text left the
 * half of the day ambiguous ("2:00"), which the schedule parser later
 * resolves by reading the day in order.
 *
 * Accepts: "9", "9am", "9:05 PM", "09.05", "21:05", "0930", "1430", "noon".
 */
export function parseClock(raw: string): ParsedClock | null {
  let s = raw.trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null
  if (s === 'noon' || s === '12noon') return { hhmm: '12:00', explicit: true }
  if (s === 'midnight') return { hhmm: '00:00', explicit: true }

  let meridiem: 'am' | 'pm' | null = null
  const m = s.match(AMPM)
  if (m) {
    meridiem = m[1].startsWith('a') ? 'am' : 'pm'
    s = s.slice(0, -m[1].length)
  }
  s = s.replace(/[.]/g, ':')

  let hour: number
  let minute = 0
  let military = false

  if (s.includes(':')) {
    const [h, mm] = s.split(':')
    if (!/^\d{1,2}$/.test(h) || !/^\d{1,2}$/.test(mm)) return null
    hour = Number(h)
    minute = Number(mm)
  } else if (/^\d{1,2}$/.test(s)) {
    hour = Number(s)
  } else if (/^\d{3,4}$/.test(s) && !meridiem) {
    // Military-style 930 / 1430.
    hour = Number(s.slice(0, s.length - 2))
    minute = Number(s.slice(-2))
    military = true
  } else {
    return null
  }

  if (minute > 59) return null
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (hour > 23) return null

  // 14:00, 00:30 and 1430 can only mean one thing; a bare 2:00 cannot.
  const explicit = meridiem !== null || hour > 12 || hour === 0 || military
  return { hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, explicit }
}

/** Parse a time into "HH:MM" (24h), or null if it isn't a time. */
export function parseTime(raw: string): string | null {
  return parseClock(raw)?.hhmm ?? null
}

const RANGE_SPLIT = /\s*(?:--|—|–|−|-|\bto\b|\buntil\b)\s*/i

export type LeadingRange = {
  start: string
  end: string
  /** False when the start time did not state AM/PM. */
  startExplicit: boolean
  endExplicit: boolean
  rest: string
}

/**
 * Pull a leading time or time range off a line.
 * Returns null when the line doesn't start with a time.
 */
export function parseLeadingTimeRange(line: string): LeadingRange | null {
  // Longest plausible time-ish prefix: "12:30 p.m. - 1:45 p.m."
  const prefix = line.match(
    /^\s*((?:\d{1,2}(?:[:.]\d{2})?|noon|midnight)\s*(?:a\.?m\.?|p\.?m\.?)?)\s*((?:--|—|–|−|-|to|until)\s*(?:\d{1,2}(?:[:.]\d{2})?|noon|midnight)\s*(?:a\.?m\.?|p\.?m\.?)?)?/i,
  )
  if (!prefix || !prefix[1]) return null

  const startRaw = prefix[1]
  const start = parseClock(startRaw)
  if (!start) return null

  let end: ParsedClock | null = null
  if (prefix[2]) end = parseClock(prefix[2].replace(RANGE_SPLIT, ''))

  let rest = line.slice(prefix[0].length)
  // Drop a separator between the time and the title: "9:00 - Breakfast".
  rest = rest.replace(/^\s*[-–—:|]\s*/, '').trim()

  // A bare number followed by a word is usually a title, not a time
  // ("5 Minute Warning"). Require a real time cue to avoid eating it.
  const looksLikeTime = /[:.]|a\.?m\.?|p\.?m\.?|noon|midnight|^\s*\d{3,4}\s*$/i.test(startRaw)
  if (!looksLikeTime && !prefix[2]) return null

  return {
    start: start.hhmm,
    end: end?.hhmm ?? '',
    startExplicit: start.explicit,
    endExplicit: end?.explicit ?? true,
    rest,
  }
}

/** "14:05" -> "2:05 PM" */
export function formatTime(hhmm: string): string {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h)) return hhmm
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`
}

export function formatRange(start: string, end: string): string {
  if (!start && !end) return 'Untimed'
  if (!end) return formatTime(start)
  return `${formatTime(start)} – ${formatTime(end)}`
}

export function minutesOf(hhmm: string): number {
  if (!hhmm) return Number.MAX_SAFE_INTEGER
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Length of a block in minutes, or null if it isn't fully timed. */
export function blockMinutes(start: string, end: string): number | null {
  if (!start || !end) return null
  let diff = minutesOf(end) - minutesOf(start)
  if (diff < 0) diff += 24 * 60 // crosses midnight
  return diff
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export function isoDateToLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return `${WEEKDAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`
}
