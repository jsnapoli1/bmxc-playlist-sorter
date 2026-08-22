import type { Track } from '../lib/types.ts'
import { clearToken, getAccessToken } from './auth.ts'

const API = 'https://api.spotify.com/v1'

export type SpotifyPlaylist = {
  id: string
  name: string
  owner: string
  /** Spotify user id of the owner, to tell your own playlists from others'. */
  ownerId: string
  image?: string
  trackCount: number
  collaborative: boolean
  isPublic: boolean | null
}

export type SpotifyUser = {
  id: string
  displayName: string
  image?: string
  product?: string
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  if (res.status === 429 && retry) {
    const wait = Number(res.headers.get('Retry-After') ?? 1)
    await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000))
    return call<T>(path, init, false)
  }
  if (res.status === 401) {
    clearToken()
    throw new Error('Spotify session expired — please connect again.')
  }
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      detail = body.error?.message ?? ''
    } catch {
      /* response had no JSON body */
    }
    const where = path.startsWith('http') ? new URL(path).pathname : path
    if (res.status === 403) {
      // Spotify's own text is often just "Forbidden", which tells nobody
      // anything. In Development mode this almost always means the account
      // is not on the app's allowlist.
      throw new Error(
        [
          detail && detail.toLowerCase() !== 'forbidden'
            ? `Spotify said: ${detail} (${where}).`
            : `Spotify refused ${where} (403).`,
          'In Development mode only accounts added under User Management in the Spotify app dashboard may use the app,',
          "and the app owner's Spotify Premium subscription must be active.",
        ].join(' '),
      )
    }
    throw new Error(detail ? `${detail} (${where})` : `Spotify request failed (${res.status}) on ${where}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Walk Spotify's `next` links until every page is collected. */
async function pageAll<T>(
  first: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T[]> {
  const out: T[] = []
  let url: string | null = first
  while (url) {
    const page: { items: T[]; next: string | null; total: number } = await call(url)
    out.push(...page.items)
    onProgress?.(out.length, page.total)
    url = page.next
  }
  return out
}

export type ProbeResult = {
  label: string
  path: string
  status: number
  ok: boolean
  detail: string
}

/** Call an endpoint and report what happened instead of throwing. */
export async function probeEndpoint(label: string, path: string): Promise<ProbeResult> {
  try {
    const token = await getAccessToken()
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    let detail = ''
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      detail = body.error?.message ?? ''
    } catch {
      /* no JSON body */
    }
    return { label, path, status: res.status, ok: res.ok, detail }
  } catch (err) {
    return {
      label,
      path,
      status: 0,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function getMe(): Promise<SpotifyUser> {
  const me = await call<{
    id: string
    display_name: string | null
    images?: { url: string }[]
    product?: string
  }>('/me')
  return {
    id: me.id,
    displayName: me.display_name || me.id,
    image: me.images?.[0]?.url,
    product: me.product,
  }
}

type RawPlaylist = {
  id: string
  name: string
  owner: { display_name: string | null; id: string }
  images: { url: string }[] | null
  /** Renamed to `items` in the Feb 2026 API; accept either. */
  tracks?: { total: number }
  items?: { total: number }
  collaborative: boolean
  public: boolean | null
}

function playlistTotal(p: RawPlaylist): number {
  return p.items?.total ?? p.tracks?.total ?? 0
}

function toPlaylist(p: RawPlaylist): SpotifyPlaylist {
  return {
    id: p.id,
    name: p.name,
    owner: p.owner?.display_name || p.owner?.id || '',
    ownerId: p.owner?.id ?? '',
    image: p.images?.[0]?.url,
    trackCount: playlistTotal(p),
    collaborative: p.collaborative,
    isPublic: p.public,
  }
}

export async function getMyPlaylists(
  onProgress?: (loaded: number, total: number) => void,
): Promise<SpotifyPlaylist[]> {
  const items = await pageAll<RawPlaylist | null>('/me/playlists?limit=50', onProgress)
  return items.filter((p): p is RawPlaylist => Boolean(p)).map(toPlaylist)
}

export async function getPlaylist(id: string): Promise<SpotifyPlaylist> {
  return toPlaylist(await call<RawPlaylist>(`/playlists/${id}`))
}

type RawTrack = {
  id: string | null
  uri: string
  name: string
  duration_ms: number
  explicit: boolean
  preview_url: string | null
  artists: { name: string }[]
  album: { name: string; images: { url: string }[] }
  is_local?: boolean
  type?: string
}

function toTrack(raw: RawTrack, sourceId?: string): Track | null {
  if (!raw || raw.type === 'episode') return null
  const id = raw.id ?? (raw.uri ? `local:${raw.uri}` : null)
  if (!id) return null
  return {
    id,
    uri: raw.uri ?? '',
    name: raw.name,
    artists: raw.artists?.map((a) => a.name).join(', ') ?? '',
    album: raw.album?.name ?? '',
    albumArt: raw.album?.images?.at(-1)?.url,
    durationMs: raw.duration_ms ?? 0,
    explicit: Boolean(raw.explicit),
    previewUrl: raw.preview_url,
    sourceId,
  }
}

/**
 * Read every song in a playlist.
 *
 * Spotify's February 2026 API renamed `/playlists/{id}/tracks` to
 * `/playlists/{id}/items`, and each entry's `track` key to `item`; the old
 * path now returns 403 for Development mode apps. The `fields` filter is
 * deliberately omitted rather than rewritten, so this keeps working whichever
 * shape an account is served.
 */
export async function getPlaylistTracks(
  playlistId: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Track[]> {
  const entries = await pageAll<{ item?: RawTrack | null; track?: RawTrack | null }>(
    `/playlists/${playlistId}/items?limit=100`,
    onProgress,
  )
  const tracks: Track[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const raw = entry?.item ?? entry?.track
    if (!raw) continue
    const track = toTrack(raw, playlistId)
    if (track && !seen.has(track.id)) {
      seen.add(track.id)
      tracks.push(track)
    }
  }
  return tracks
}

/**
 * Create a playlist and fill it — used to push a block or day to Spotify.
 *
 * Uses `POST /me/playlists`; the old `POST /users/{id}/playlists` was removed
 * in February 2026 and now answers "You cannot create a playlist for another
 * user". Songs are added through `/items` for the same reason.
 */
export async function createPlaylistWithTracks(args: {
  name: string
  description: string
  uris: string[]
  isPublic?: boolean
}): Promise<{ id: string; url: string }> {
  const playlist = await call<{ id: string; external_urls?: { spotify?: string } }>(
    '/me/playlists',
    {
      method: 'POST',
      body: JSON.stringify({
        name: args.name.slice(0, 100),
        description: args.description.slice(0, 300),
        public: args.isPublic ?? false,
      }),
    },
  )

  for (let i = 0; i < args.uris.length; i += 100) {
    await call(`/playlists/${playlist.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: args.uris.slice(i, i + 100) }),
    })
  }
  return {
    id: playlist.id,
    url: playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlist.id}`,
  }
}
