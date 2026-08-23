import { useCallback, useEffect, useRef, useState } from 'react'
import {
  boop as boopState,
  initialState,
  tick,
  type DuckState,
} from './duckState.ts'

const STORAGE_KEY = 'cps.duckpal.v1'

/** How often the simulation advances while the tab is open. */
const TICK_MS = 30_000

function load(now: number, placed: number): DuckState {
  const fresh = initialState(now, placed)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fresh
    const saved = JSON.parse(raw) as Partial<DuckState>
    // Merge over a fresh state so a partial or older payload can't produce
    // NaN stats that would render a broken meter.
    const merged: DuckState = {
      ...fresh,
      ...saved,
      bond: Number.isFinite(saved.bond) ? Number(saved.bond) : fresh.bond,
      energy: Number.isFinite(saved.energy) ? Number(saved.energy) : fresh.energy,
      lastTick: Number.isFinite(saved.lastTick) ? Number(saved.lastTick) : now,
      lastPlaced: Number.isFinite(saved.lastPlaced) ? Number(saved.lastPlaced) : placed,
    }
    // Catch up on the time spent away before the first render.
    return tick(merged, now, placed)
  } catch {
    // A corrupt payload shouldn't take the app down; start the pair over.
    return fresh
  }
}

export function useDuckPal(placed: number) {
  // Lazy init so localStorage is read once, not on every render.
  const [state, setState] = useState<DuckState>(() => load(Date.now(), placed))
  const [booping, setBooping] = useState(false)
  const boopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Advance on a timer, and immediately whenever the placed count changes so
  // dropping a song into the schedule feeds the ducks right away.
  useEffect(() => {
    setState((s) => tick(s, Date.now(), placed))
    const id = setInterval(() => setState((s) => tick(s, Date.now(), placed)), TICK_MS)
    return () => clearInterval(id)
  }, [placed])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Private-mode quota errors are not worth surfacing for a pet.
    }
  }, [state])

  useEffect(() => () => {
    if (boopTimer.current) clearTimeout(boopTimer.current)
  }, [])

  const boop = useCallback(() => {
    setState((s) => boopState(s, Date.now()))
    // The reaction plays on every click even when the energy gain is on
    // cooldown, so the widget never feels unresponsive.
    setBooping(true)
    if (boopTimer.current) clearTimeout(boopTimer.current)
    boopTimer.current = setTimeout(() => setBooping(false), 460)
  }, [])

  const setDismissed = useCallback((dismissed: boolean) => {
    setState((s) => ({ ...s, dismissed }))
  }, [])

  return { state, booping, boop, setDismissed }
}
