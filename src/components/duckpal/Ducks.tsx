import type { Mood } from './duckState.ts'

type DuckProps = {
  body: string
  belly: string
}

/**
 * One duck, drawn facing right. Facing is set by the parent via a transform on
 * this <svg>, never on the wrapper, so the wrapper's keyframes compose with it
 * instead of clobbering the mirror.
 */
function Duck({ body, belly }: DuckProps) {
  return (
    <svg width="66" height="62" viewBox="0 0 66 62" fill="none" aria-hidden="true">
      {/* The tail is the contact point for the rub, so it sticks out properly. */}
      <path className="dp-tail" d="M9 33 q-9 -3 -12 -12 q10 1 17 6 z" fill={body} />
      <ellipse cx="30" cy="38" rx="24" ry="18" fill={body} />
      <ellipse cx="32" cy="43" rx="16" ry="10" fill={belly} opacity=".55" />
      <path d="M20 34 q11 -6 21 1 q-9 9 -21 -1 z" fill={belly} opacity=".8" />
      <circle cx="45" cy="19" r="12" fill={body} />
      <path d="M56 19 q9 2 9 5 q-6 3 -10 0 z" fill="#fbbf24" />
      <circle className="dp-pupil" cx="49" cy="16" r="2.4" fill="#0e1116" />
      <circle className="dp-pupil" cx="49.9" cy="15.2" r=".8" fill="#fff" />
      <path
        className="dp-eyelid"
        d="M46 16 q3 2.5 6 0"
        stroke="#0e1116"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M25 55 l0 4 M22 59 l6 0" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
      <path d="M38 55 l0 4 M35 59 l6 0" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

type DucksProps = {
  mood: Mood
  /** Set briefly after a click to play the boop reaction. */
  booping: boolean
}

/**
 * The two-duck scene. Purely presentational - all behaviour lives in the mood
 * and booping props, all motion in duckpal.css.
 */
export default function Ducks({ mood, booping }: DucksProps) {
  return (
    <div className={`dp-scene dp-${mood}${booping ? ' dp-booping' : ''}`}>
      <span className="dp-shadow" />
      <span className="dp-puff" />
      <span className="dp-puff" />
      <span className="dp-puff" />
      <span className="dp-heart">♥</span>
      <span className="dp-zzz">z</span>
      <span className="dp-zzz">z</span>
      <span className="dp-zzz">z</span>
      <div className="dp-duck dp-duck-l">
        <Duck body="#e8edf3" belly="#c3ccd8" />
      </div>
      <div className="dp-duck dp-duck-r">
        <Duck body="#97a3b3" belly="#78859a" />
      </div>
    </div>
  )
}
