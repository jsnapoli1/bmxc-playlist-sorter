/**
 * Finding a 30-second sample for a song.
 *
 * Spotify used to hand out `preview_url` with every track, but stopped
 * serving it to apps created after 27 November 2024, so for a new app that
 * field is null on essentially everything. When it is missing we look the
 * song up in Apple's iTunes Search API, which returns a 30-second clip,
 * needs no key, and costs nothing.
 *
 * The match is by title and artist text, so it is a different recording of
 * the same song rather than Spotify's own audio. Close enough to remember
 * how a song goes, which is the point — but it can miss, and a miss is
 * reported honestly rather than silently playing the wrong thing.
 */

import type { Track } from './types.ts'

const ITUNES_SEARCH = 'https://itunes.apple.com/search'

/** How long a lookup may take before we give up and call it a miss. */
const LOOKUP_TIMEOUT_MS = 8_000

export type PreviewResult =
  | { status: 'found'; url: string; source: 'spotify' | 'itunes'; matched?: string }
  | { status: 'none'; reason: string }

/** Cache per track id, so a song is only ever looked up once per session. */
const cache = new Map<string, PreviewResult>()
/** In-flight lookups, so clicking twice does not fire two requests. */
const inFlight = new Map<string, Promise<PreviewResult>>()

/**
 * Strip the noise that stops a Spotify title matching an iTunes one:
 * "(Remastered 2011)", "- Live", featured artists, and so on.
 */
export function cleanTitle(name: string): string {
  return name
    .replace(/\s*[([][^)\]]*\b(remaster|remastered|live|radio edit|mono|stereo|version|deluxe|bonus|explicit)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s*-\s*\b(remaster(ed)?|live|radio edit|single version|album version)\b.*$/i, '')
    .replace(/\s*[([]feat\.?[^)\]]*[)\]]/gi, '')
    .replace(/\s*\bfeat\.?\s+.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Just the first credited artist — iTunes matches better without the rest. */
export function primaryArtist(artists: string): string {
  return artists.split(/\s*(?:,|&|feat\.?|ft\.?|x)\s+/i)[0]?.trim() ?? ''
}

/** Loose comparison so "Island In the Sun" matches "Island in the Sun". */
function normalise(value: string): string {
  return value
    .toLowerCase()
    // Apostrophes are dropped, not turned into a space, so "Don't" and
    // "Dont" normalise the same way — Spotify and iTunes disagree about
    // typographic vs ASCII ones constantly.
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * True when an iTunes hit is plausibly the same song.
 *
 * iTunes returns its best guess even when that guess is poor, so without a
 * check a mistyped camp song could quietly play something unrelated. One
 * title must be a whole-word prefix of the other: that accepts the
 * subtitles iTunes likes to append ("Oceans (Where Feet May Fail)") while
 * rejecting a merely similar word ("Home" vs "Homeward Bound").
 */
export function isPlausibleMatch(wantTitle: string, gotTitle: string): boolean {
  const want = normalise(wantTitle)
  const got = normalise(gotTitle)
  if (!want || !got) return false
  if (want === got) return true

  const [shorter, longer] = want.length <= got.length ? [want, got] : [got, want]
  // Compare on word boundaries so the shorter title has to be a run of
  // whole words at the start of the longer one.
  return longer.startsWith(`${shorter} `)
}

type ItunesHit = { trackName?: string; artistName?: string; previewUrl?: string }

/** Ask iTunes for a preview. Returns null rather than throwing. */
async function lookupItunes(track: Track, signal: AbortSignal): Promise<PreviewResult> {
  const title = cleanTitle(track.name)
  const artist = primaryArtist(track.artists)
  const term = `${title} ${artist}`.trim()
  if (!term) return { status: 'none', reason: 'This song has no title to search for.' }

  const url = `${ITUNES_SEARCH}?${new URLSearchParams({
    term,
    entity: 'song',
    limit: '5',
  })}`

  const res = await fetch(url, { signal })
  if (!res.ok) {
    return { status: 'none', reason: `Preview search failed (${res.status}).` }
  }
  // iTunes serves this as text/javascript, so parse the text ourselves
  // rather than relying on res.json() honouring the content type.
  const body = (await res.text()).trim()
  let hits: ItunesHit[] = []
  try {
    hits = (JSON.parse(body) as { results?: ItunesHit[] }).results ?? []
  } catch {
    return { status: 'none', reason: 'Preview search returned something unreadable.' }
  }

  for (const hit of hits) {
    if (!hit.previewUrl || !hit.trackName) continue
    if (!isPlausibleMatch(title, hit.trackName)) continue
    return {
      status: 'found',
      url: hit.previewUrl,
      source: 'itunes',
      matched: `${hit.trackName}${hit.artistName ? ` — ${hit.artistName}` : ''}`,
    }
  }

  return {
    status: 'none',
    reason: hits.length
      ? 'No matching preview — the closest results were different songs.'
      : 'No preview found for this song.',
  }
}

/**
 * A playable 30-second sample for a track, or an explanation of why not.
 * Cached per track for the life of the page.
 */
export function resolvePreview(track: Track): Promise<PreviewResult> {
  const cached = cache.get(track.id)
  if (cached) return Promise.resolve(cached)

  const running = inFlight.get(track.id)
  if (running) return running

  // Spotify's own preview needs no lookup at all.
  if (track.previewUrl) {
    const result: PreviewResult = { status: 'found', url: track.previewUrl, source: 'spotify' }
    cache.set(track.id, result)
    return Promise.resolve(result)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)

  const promise = lookupItunes(track, controller.signal)
    .catch((err: unknown): PreviewResult => ({
      status: 'none',
      reason:
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Looking for a preview took too long.'
          : 'Could not reach the preview service.',
    }))
    .then((result) => {
      // Only remember successes and definitive misses; a network blip
      // should not permanently mark a song unplayable.
      if (result.status === 'found' || !/could not reach|took too long/i.test(result.reason)) {
        cache.set(track.id, result)
      }
      return result
    })
    .finally(() => {
      clearTimeout(timer)
      inFlight.delete(track.id)
    })

  inFlight.set(track.id, promise)
  return promise
}

/** Forget cached lookups. Exposed for tests. */
export function clearPreviewCache(): void {
  cache.clear()
  inFlight.clear()
}
