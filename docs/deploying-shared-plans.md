# Deploying shared plans

The app works with no backend at all — plans live in the browser. This
document is only needed to turn on the shared, multi-person mode.

## What changes

| | Local-only | Shared |
|---|---|---|
| Where the plan lives | `localStorage` | D1, live-synced over a WebSocket |
| Spotify token | the browser, via PKCE | the Worker, encrypted in D1 |
| Who can edit | whoever has the browser | the owner + anyone with an editor link |
| Spotify writes | manual "push as playlist" | automatic, a few seconds after edits settle |

Both modes ship in the same build. A visitor with no session gets the
local-only app.

## One-time setup

### 1. A Spotify app with a client secret

The browser flow uses PKCE and no secret. The server flow needs one, because
the Worker refreshes the owner's token when the owner is not present — that
is what lets a collaborator without a Spotify account cause a write.

In the [Spotify dashboard](https://developer.spotify.com/dashboard):

- Add `https://<your-worker>.workers.dev/api/auth/callback` as a redirect URI.
  It must match byte for byte.
- Copy the Client ID and Client Secret.

Note the app stays in Development mode until Spotify approves an extension
request, and in that mode only accounts you list under **User Management**
can sign in. The owner account must be listed.

### 2. Create the database

```bash
npx wrangler d1 create bmxc-playlist-sorter
```

Put the printed `database_id` into `wrangler.jsonc`, then apply the schema:

```bash
npx wrangler d1 migrations apply bmxc-playlist-sorter --remote
```

### 3. Set the secrets

```bash
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put ENCRYPTION_KEY   # any long random string
```

`ENCRYPTION_KEY` encrypts refresh tokens at rest. **Changing it makes every
stored token unreadable** and every owner has to reconnect Spotify. Generate
one with `openssl rand -base64 32` and keep it somewhere durable.

Set the public Client ID in `wrangler.jsonc` under `vars.SPOTIFY_CLIENT_ID`.
A Client ID is not a secret; it ships in the browser bundle either way.

### 4. Deploy

```bash
npm run deploy
```

## Using it

1. Open the deployed site, go to **Settings**, and click **Sign in with
   Spotify to share**. This is the camp account that owns the playlists.
2. Under **Spotify playlist**, paste the playlist link. It must be owned by
   the account you just connected — Spotify does not permit reordering
   anyone else's playlist, and the app will tell you so rather than failing
   silently later.
3. Create an **editor link** for people who will sort, and a **view-only
   link** for people who just need the run sheet at camp.

Anyone opening a link picks a name and is in. No account, no password, no
Spotify.

## Things worth knowing

**The editor link is a credential.** Anyone holding it can change the plan
and, through it, the real Spotify playlist. Rotating a link invalidates
every copy of the old URL. Individual people can be removed without
rotating.

**Sections do not exist on Spotify.** A Spotify playlist is a flat list.
Your section grouping determines the order Spotify receives; the names live
only in this app.

**Sync is automatic and there is no undo.** Edits push about five seconds
after they stop. A failed push pauses syncing with a visible reason rather
than retrying into a half-reordered playlist. If you want a checkpoint
before a big reshuffle, duplicate the plan first.

**Songs Spotify does not have are skipped**, and the app says how many.
Songs *Spotify* has that the plan does not know about are left alone rather
than deleted — so a song someone adds in the Spotify app survives.

## Local development

```bash
npx wrangler d1 execute bmxc-playlist-sorter --local --file=migrations/0001_init.sql
npm run build
npx wrangler dev --local \
  --var SPOTIFY_CLIENT_ID:x --var SPOTIFY_CLIENT_SECRET:y --var ENCRYPTION_KEY:z
```

Spotify OAuth cannot complete against `localhost` unless you register that
redirect URI too. To exercise the collaboration paths without it, insert an
owner row and a session by hand — see the API test in the repository's
development notes for the exact statements.
