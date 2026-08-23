import { useEffect, useState } from 'react'
import { useStore } from './lib/store.tsx'
import { MOBILE_QUERY, useMediaQuery } from './lib/useMediaQuery.ts'
import { SpotifyProvider, useSpotify } from './spotify/SpotifyProvider.tsx'
import SongLibrary from './components/SongLibrary.tsx'
import PlaylistView from './components/PlaylistView.tsx'
import ScheduleBoard from './components/ScheduleBoard.tsx'
import BlockInspector from './components/BlockInspector.tsx'
import ImportScheduleModal from './components/ImportScheduleModal.tsx'
import SpotifyImportModal from './components/SpotifyImportModal.tsx'
import RunOfShow from './components/RunOfShow.tsx'
import SettingsView from './components/SettingsView.tsx'
import SyncStatus from './components/SyncStatus.tsx'
import DuckPal from './components/duckpal/DuckPal.tsx'
import type { SessionInfo } from './Root.tsx'
import type { SharedPlan } from './lib/useSharedPlan.ts'
import { planLabel } from './lib/planMigration.ts'

type Tab = 'plan' | 'playlist' | 'run' | 'settings'

/** Sentinel value in the playlist picker; not a real plan id. */
const NEW_PLAYLIST = '__new_playlist__'

type ShellProps = {
  session: SessionInfo | null
  shared: SharedPlan
}

function Shell({ session, shared }: ShellProps) {
  const { state, plan, dispatch } = useStore()
  const { status, user, connect, hasBuiltInClientId } = useSpotify()
  const [tab, setTab] = useState<Tab>('plan')
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [scheduleModal, setScheduleModal] = useState(false)
  const [songsModal, setSongsModal] = useState(false)
  const isMobile = useMediaQuery(MOBILE_QUERY)
  // On a phone the block editor takes over the screen; this picks which half
  // of it is showing.
  const [sheetView, setSheetView] = useState<'details' | 'songs'>('details')

  // Opening a block always starts on its details.
  useEffect(() => {
    if (selectedBlockId) setSheetView('details')
  }, [selectedBlockId])

  // The sheet is a full-screen layer; don't let the page behind it scroll.
  const sheetOpen = isMobile && tab === 'plan' && Boolean(selectedBlockId)
  useEffect(() => {
    if (!sheetOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [sheetOpen])

  // Escape closes the sheet, matching the modals.
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedBlockId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetOpen])

  const selectedBlock = plan.blocks.find((b) => b.id === selectedBlockId) ?? null
  const placed = plan.blocks.reduce((n, b) => n + b.entries.length, 0)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">♪</span>
          <span className="brand-text">Camp Playlist Sorter</span>
        </div>

        {session ? (
          <span className="pill truncate" title={planLabel(plan)}>
            {planLabel(plan)}
          </span>
        ) : (
          <select
            style={{ width: 'auto', maxWidth: 220 }}
            value={plan.id}
            onChange={(e) => {
              // The sentinel opens the importer rather than switching, so
              // "add a playlist" lives in the same control as choosing one.
              if (e.target.value === NEW_PLAYLIST) setSongsModal(true)
              else dispatch({ type: 'setActivePlan', id: e.target.value })
            }}
            aria-label="Playlist"
            title="Each playlist has its own sections and schedule"
          >
            {state.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {planLabel(p)}
              </option>
            ))}
            <option disabled>──────────</option>
            <option value={NEW_PLAYLIST}>+ Import another playlist…</option>
          </select>
        )}

        <nav className="tabs" role="tablist">
          {(
            [
              ['plan', 'Plan'],
              ['playlist', 'Playlist'],
              ['run', 'Run sheet'],
              ['settings', 'Settings'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className="tab"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="spacer" />

        <span className="pill" title="Songs placed into the schedule">
          ♪ {placed}
          {!isMobile && ' placed'}
        </span>

        {tab === 'plan' && !isMobile && (
          <>
            <button className="btn sm" onClick={() => setScheduleModal(true)}>
              Import schedule
            </button>
            <button className="btn sm" onClick={() => setSongsModal(true)}>
              Import songs
            </button>
          </>
        )}

        {session && (
          <SyncStatus
            connection={shared.connection}
            sync={shared.sync}
            peers={shared.peers}
            pending={shared.pending}
            you={shared.you}
          />
        )}

        {!session && (
        <button
          className="btn sm"
          onClick={() => {
            // With a Client ID shipped in the build there is nothing to set up,
            // so go straight to Spotify instead of via the Settings tab.
            // 'error' means we hold a token Spotify rejects; another login
            // round-trip changes nothing, so show the diagnostics instead.
            if (status === 'idle' && hasBuiltInClientId) void connect()
            else setTab('settings')
          }}
          title={status === 'connected' ? 'Spotify connected' : 'Connect Spotify'}
        >
          <span
            className="dot"
            style={{ background: status === 'connected' ? 'var(--accent)' : 'var(--text-faint)' }}
          />
          {status === 'connected' ? (user?.displayName ?? 'Spotify') : isMobile ? 'Spotify' : 'Connect Spotify'}
        </button>
        )}
      </header>

      {tab === 'plan' && (
        <div className="workspace">
          {!isMobile && (
            <SongLibrary
              selectedBlockId={selectedBlockId}
              selectedBlockLabel={selectedBlock?.title ?? null}
              onOpenImport={() => setSongsModal(true)}
            />
          )}
          <ScheduleBoard
            selectedBlockId={selectedBlockId}
            onSelectBlock={setSelectedBlockId}
            onOpenImport={() => setScheduleModal(true)}
            toolbar={
              isMobile ? (
                <div className="board-toolbar">
                  <button className="btn sm" onClick={() => setScheduleModal(true)}>
                    Import schedule
                  </button>
                  <button className="btn sm" onClick={() => setSongsModal(true)}>
                    Import songs
                  </button>
                </div>
              ) : null
            }
          />
          {!isMobile && (
            <BlockInspector blockId={selectedBlockId} onClose={() => setSelectedBlockId(null)} />
          )}
        </div>
      )}

      {sheetOpen && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Block details">
          <div className="sheet-tabs">
            <div className="sheet-tablist grow" role="tablist" aria-label="Block editor">
              <button
                className="tab"
                role="tab"
                aria-selected={sheetView === 'details'}
                onClick={() => setSheetView('details')}
              >
                Details &amp; notes
              </button>
              <button
                className="tab"
                role="tab"
                aria-selected={sheetView === 'songs'}
                onClick={() => setSheetView('songs')}
              >
                Add songs
              </button>
            </div>
            <button
              className="btn sm"
              onClick={() => setSelectedBlockId(null)}
              aria-label="Back to the schedule"
            >
              Done
            </button>
          </div>
          {sheetView === 'details' ? (
            <BlockInspector blockId={selectedBlockId} onClose={() => setSelectedBlockId(null)} />
          ) : (
            <SongLibrary
              selectedBlockId={selectedBlockId}
              selectedBlockLabel={selectedBlock?.title ?? null}
              onOpenImport={() => setSongsModal(true)}
            />
          )}
        </div>
      )}

      {tab === 'playlist' && (
        <div className="workspace">
          <PlaylistView onOpenImport={() => setSongsModal(true)} />
        </div>
      )}

      {tab === 'run' && (
        <div className="workspace">
          <RunOfShow />
        </div>
      )}

      {tab === 'settings' && (
        <div className="workspace">
          <SettingsView session={session} />
        </div>
      )}

      <DuckPal placed={placed} />

      {scheduleModal && <ImportScheduleModal onClose={() => setScheduleModal(false)} />}
      {songsModal && <SpotifyImportModal onClose={() => setSongsModal(false)} />}
    </div>
  )
}

export default function App({ session, shared }: ShellProps) {
  return (
    <SpotifyProvider>
      <Shell session={session} shared={shared} />
    </SpotifyProvider>
  )
}
