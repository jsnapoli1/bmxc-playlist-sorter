# Camp Playlist Sorter

A web app for planning **which songs play during which parts of a week at summer camp**.

Import your camp schedule, pull in a Spotify playlist, drop songs onto the blocks
where they belong, and leave notes so whoever is running music knows what to do —
then print or pull up the run sheet during the week.

![The planner: song library, week schedule, and the block inspector](docs/planner.png)

![The run sheet](docs/run-sheet.png)

## What it does

- **Import a schedule** — paste it as plain text, or upload a `.csv`, `.txt`, or `.ics`
  calendar export. Days, times, locations, categories and notes are picked up
  automatically.
- **Import songs from Spotify** — any playlist you own, follow, or have a link to.
- **Assign songs to blocks** — drag from the library onto a block, or select a block
  and use the `+` button (which works on a phone, where drag-and-drop doesn't).
- **Leave notes** — a note per schedule block ("acoustic only, keep it under
  conversation volume") and a cue note per song ("fade at 2:10", "sing-along").
- **Run sheet** — a clean, printable, phone-friendly view of the whole week: every
  block in order, its notes, and its songs with cues. Copies as plain text too.
- **Push back to Spotify** — turn any block, or every day, into a real Spotify playlist.
- **Multiple weeks** — one plan per camp session; duplicate one to start the next.

Everything is stored in your browser. Nothing is sent anywhere except Spotify, and
there is no server to run or account to make. Export a JSON backup to move between
computers or hand the plan off to next year's music person.

## Getting started

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the schedule-parser tests |
| `npm run check` | Type-check plus tests |

### Connecting Spotify

There are two ways to run this, and the right one depends on who uses it.

#### Recommended: one Spotify app for everyone (what camp staff should see)

Register a single Spotify app yourself and bake its Client ID into the build.
Everyone else then sees one button — **Connect Spotify** — and never touches a
developer dashboard.

1. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard)
   and **Create app**. Tick **Web API**.
2. Add your deployed URL as a **Redirect URI**, trailing slash included:
   `https://<your-worker>.workers.dev/`. Add `http://127.0.0.1:5173/` too if you
   develop locally.
3. Copy the **Client ID** and set it as `VITE_SPOTIFY_CLIENT_ID` at build time.
   On Cloudflare, that is **Worker → Settings → Build → Build variables and
   secrets**; it takes effect on the next deploy. Locally, copy `.env.example`
   to `.env`.

The Client ID ends up in the JavaScript bundle, which is correct and safe: PKCE
public clients are designed for exactly this, there is no client secret
involved, and Spotify will only ever return a code to a redirect URI you
registered.

> **Spotify's 25-user limit.** A new Spotify app starts in **Development
> mode**, which allows at most 25 users, and *each one must be added by name
> and email* under **User Management** in your app's dashboard settings.
> Anyone not on that list gets an error at the Spotify login screen rather than
> in this app, so add your music staff before camp starts. Lifting the limit
> means requesting **Extended Quota Mode** from Spotify, which is a review
> process intended for organizations.

#### Fallback: each user brings their own Spotify app

If `VITE_SPOTIFY_CLIENT_ID` is not set, the app shows a short setup wizard
instead: create an app, register the redirect URI it prints, paste the Client
ID. That path still works and is what you get running from a fresh clone. It is
also reachable behind **Use my own Spotify app instead** on the connect screen,
for anyone who would rather not be on your app's user list.

Either way, the Client ID and the resulting tokens live only in that browser's
`localStorage`.

Scopes requested: `playlist-read-private`, `playlist-read-collaborative`,
`playlist-modify-private`, `playlist-modify-public`.

## Schedule formats

### Plain text

The format most camp schedules already look like:

```
Monday
7:30-8:00 Wake up @ Cabins | speaker on the porch, not inside
8:00-8:45 Breakfast @ Dining Hall
  note: keep it quiet until announcements are done
9:00-10:15 Activity Period 1 @ Waterfront
12:00-1:00 Lunch @ Dining Hall
2:00-4:00 Free swim @ Lake
8:00-9:30 Campfire @ Fire Ring | slow songs only, no explicit
9:45 Lights out
```

- A line with **no time** starts a new day (`Monday`, `Day 3`, `2026-06-22`).
- A line starting with a **time or time range** is a block.
- `@ Place` sets the location, `| text` and `note:` lines become notes, and
  `[Meal]` sets a category.
- **Times without AM/PM are read in schedule order.** `2:00-4:00` after lunch
  becomes 2:00 PM, and `8:00 Campfire` after that becomes 8:00 PM — a bare time
  that would move the clock backwards is nudged forward twelve hours. Times that
  state AM/PM, or that can only be 24-hour, are never touched. The import preview
  reports every adjustment so you can spot-check it.

### CSV

Any of these header names work, in any order:
`day`/`date`, `start`, `end`, `title`/`activity`/`event`, `location`, `category`, `notes`.

```csv
Date,Start Time,End Time,Activity,Where,Details
Monday,7:30 AM,8:00 AM,Wake Up,Cabins,"speaker on the porch, not inside"
Monday,8:00 PM,9:30 PM,Campfire,Fire Ring,slow songs only
```

### Calendar (`.ics`)

Export from Google Calendar or Outlook and upload it directly. Events are grouped
into days by date.

## How it's built

- React 18 + TypeScript + Vite, no backend and no UI framework.
- State lives in a reducer (`src/lib/store.tsx`), persisted to `localStorage` and
  exportable as JSON.
- The schedule parser (`src/lib/parseSchedule.ts`, `src/lib/time.ts`) is pure and
  covered by tests in `test/`.
- Spotify PKCE auth in `src/spotify/auth.ts`; API calls in `src/spotify/api.ts`.

## Deploying to Cloudflare Workers

The repo is configured for Cloudflare Workers static assets (`wrangler.jsonc`).
It is an **assets-only Worker** — Cloudflare serves the built files from its edge
with no Worker invocation per request, so there is no request billing and no
server code to maintain.

```bash
npx wrangler login     # one-time, opens a browser
npm run deploy         # builds, then wrangler deploy
```

That publishes to `https://bmxc-playlist-sorter.<your-subdomain>.workers.dev`. Your
account subdomain is shown on the **Workers & Pages** page in the dashboard, next
to **Your subdomain**.

`wrangler.jsonc` sets `workers_dev: true` explicitly. A Worker created through the
dashboard's Git-import flow can deploy successfully but arrive with no route
attached — the dashboard then reports **No URLs enabled** and there is no address
to visit. Setting it in config means every deploy reattaches the route. It also
sets `preview_urls: false`: preview builds would otherwise get their own public
hostnames, and since Spotify only accepts redirect URIs registered in advance,
extra origins are ones the login flow could never use anyway.

In CI, or anywhere a browser login isn't possible, set a `CLOUDFLARE_API_TOKEN`
(the **Edit Cloudflare Workers** template is the right scope) and
`CLOUDFLARE_ACCOUNT_ID` instead of running `wrangler login`.

**After the first deploy, add the deployed URL to your Spotify app** as a redirect
URI — the login flow will fail until you do. Open the app's **Settings** tab; it
shows the exact URI to paste, including the trailing slash. Set
`VITE_SPOTIFY_CLIENT_ID` as a build variable at the same time (see
[Connecting Spotify](#connecting-spotify)) so users get a single Connect button.
Local development and the deployed site each need their own redirect entry:

- `http://127.0.0.1:5173/` — dev server
- `https://bmxc-playlist-sorter.<your-subdomain>.workers.dev/` — deployed

Other commands:

| Command | What it does |
| --- | --- |
| `npm run cf:dev` | Build and serve through the local Workers runtime, headers and all |
| `npm run cf:whoami` | Show which Cloudflare account wrangler is signed in to |

### Headers

`public/_headers` is copied into the build and applied by Cloudflare. It sets a
Content-Security-Policy scoped to what the app actually needs (Spotify's API,
accounts, and image CDNs), plus `nosniff`, `frame-ancestors 'none'`, and a
one-year immutable cache on hashed assets. If you add a feature that talks to
another origin, widen `connect-src` there or it will be blocked.

### Hosting somewhere else

`npm run build` emits a plain static `dist/` that any host will serve. To serve
from a subpath (GitHub Pages, say), build with
`APP_BASE=/bmxc-playlist-sorter/ npm run build` — then register that URL as the
redirect URI in your Spotify app.
