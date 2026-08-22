export type Track = {
  /** Spotify track id, or `local:<uuid>` for a manually added song. */
  id: string
  /** Spotify URI. Empty for local songs — they can't be pushed to Spotify. */
  uri: string
  name: string
  artists: string
  album: string
  albumArt?: string
  durationMs: number
  explicit: boolean
  previewUrl?: string | null
  /** Which imported playlist this track came from, for filtering. */
  sourceId?: string
}

/** One song slotted into one schedule block. */
export type Entry = {
  id: string
  trackId: string
  /** Cue note for whoever is running music: "fade at 2:10", "sing-along". */
  note: string
}

export type Block = {
  id: string
  dayId: string
  title: string
  /** "HH:MM" 24h, or "" when the block is untimed. */
  start: string
  end: string
  location: string
  category: string
  /** What the person on the aux cord needs to know for this block. */
  notes: string
  entries: Entry[]
}

export type Day = {
  id: string
  label: string
  /** ISO date "YYYY-MM-DD", optional. */
  date?: string
}

export type SourcePlaylist = {
  id: string
  name: string
  owner: string
  image?: string
  trackCount: number
  importedAt: number
}

export type Plan = {
  version: 1
  id: string
  name: string
  days: Day[]
  blocks: Block[]
  tracks: Record<string, Track>
  sources: SourcePlaylist[]
  updatedAt: number
}

export type AppState = {
  plans: Plan[]
  activePlanId: string | null
}

export const CATEGORIES = [
  'Wake up',
  'Meal',
  'Activity',
  'Free time',
  'All-camp',
  'Chapel / Quiet',
  'Evening program',
  'Wind down',
  'Travel',
  'Other',
] as const

/** Stable-ish color per category so the week grid is scannable. */
export const CATEGORY_COLORS: Record<string, string> = {
  'Wake up': '#f59e0b',
  Meal: '#f97316',
  Activity: '#22c55e',
  'Free time': '#38bdf8',
  'All-camp': '#a855f7',
  'Chapel / Quiet': '#94a3b8',
  'Evening program': '#6366f1',
  'Wind down': '#0ea5e9',
  Travel: '#eab308',
  Other: '#64748b',
}

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Other
}
