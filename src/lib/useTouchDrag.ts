/**
 * Long-press dragging for touchscreens.
 *
 * HTML5 drag-and-drop does not exist on touch devices, so the playlist is
 * unsortable on a phone without this. Pressing and holding a row for a
 * moment picks it up; it then follows the finger, the list scrolls near the
 * edges, and lifting drops it.
 *
 * Deliberately not a drag from first touch: the list has to stay
 * scrollable, so a plain swipe must scroll rather than pick a song up.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** How long to hold before a press becomes a drag. */
const HOLD_MS = 220
/** Movement beyond this before the hold completes is a scroll, not a drag. */
const SLOP_PX = 10
/** Distance from an edge at which the list starts scrolling. */
const EDGE_ZONE = 80
const MAX_SPEED = 14
const MIN_SPEED = 2

export type TouchDragState = {
  /** Ids being dragged, empty when no drag is active. */
  dragging: string[]
  /** Viewport y of the finger, for positioning the floating row. */
  pointerY: number
  /** The row the finger is currently over, and which half. */
  over: { id: string; below: boolean } | null
  /** A section header the finger is over. */
  overSection: string | null
}

type Options = {
  /** The scrolling container, for edge auto-scroll. */
  scrollRef: React.RefObject<HTMLElement | null>
  /** Called on release with what to move and where. */
  onDrop: (ids: string[], target: { beforeId: string | null; sectionId: string }) => void
  /** Resolve a row element to its track id and section. */
  resolve: (el: Element) => { trackId?: string; sectionId?: string } | null
  /** Ids to move when the pressed row is part of a selection. */
  selectionFor: (id: string) => string[]
  /** Where a drop on a section header should land. */
  firstInSection: (sectionId: string, excluding: Set<string>) => string | null
  /** The id after `id` in render order, for dropping below a row. */
  nextAfter: (id: string) => string | null
}

const IDLE: TouchDragState = { dragging: [], pointerY: 0, over: null, overSection: null }

export function useTouchDrag(options: Options): {
  state: TouchDragState
  onTouchStart: (e: React.TouchEvent, trackId: string) => void
} {
  const [state, setState] = useState<TouchDragState>(IDLE)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const holdTimer = useRef<number | null>(null)
  const startY = useRef(0)
  const startX = useRef(0)
  const activeIds = useRef<string[]>([])
  const target = useRef<{ beforeId: string | null; sectionId: string } | null>(null)
  const scrollFrame = useRef<number | null>(null)
  const velocity = useRef(0)

  const stopScroll = useCallback(() => {
    velocity.current = 0
    if (scrollFrame.current !== null) {
      cancelAnimationFrame(scrollFrame.current)
      scrollFrame.current = null
    }
  }, [])

  const step = useCallback(() => {
    const el = optionsRef.current.scrollRef.current
    if (!el || velocity.current === 0) {
      scrollFrame.current = null
      return
    }
    const before = el.scrollTop
    el.scrollTop = before + velocity.current
    if (el.scrollTop === before) {
      scrollFrame.current = null
      velocity.current = 0
      return
    }
    scrollFrame.current = requestAnimationFrame(step)
  }, [])

  const end = useCallback(() => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    stopScroll()
    const ids = activeIds.current
    const to = target.current
    activeIds.current = []
    target.current = null
    setState(IDLE)
    if (ids.length && to) optionsRef.current.onDrop(ids, to)
  }, [stopScroll])

  /** Work out what is under the finger and remember where a drop would go. */
  const updateFromPoint = useCallback((x: number, y: number) => {
    const el = document.elementFromPoint(x, y)
    if (!el) return

    const row = el.closest('[data-track-id]')
    const header = el.closest('[data-section-id]')
    const moving = new Set(activeIds.current)

    if (row) {
      const info = optionsRef.current.resolve(row)
      const id = info?.trackId
      const sectionId = info?.sectionId
      if (id && sectionId) {
        const box = row.getBoundingClientRect()
        const below = y > box.top + box.height / 2
        const beforeId = below ? optionsRef.current.nextAfter(id) : id
        target.current = { beforeId, sectionId }
        setState((s) => ({ ...s, over: { id, below }, overSection: null }))
        return
      }
    }
    if (header) {
      const sectionId = header.getAttribute('data-section-id')
      if (sectionId) {
        target.current = {
          beforeId: optionsRef.current.firstInSection(sectionId, moving),
          sectionId,
        }
        setState((s) => ({ ...s, over: null, overSection: sectionId }))
      }
    }
  }, [])

  // Move and release are bound to the window so a finger leaving the row —
  // which it always does — keeps the drag alive.
  useEffect(() => {
    if (!state.dragging.length) return

    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      // Now that a drag is under way, the page must not scroll with it.
      e.preventDefault()
      setState((s) => ({ ...s, pointerY: touch.clientY }))
      updateFromPoint(touch.clientX, touch.clientY)

      const el = optionsRef.current.scrollRef.current
      if (!el) return
      const box = el.getBoundingClientRect()
      const fromTop = touch.clientY - box.top
      const fromBottom = box.bottom - touch.clientY
      let v = 0
      if (fromTop < EDGE_ZONE) {
        const depth = Math.min(1, (EDGE_ZONE - fromTop) / EDGE_ZONE)
        v = -(MIN_SPEED + depth * (MAX_SPEED - MIN_SPEED))
      } else if (fromBottom < EDGE_ZONE) {
        const depth = Math.min(1, (EDGE_ZONE - fromBottom) / EDGE_ZONE)
        v = MIN_SPEED + depth * (MAX_SPEED - MIN_SPEED)
      }
      velocity.current = v
      if (v !== 0 && scrollFrame.current === null) scrollFrame.current = requestAnimationFrame(step)
      else if (v === 0) stopScroll()
    }

    // passive:false is required or preventDefault is ignored and the page
    // scrolls underneath the drag.
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', end)
    window.addEventListener('touchcancel', end)
    return () => {
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
    }
  }, [state.dragging.length, end, step, stopScroll, updateFromPoint])

  const onTouchStart = useCallback((e: React.TouchEvent, trackId: string) => {
    const touch = e.touches[0]
    if (!touch) return
    startY.current = touch.clientY
    startX.current = touch.clientX

    const beginDrag = () => {
      holdTimer.current = null
      const ids = optionsRef.current.selectionFor(trackId)
      activeIds.current = ids
      target.current = null
      // A short buzz confirms the pick-up on devices that support it.
      navigator.vibrate?.(10)
      setState({ dragging: ids, pointerY: startY.current, over: null, overSection: null })
    }

    holdTimer.current = window.setTimeout(beginDrag, HOLD_MS)

    // Moving before the hold completes means the user is scrolling.
    const cancelIfMoved = (move: TouchEvent) => {
      const t = move.touches[0]
      if (!t) return
      if (
        Math.abs(t.clientY - startY.current) > SLOP_PX ||
        Math.abs(t.clientX - startX.current) > SLOP_PX
      ) {
        if (holdTimer.current !== null) {
          clearTimeout(holdTimer.current)
          holdTimer.current = null
        }
        cleanup()
      }
    }
    const cancelHold = () => {
      if (holdTimer.current !== null) {
        clearTimeout(holdTimer.current)
        holdTimer.current = null
      }
      cleanup()
    }
    const cleanup = () => {
      window.removeEventListener('touchmove', cancelIfMoved)
      window.removeEventListener('touchend', cancelHold)
      window.removeEventListener('touchcancel', cancelHold)
    }
    window.addEventListener('touchmove', cancelIfMoved, { passive: true })
    window.addEventListener('touchend', cancelHold)
    window.addEventListener('touchcancel', cancelHold)
  }, [])

  return { state, onTouchStart }
}
