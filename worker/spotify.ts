/**
 * Spotify, from the Worker.
 *
 * Unlike the browser client this uses the confidential Authorization Code
 * flow: the Worker holds a client secret, so it can refresh the owner's
 * token without the owner being present. That is what lets a collaborator
 * who has no Spotify account cause a write to the owner's playlist.
 */

import { decryptSecret, encryptSecret } from './crypto.ts'
import type { ReorderMove } from '../src/lib/spotifyDiff.ts'

const API = 'https://api.spotify.com/v1'
const ACCOUNTS = 'https://accounts.spotify.com/api/token'

export type OwnerTokens = {
  accessToken: string
  /** Absolute epoch ms. */
  expiresAt: number
  refreshToken: string
  scopes: string
}

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when retrying cannot help — bad scopes, revoked token, not owner. */
    readonly permanent: boolean,
  ) {
    super(message)
    this.name = 'SpotifyError'
  }
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`
}

/** Exchange an authorization code for tokens (owner sign-in). */
export async function exchangeCode(args: {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}): Promise<OwnerTokens> {
  const res = await fetch(ACCOUNTS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(args.clientId, args.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
    }),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    const detail = (json.error_description ?? json.error ?? '') as string
    throw new SpotifyError(detail || `Token exchange failed (${res.status})`, res.status, true)
  }
  if (!json.refresh_token) {
    // Without one we could never act on the owner's behalf later, which is
    // the entire point of the server-side flow.
    throw new SpotifyError('Spotify did not return a refresh token.', 500, true)
  }
  return {
    accessToken: json.access_token as string,
    refreshToken: json.refresh_token as string,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    scopes: (json.scope as string | undefined) ?? '',
  }
}

async function refresh(args: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<Omit<OwnerTokens, 'refreshToken'> & { refreshToken?: string }> {
  const res = await fetch(ACCOUNTS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(args.clientId, args.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
    }),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    const detail = (json.error_description ?? json.error ?? '') as string
    // invalid_grant means the user revoked access — reconnecting is the only fix.
    const permanent = json.error === 'invalid_grant' || res.status === 400
    throw new SpotifyError(
      detail || `Could not refresh Spotify access (${res.status})`,
      res.status,
      permanent,
    )
  }
  return {
    accessToken: json.access_token as string,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    scopes: (json.scope as string | undefined) ?? '',
    refreshToken: json.refresh_token as string | undefined,
  }
}

/**
 * A Spotify client bound to one owner.
 *
 * Holds the decrypted refresh token in memory for the life of the request /
 * Durable Object, refreshing the access token as needed. `onRotate` is
 * called when Spotify hands back a new refresh token so the caller can
 * persist it — Spotify does this occasionally, and missing it eventually
 * locks the owner out.
 */
export class OwnerSpotify {
  private accessToken = ''
  private expiresAt = 0
  private inFlight: Promise<void> | null = null

  constructor(
    private refreshToken: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly onRotate?: (refreshToken: string) => Promise<void>,
  ) {}

  static async fromEncrypted(
    encrypted: string,
    encryptionKey: string,
    clientId: string,
    clientSecret: string,
    onRotate?: (refreshToken: string) => Promise<void>,
  ): Promise<OwnerSpotify> {
    const token = await decryptSecret(encrypted, encryptionKey)
    return new OwnerSpotify(token, clientId, clientSecret, onRotate)
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken
    // Collapse concurrent refreshes; several queued syncs would otherwise
    // each burn a refresh call.
    this.inFlight ??= refresh({
      refreshToken: this.refreshToken,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    })
      .then(async (fresh) => {
        this.accessToken = fresh.accessToken
        this.expiresAt = fresh.expiresAt
        if (fresh.refreshToken && fresh.refreshToken !== this.refreshToken) {
          this.refreshToken = fresh.refreshToken
          await this.onRotate?.(fresh.refreshToken)
        }
      })
      .finally(() => {
        this.inFlight = null
      })
    await this.inFlight
    return this.accessToken
  }

  private async call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })

    if (res.status === 429 && retry) {
      const wait = Math.min(Number(res.headers.get('Retry-After') ?? 1), 10)
      await new Promise((r) => setTimeout(r, wait * 1000))
      return this.call<T>(path, init, false)
    }
    if (res.status === 401 && retry) {
      // Force a refresh and try once more.
      this.expiresAt = 0
      return this.call<T>(path, init, false)
    }
    if (!res.ok) {
      let detail = ''
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        detail = body.error?.message ?? ''
      } catch {
        /* no JSON body */
      }
      const where = path.startsWith('http') ? new URL(path).pathname : path
      if (res.status === 403) {
        throw new SpotifyError(
          detail ||
            'Spotify refused the change. You can only reorder a playlist owned by the connected account.',
          403,
          true,
        )
      }
      throw new SpotifyError(
        detail || `Spotify request failed (${res.status}) on ${where}`,
        res.status,
        res.status >= 400 && res.status < 500,
      )
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  async me(): Promise<{ id: string; display_name?: string }> {
    return this.call('/me')
  }

  async playlist(id: string): Promise<{ id: string; name: string; owner: { id: string }; snapshot_id: string }> {
    return this.call(`/playlists/${id}?fields=id,name,owner(id),snapshot_id`)
  }

  /** Every track uri in a playlist, in order. */
  async playlistTrackUris(id: string): Promise<string[]> {
    const uris: string[] = []
    let url: string | null = `${API}/playlists/${id}/items?fields=items(track(uri)),next&limit=100`
    while (url) {
      const page: { items: { track: { uri: string } | null }[]; next: string | null } =
        await this.call(url)
      for (const item of page.items) {
        if (item.track?.uri) uris.push(item.track.uri)
      }
      url = page.next
    }
    return uris
  }

  /**
   * Perform one reorder. `snapshotId` guards against a concurrent change:
   * Spotify rejects the call if the playlist moved on underneath us.
   */
  async reorder(
    playlistId: string,
    move: ReorderMove,
    snapshotId?: string,
  ): Promise<{ snapshot_id: string }> {
    return this.call(`/playlists/${playlistId}/items`, {
      method: 'PUT',
      body: JSON.stringify({ ...move, ...(snapshotId ? { snapshot_id: snapshotId } : {}) }),
    })
  }
}

/** Encrypt a refresh token for storage. */
export function sealRefreshToken(token: string, encryptionKey: string): Promise<string> {
  return encryptSecret(token, encryptionKey)
}
