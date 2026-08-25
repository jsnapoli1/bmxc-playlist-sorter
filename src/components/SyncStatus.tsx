import { useState } from 'react'
import type { ConnectionState } from '../lib/useSharedPlan.ts'
import type { Presence, SyncState } from '../lib/protocol.ts'

function ago(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.round(minutes / 60)} hr ago`
}

const LABELS: Record<SyncState['status'], string> = {
  off: 'Not syncing to Spotify',
  idle: 'Spotify up to date',
  pending: 'Saving to Spotify…',
  syncing: 'Saving to Spotify…',
  synced: 'Saved to Spotify',
  paused: 'Spotify sync paused',
}

/**
 * The one place that answers "is my work safe, and who else is here?".
 *
 * With auto-sync there is no Save button to look at, so this line has to
 * carry the whole answer — including when it is *not* fine.
 */
export default function SyncStatus({
  connection,
  sync,
  peers,
  pending,
  you,
  onRetry,
}: {
  connection: ConnectionState
  sync: SyncState
  peers: Presence[]
  pending: number
  you: Presence | null
  onRetry?: () => void
}) {
  const [showWhy, setShowWhy] = useState(false)
  const others = peers.filter((p) => p.collaboratorId !== you?.collaboratorId)

  // Losing the connection matters more than anything Spotify is doing.
  const offline = connection === 'offline' || connection === 'connecting'
  const bad = sync.status === 'paused' || offline

  const dotColor = bad
    ? 'var(--danger)'
    : sync.status === 'syncing' || sync.status === 'pending' || pending > 0
      ? 'var(--amber)'
      : 'var(--accent)'

  const text = offline
    ? connection === 'connecting'
      ? 'Reconnecting…'
      : `Offline — ${pending > 0 ? `${pending} change${pending === 1 ? '' : 's'} waiting` : 'changes are saved locally'}`
    : sync.status === 'synced' && sync.lastSyncedAt
      ? `${LABELS.synced} ${ago(sync.lastSyncedAt)}`
      : LABELS[sync.status]

  return (
    <div className="sync-status">
      <span className="row" title={sync.error ?? undefined}>
        <span className="dot" style={{ background: dotColor }} />
        <span className="tiny">{text}</span>
      </span>

      {/* The reason used to live only in the dot's title attribute, which is
          invisible on touch and undiscoverable on desktop — "sync is paused"
          with no way to find out why. This button puts it one obvious tap
          away without giving the header bar room to a long message. */}
      {sync.error && (
        <button
          className="btn ghost sm sync-why"
          onClick={() => setShowWhy((v) => !v)}
          aria-expanded={showWhy}
        >
          {showWhy ? 'Hide' : 'Why?'}
        </button>
      )}

      {others.length > 0 && (
        <span className="tiny faint truncate" title={others.map((p) => p.displayName).join(', ')}>
          · {others.length === 1 ? `${others[0].displayName} is here` : `${others.length} others here`}
        </span>
      )}

      {sync.error && showWhy && (
        <div className="sync-why-detail tiny">
          {sync.error}
          {/* A paused sync never retries on its own, so telling the user why
              without offering a way forward would leave them stuck. */}
          {sync.status === 'paused' && onRetry && (
            <div style={{ marginTop: 6 }}>
              <button className="btn sm" onClick={onRetry}>
                Try syncing again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
