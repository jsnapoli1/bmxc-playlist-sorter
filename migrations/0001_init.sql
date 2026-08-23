-- Camp Playlist Sorter — shared plans.
--
-- The Durable Object per plan is the live editing surface; D1 is the
-- durable record behind it. A plan is written back here on a debounce and
-- on the DO's alarm, so losing a DO never loses more than a few seconds.

-- Spotify accounts that own plans. There is normally one — the camp
-- account — but the schema does not assume that.
CREATE TABLE IF NOT EXISTS owners (
  spotify_user_id   TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL DEFAULT '',
  -- Refresh token, encrypted with an AES-GCM key held as a Worker secret.
  -- Stored as base64(iv || ciphertext). Never leaves the Worker.
  refresh_token_enc TEXT NOT NULL,
  scopes            TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES owners(spotify_user_id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- The whole Plan object as JSON. Edits are applied as operations inside
  -- the DO; this is the materialised result.
  doc           TEXT NOT NULL,
  -- Monotonic per-plan revision. Clients send the revision they last saw so
  -- the DO can tell them what they missed instead of replaying everything.
  rev           INTEGER NOT NULL DEFAULT 0,
  -- Spotify playlist this plan's master order syncs to, if any.
  spotify_playlist_id TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS plans_owner ON plans(owner_id);

-- Share links. Two roles: 'editor' can change the plan and cause Spotify
-- writes; 'viewer' can only read. Rotating a link deletes its row and
-- inserts a new token, which invalidates every copy of the old URL.
CREATE TABLE IF NOT EXISTS share_links (
  token       TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS share_links_plan ON share_links(plan_id);

-- Anyone who has joined a plan through a link. Identified only by a name
-- they typed and a session token in their own browser — no accounts.
CREATE TABLE IF NOT EXISTS collaborators (
  id            TEXT PRIMARY KEY,
  plan_id       TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  -- SHA-256 of the session token. The raw token only ever exists in that
  -- collaborator's browser, so a database leak does not grant access.
  session_hash  TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS collaborators_plan ON collaborators(plan_id);
