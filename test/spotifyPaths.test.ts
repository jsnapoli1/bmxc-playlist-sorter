import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

// worker/spotify.ts cannot be imported here (a constructor parameter
// property defeats Node's strip-only TypeScript mode), so these assert on
// the source text. Crude, but it pins the one thing that has now broken
// twice: the February 2026 API renamed the playlist contents path from
// /tracks to /items, and the old path answers 403, not 404 — so a stale path
// looks exactly like a permissions problem.
const SOURCE = readFileSync(new URL('../worker/spotify.ts', import.meta.url), 'utf8')

test('no playlist call uses the pre-2026 /tracks path', () => {
  const stale = [...SOURCE.matchAll(/\/playlists\/\$\{[^}]+\}\/tracks/g)]
  assert.equal(
    stale.length,
    0,
    'found /playlists/{id}/tracks — the current path is /items',
  )
})

test('the playlist contents calls all use /items', () => {
  const items = [...SOURCE.matchAll(/\/playlists\/\$\{[^}]+\}\/items/g)]
  // Two paginated reads, the reorder, and the replace.
  assert.ok(items.length >= 4, `expected at least 4 /items calls, found ${items.length}`)
})
