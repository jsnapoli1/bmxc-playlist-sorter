import type { Track } from '../lib/types.ts'
import { usePreviewPlayer } from '../lib/usePreviewPlayer.tsx'

/**
 * Play or stop a 30-second sample of one song.
 *
 * Shows a progress ring while playing so it is obvious the clip is finite,
 * and reports a failed lookup on the button's own tooltip rather than in a
 * banner somewhere else.
 */
export default function PreviewButton({ track }: { track: Track }) {
  const { trackId, status, progress, failure, substitute, toggle } = usePreviewPlayer()

  const isThis = trackId === track.id
  const loading = isThis && status === 'loading'
  const playing = isThis && status === 'playing'
  const failed = failure?.trackId === track.id
  const swapped = substitute?.trackId === track.id

  const title = failed
    ? failure.reason
    : playing
      ? 'Stop'
      : swapped
        ? `Preview via Apple: ${substitute.matched}`
        : `Play a 30-second sample of “${track.name}”`

  return (
    <button
      className={`preview-btn${playing ? ' playing' : ''}${failed ? ' failed' : ''}`}
      onClick={(e) => {
        // These rows are draggable and clickable; playing should do neither.
        e.stopPropagation()
        toggle(track)
      }}
      onMouseDown={(e) => e.stopPropagation()}
      // A draggable ancestor otherwise steals the pointer before the click.
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      title={title}
      aria-label={title}
    >
      {playing && (
        <span
          className="preview-ring"
          style={{ background: `conic-gradient(var(--accent) ${progress * 360}deg, transparent 0)` }}
          aria-hidden="true"
        />
      )}
      <span className="preview-glyph" aria-hidden="true">
        {loading ? '⋯' : playing ? '■' : failed ? '—' : '▶'}
      </span>
    </button>
  )
}
