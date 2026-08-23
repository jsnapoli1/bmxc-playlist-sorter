import Ducks from './Ducks.tsx'
import { MAX_STAT, moodFor, moodLabel } from './duckState.ts'
import { useDuckPal } from './useDuckPal.ts'
import './duckpal.css'

const DUCK_NAMES = 'Quackers & Bill'

type DuckPalProps = {
  /** Songs placed into the schedule; increases feed the pair. */
  placed: number
}

/**
 * A tamagotchi-style pair of ducks that lives in the bottom-right corner.
 * Their mood tracks how much the plan is being worked on and decays when it
 * isn't; clicking boops them.
 */
export default function DuckPal({ placed }: DuckPalProps) {
  const { state, booping, boop, setDismissed } = useDuckPal(placed)
  const mood = moodFor(state)
  const label = moodLabel(mood)

  if (state.dismissed) {
    return (
      <div className="dp-root">
        <button
          className="dp-tab"
          onClick={() => setDismissed(false)}
          title="Show the ducks"
        >
          <span aria-hidden="true">🦆</span> Ducks
        </button>
      </div>
    )
  }

  return (
    <div className="dp-root">
      <div className="dp-card">
        <button
          className="dp-stage"
          onClick={boop}
          // The pose is decorative; the state it conveys is the useful part.
          aria-label={`${DUCK_NAMES} are ${label}. Click to boop them.`}
        >
          <Ducks mood={mood} booping={booping} />
        </button>
        <div className="dp-body">
          <div className="dp-title">
            <span className="dp-name">{DUCK_NAMES}</span>
            <span className="spacer" style={{ flex: 1 }} />
            <button
              className="dp-collapse"
              onClick={() => setDismissed(true)}
              aria-label="Hide the ducks"
              title="Hide"
            >
              ×
            </button>
          </div>
          <div className="dp-mood">{label}</div>

          <div className="dp-meter">
            <span className="dp-meter-label">bond</span>
            <span className="dp-track">
              <span
                className="dp-fill"
                style={{
                  width: `${Math.round((state.bond / MAX_STAT) * 100)}%`,
                  background: 'var(--accent)',
                }}
              />
            </span>
          </div>
          <div className="dp-meter">
            <span className="dp-meter-label">energy</span>
            <span className="dp-track">
              <span
                className="dp-fill"
                style={{
                  width: `${Math.round((state.energy / MAX_STAT) * 100)}%`,
                  background: 'var(--amber)',
                }}
              />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
