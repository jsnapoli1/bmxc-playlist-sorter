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
  /**
   * Which section of the master playlist this song sits in, or undefined
   * for "Unsorted". Independent of the schedule: a song's section never
   * changes because it was placed on a block.
   */
  sectionId?: string
}

/**
 * A stretch of the master playlist — "Run", "Lake". Spotify has no concept
 * of these, so they live only here; pushing to Spotify flattens them into
 * plain track order.
 */
export type Section = {
  id: string
  name: string
  /** Hex color for the header rule and the library filter chip. */
  color: string
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
  /**
   * Hand-arranged order of the master playlist, as track ids. Optional so
   * plans saved before the playlist view still load; `orderedTracks()`
   * falls back to insertion order and reconciles anything missing.
   */
  trackOrder?: string[]
  /** Sections of the master playlist, in the order they appear. */
  sections?: Section[]
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

/**
 * Sections a new plan starts with. These are a starting point, not a fixed
 * set — they can be renamed, recolored, added to and removed in the
 * playlist view.
 */
export const DEFAULT_SECTIONS: readonly { name: string; color: string }[] = [
  { name: 'Run', color: '#ef4444' },
  { name: 'Lake', color: '#0ea5e9' },
  { name: 'Vibes', color: '#a855f7' },
  { name: 'Feels', color: '#f59e0b' },
]

/** Colors offered when adding or recoloring a section. */
export const SECTION_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#0ea5e9',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#64748b',
] as const
