/**
 * Who may reorder a Spotify playlist.
 *
 * Its own module, with no classes in it, so tests can import the rule
 * directly. worker/spotify.ts uses a constructor parameter property, which
 * Node's strip-only TypeScript mode refuses to load — importing the rule
 * from there would make it untestable.
 */

/**
 * Spotify allows writes to playlists you own and to collaborative ones you
 * have been added to — being the owner is not required.
 *
 * Both the turn-it-on check (setPlaylist) and the per-sync check (PlanRoom)
 * call this. If they ever disagreed, a playlist would save successfully and
 * then fail on every sync afterwards.
 *
 * `collaborative` is only ever true for private playlists; a public playlist
 * someone else owns is genuinely not editable, and an absent flag is
 * treated as "no".
 */
export function canReorderPlaylist(
  meta: { owner: { id: string }; collaborative?: boolean },
  connectedUserId: string | undefined,
): boolean {
  if (meta.collaborative === true) return true
  // Guard the undefined case explicitly: a missing owner id must not match
  // a missing connected id and let the write through.
  return connectedUserId !== undefined && meta.owner.id === connectedUserId
}
