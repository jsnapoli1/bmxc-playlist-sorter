import { useState } from 'react'
import { useStore } from './lib/store.tsx'
import { SpotifyProvider, useSpotify } from './spotify/SpotifyProvider.tsx'
import SongLibrary from './components/SongLibrary.tsx'
import ScheduleBoard from './components/ScheduleBoard.tsx'
import BlockInspector from './components/BlockInspector.tsx'
import ImportScheduleModal from './components/ImportScheduleModal.tsx'
import SpotifyImportModal from './components/SpotifyImportModal.tsx'
import RunOfShow from './components/RunOfShow.tsx'
import SettingsView from './components/SettingsView.tsx'

type Tab = 'plan' | 'run' | 'settings'

function Shell() {
  const { state, plan, dispatch } = useStore()
  const { status, user } = useSpotify()
  const [tab, setTab] = useState<Tab>('plan')
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [scheduleModal, setScheduleModal] = useState(false)
  const [songsModal, setSongsModal] = useState(false)

  const selectedBlock = plan.blocks.find((b) => b.id === selectedBlockId) ?? null
  const placed = plan.blocks.reduce((n, b) => n + b.entries.length, 0)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">♪</span>
          Camp Playlist Sorter
        </div>

        <select
          style={{ width: 'auto', maxWidth: 200 }}
          value={plan.id}
          onChange={(e) => dispatch({ type: 'setActivePlan', id: e.target.value })}
          aria-label="Active plan"
        >
          {state.plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <nav className="tabs" role="tablist">
          {(
            [
              ['plan', 'Plan'],
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
          ♪ {placed} placed
        </span>

        {tab === 'plan' && (
          <>
            <button className="btn sm" onClick={() => setScheduleModal(true)}>
              Import schedule
            </button>
            <button className="btn sm" onClick={() => setSongsModal(true)}>
              Import songs
            </button>
          </>
        )}

        <button
          className="btn sm"
          onClick={() => setTab('settings')}
          title={status === 'connected' ? 'Spotify connected' : 'Connect Spotify'}
        >
          <span
            className="dot"
            style={{ background: status === 'connected' ? 'var(--accent)' : 'var(--text-faint)' }}
          />
          {status === 'connected' ? (user?.displayName ?? 'Spotify') : 'Connect Spotify'}
        </button>
      </header>

      {tab === 'plan' && (
        <div className="workspace">
          <SongLibrary
            selectedBlockId={selectedBlockId}
            selectedBlockLabel={selectedBlock?.title ?? null}
            onOpenImport={() => setSongsModal(true)}
          />
          <ScheduleBoard
            selectedBlockId={selectedBlockId}
            onSelectBlock={setSelectedBlockId}
            onOpenImport={() => setScheduleModal(true)}
          />
          <BlockInspector blockId={selectedBlockId} onClose={() => setSelectedBlockId(null)} />
        </div>
      )}

      {tab === 'run' && (
        <div className="workspace">
          <RunOfShow />
        </div>
      )}

      {tab === 'settings' && (
        <div className="workspace">
          <SettingsView />
        </div>
      )}

      {scheduleModal && <ImportScheduleModal onClose={() => setScheduleModal(false)} />}
      {songsModal && <SpotifyImportModal onClose={() => setSongsModal(false)} />}
    </div>
  )
}

export default function App() {
  return (
    <SpotifyProvider>
      <Shell />
    </SpotifyProvider>
  )
}
