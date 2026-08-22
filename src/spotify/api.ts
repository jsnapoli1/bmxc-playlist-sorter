import type { Track } from '../lib/types.ts'
import { clearToken, getAccessToken } from './auth.ts'

const API = 'https://api.spotify.com/v1'

export type SpotifyPlaylist = {
  id: string
  name: string
  owner: string
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
    let message = `Spotify request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      /* response had no JSON body */
    }
    throw new Error(message)
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
  tracks: { total: number }
  collaborative: boolean
  public: boolean | null
}

export async function getMyPlaylists(
  onProgress?: (loaded: number, total: number) => void,
): Promise<SpotifyPlaylist[]> {
  const items = await pageAll<RawPlaylist | null>('/me/playlists?limit=50', onProgress)
  return items.filter(Boolean).map((p) => ({
    id: p!.id,
    name: p!.name,
    owner: p!.owner.display_name || p!.owner.id,
    image: p!.images?.[0]?.url,
    trackCount: p!.tracks.total,
    collaborative: p!.collaborative,
    isPublic: p!.public,
  }))
}

export async function getPlaylist(id: string): Promise<SpotifyPlaylist> {
  const p = await call<RawPlaylist>(`/playlists/${id}?fields=id,name,owner,images,tracks(total),collaborative,public`)
  return {
    id: p.id,
    name: p.name,
    owner: p.owner.display_name || p.owner.id,
    image: p.images?.[0]?.url,
    trackCount: p.tracks.total,
    collaborative: p.collaborative,
    isPublic: p.public,
  }
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

export async function getPlaylistTracks(
  playlistId: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Track[]> {
  const fields =
    'items(track(id,uri,name,duration_ms,explicit,preview_url,type,is_local,artists(name),album(name,images))),next,total'
  const items = await pageAll<{ track: RawTrack | null }>(
    `/playlists/${playlistId}/tracks?limit=100&fields=${encodeURIComponent(fields)}`,
    onProgress,
  )
  const tracks: Track[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!item?.track) continue
    const track = toTrack(item.track, playlistId)
    if (track && !seen.has(track.id)) {
      seen.add(track.id)
      tracks.push(track)
    }
  }
  return tracks
}

export async function searchTracks(query: string, limit = 20): Promise<Track[]> {
  if (!query.trim()) return []
  const res = await call<{ tracks: { items: RawTrack[] } }>(
    `/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`,
  )
  return res.tracks.items.map((t) => toTrack(t)).filter((t): t is Track => Boolean(t))
}

/** Create a playlist and fill it — used to push a block or day back to Spotify. */
export async function createPlaylistWithTracks(args: {
  name: string
  description: string
  uris: string[]
  isPublic?: boolean
}): Promise<{ id: string; url: string }> {
  const me = await getMe()
  const playlist = await call<{ id: string; external_urls: { spotify: string } }>(
    `/users/${me.id}/playlists`,
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
    await call(`/playlists/${playlist.id}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: args.uris.slice(i, i + 100) }),
    })
  }
  return { id: playlist.id, url: playlist.external_urls.spotify }
}
