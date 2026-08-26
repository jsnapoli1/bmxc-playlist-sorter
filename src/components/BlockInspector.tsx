import { useState } from 'react'
import { useStore } from '../lib/store.tsx'
import { CATEGORIES, categoryColor, type Block } from '../lib/types.ts'
import { blockMinutes, formatDuration, formatMinutes, formatRange } from '../lib/time.ts'
import { isPlannerDrag, readDrag, setEntryDrag } from '../lib/dnd.ts'
import PreviewButton from './PreviewButton.tsx'
import { createPlaylistWithTracks } from '../spotify/api.ts'
import { useSpotify } from '../spotify/SpotifyProvider.tsx'

export default function BlockInspector({
  blockId,
  onClose,
}: {
  blockId: string | null
  onClose: () => void
}) {
  const { plan, dispatch } = useStore()
  const { status } = useSpotify()
  const [pushState, setPushState] = useState<{ busy: boolean; message: string; url?: string }>({
    busy: false,
    message: '',
  })
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const block = plan.blocks.find((b) => b.id === blockId) ?? null
  const day = block ? plan.days.find((d) => d.id === block.dayId) : null

  if (!block) {
    return (
      <aside className="inspector">
        <div className="panel-head">
          <div className="panel-title">Block details</div>
        </div>
        <div className="inspector-body">
          <div className="empty-state">
            Select a block to add songs and notes for whoever is running music.
          </div>
        </div>
      </aside>
    )
  }

  const patch = (p: Partial<Block>) => dispatch({ type: 'updateBlock', id: block.id, patch: p })

  const planned = block.entries.reduce(
    (sum, e) => sum + (plan.tracks[e.trackId]?.durationMs ?? 0),
    0,
  )
  const slot = blockMinutes(block.start, block.end)

  const pushToSpotify = async () => {
    const uris = block.entries
      .map((e) => plan.tracks[e.trackId]?.uri)
      .filter((uri): uri is string => Boolean(uri) && uri.startsWith('spotify:track:'))
    if (!uris.length) {
      setPushState({ busy: false, message: 'No Spotify tracks in this block yet.' })
      return
    }
    setPushState({ busy: true, message: 'Creating playlist…' })
    try {
      const cues = block.entries
        .filter((e) => e.note.trim())
        .map((e) => `${plan.tracks[e.trackId]?.name ?? 'Song'}: ${e.note.trim()}`)
        .join(' | ')
      const description = [block.notes.trim(), cues].filter(Boolean).join(' — ') ||
        `${plan.name} · ${day?.label ?? ''}`
      const result = await createPlaylistWithTracks({
        name: `${day?.label ? `${day.label} · ` : ''}${block.title}`,
        description,
        uris,
      })
      // Name the account: a collaborator would otherwise assume this landed
      // in the camp's Spotify, since that is what the plan syncs to.
      setPushState({
        busy: false,
        message: `Created in your Spotify with ${uris.length} songs.`,
        url: result.url,
      })
    } catch (err) {
      setPushState({ busy: false, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <aside className="inspector">
      <div className="panel-head">
        <div className="panel-title">
          <span className="row" style={{ gap: 6 }}>
            <span className="dot" style={{ background: categoryColor(block.category) }} />
            {day?.label ?? 'Block'}
          </span>
          <button className="btn ghost sm" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <div className="tiny faint">
          {formatRange(block.start, block.end)}
          {slot !== null && ` · ${formatMinutes(slot)} slot`}
        </div>
      </div>

      <div className="inspector-body">
        <label className="field">
          <span>Block name</span>
          <input
            type="text"
            value={block.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </label>

        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <label className="field grow" style={{ marginBottom: 0 }}>
            <span>Start</span>
            <input
              type="time"
              value={block.start}
              onChange={(e) => patch({ start: e.target.value })}
            />
          </label>
          <label className="field grow" style={{ marginBottom: 0 }}>
            <span>End</span>
            <input type="time" value={block.end} onChange={(e) => patch({ end: e.target.value })} />
          </label>
        </div>

        <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'flex-end' }}>
          <label className="field grow" style={{ marginBottom: 0 }}>
            <span>Location</span>
            <input
              type="text"
              value={block.location}
              placeholder="Dining hall, field…"
              onChange={(e) => patch({ location: e.target.value })}
            />
          </label>
          <label className="field grow" style={{ marginBottom: 0 }}>
            <span>Category</span>
            <select value={block.category} onChange={(e) => patch({ category: e.target.value })}>
              {[...new Set([...CATEGORIES, block.category])].filter(Boolean).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Notes for this block</span>
          <textarea
            rows={4}
            value={block.notes}
            placeholder="Volume level, who introduces it, what to avoid, when to fade out…"
            onChange={(e) => patch({ notes: e.target.value })}
          />
          <div className="hint">Shown to whoever runs music, on the run sheet and printout.</div>
        </label>

        <label className="field">
          <span>Move to day</span>
          <select
            value={block.dayId}
            onChange={(e) =>
              dispatch({ type: 'moveBlockToDay', id: block.id, dayId: e.target.value })
            }
          >
            {plan.days.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <div className="section-label">
          <span>
            Songs ({block.entries.length}
            {planned > 0 ? ` · ${formatMinutes(planned / 60000)}` : ''})
          </span>
          {block.entries.length > 0 && (
            <button
              className="btn ghost sm"
              onClick={() => {
                if (confirm('Remove all songs from this block?')) {
                  dispatch({ type: 'clearBlockEntries', blockId: block.id })
                }
              }}
            >
              Clear
            </button>
          )}
        </div>

        {slot !== null && planned / 60000 > slot + 0.5 && (
          <div className="banner tiny">
            ⚠️ {formatMinutes(planned / 60000)} of music in a {formatMinutes(slot)} block — it will
            run long.
          </div>
        )}

        {!block.entries.length && (
          <div
            className="empty-state"
            onDragOver={(e) => isPlannerDrag(e) && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const payload = readDrag(e)
              if (payload?.kind === 'track') {
                dispatch({ type: 'assign', blockId: block.id, trackIds: payload.data.trackIds })
              }
            }}
          >
            Drag songs here from the library on the left.
          </div>
        )}

        {block.entries.map((entry, index) => {
          const track = plan.tracks[entry.trackId]
          return (
            <div
              className={`entry${dropIndex === index ? ' drop-target' : ''}`}
              key={entry.id}
              draggable
              onDragStart={(e) => setEntryDrag(e, { blockId: block.id, entryId: entry.id })}
              onDragOver={(e) => {
                if (!isPlannerDrag(e)) return
                e.preventDefault()
                setDropIndex(index)
              }}
              onDragLeave={() => setDropIndex((cur) => (cur === index ? null : cur))}
              onDrop={(e) => {
                e.preventDefault()
                setDropIndex(null)
                const payload = readDrag(e)
                if (!payload) return
                if (payload.kind === 'track') {
                  dispatch({
                    type: 'assign',
                    blockId: block.id,
                    trackIds: payload.data.trackIds,
                    index,
                  })
                } else {
                  dispatch({
                    type: 'moveEntry',
                    fromBlockId: payload.data.blockId,
                    entryId: payload.data.entryId,
                    toBlockId: block.id,
                    toIndex: index,
                  })
                }
              }}
            >
              <div className="entry-head">
                <span className="faint mono tiny">{index + 1}</span>
                {/* A song missing from the library has nothing to preview. */}
                {track && <PreviewButton track={track} />}
                {track?.albumArt ? (
                  <img className="art" src={track.albumArt} alt="" />
                ) : (
                  <div className="art">♪</div>
                )}
                <div className="track-meta">
                  <div className="track-name truncate">{track?.name ?? 'Song not in library'}</div>
                  <div className="track-sub truncate">
                    {track ? `${track.artists} · ${formatDuration(track.durationMs)}` : entry.trackId}
                  </div>
                </div>
                <button
                  className="btn ghost icon sm"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() =>
                    dispatch({ type: 'reorderEntry', blockId: block.id, entryId: entry.id, delta: -1 })
                  }
                >
                  ↑
                </button>
                <button
                  className="btn ghost icon sm"
                  title="Move down"
                  disabled={index === block.entries.length - 1}
                  onClick={() =>
                    dispatch({ type: 'reorderEntry', blockId: block.id, entryId: entry.id, delta: 1 })
                  }
                >
                  ↓
                </button>
                <button
                  className="btn ghost icon sm"
                  title="Remove from this block"
                  onClick={() => dispatch({ type: 'unassign', blockId: block.id, entryId: entry.id })}
                >
                  ×
                </button>
              </div>
              {/* The song's own note, shown read-only here: it belongs to
                  the song rather than this placement, so it is edited in the
                  library where that scope is obvious. */}
              {track?.notes?.trim() && (
                <div className="track-note-echo" title="Note on this song, everywhere it appears">
                  ⊙ {track.notes}
                </div>
              )}
              <textarea
                className="entry-note"
                rows={1}
                value={entry.note}
                placeholder="Cue note — “fade at 2:10”, “sing-along”, “skip verse 2”…"
                onChange={(e) =>
                  dispatch({
                    type: 'setEntryNote',
                    blockId: block.id,
                    entryId: entry.id,
                    note: e.target.value,
                  })
                }
              />
            </div>
          )
        })}

        <div className="section-label">Block actions</div>
        <div className="row wrap">
          <button
            className="btn sm"
            disabled={status !== 'connected' || pushState.busy || !block.entries.length}
            onClick={pushToSpotify}
            title={
              status === 'connected'
                ? 'Create a playlist in your own Spotify from this block'
                : 'Connect your own Spotify first'
            }
          >
            {pushState.busy ? 'Working…' : 'Save block as Spotify playlist'}
          </button>
          <button
            className="btn sm danger"
            onClick={() => {
              if (confirm(`Delete the block “${block.title}”?`)) {
                dispatch({ type: 'deleteBlock', id: block.id })
                onClose()
              }
            }}
          >
            Delete block
          </button>
        </div>
        {pushState.message && (
          <div className="hint">
            {pushState.message}{' '}
            {pushState.url && (
              <a href={pushState.url} target="_blank" rel="noreferrer">
                Open in Spotify
              </a>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
