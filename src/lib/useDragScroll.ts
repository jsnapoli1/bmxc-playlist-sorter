/**
 * Scrolling a list while dragging over it.
 *
 * HTML5 drag-and-drop does not scroll a container on its own, so dragging a
 * song from the bottom of a long playlist to the top is otherwise
 * impossible — you run out of screen with nowhere to drop. This watches the
 * pointer during a drag and scrolls when it nears an edge, faster the
 * closer it gets.
 */

import { useCallback, useEffect, useRef } from 'react'

/** How far from an edge the pointer starts to pull the list, in px. */
const EDGE_ZONE = 90
/** Fastest scroll, in px per frame (~60fps → ~1000px/s). */
const MAX_SPEED = 17
/** Slowest, so a barely-in-zone pointer still creeps rather than sticking. */
const MIN_SPEED = 2

export type DragScroll = {
  /** Attach to the scrolling element. */
  ref: (node: HTMLElement | null) => void
  /** Call from onDragOver with the pointer's clientY. */
  update: (clientY: number) => void
  /** Call on drop / dragend / dragleave. */
  stop: () => void
}

/**
 * @param enabled false outside a drag, so no listeners or frames run when
 *        nothing is being dragged.
 */
export function useDragScroll(): DragScroll {
  const elementRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const velocityRef = useRef(0)

  const stop = useCallback(() => {
    velocityRef.current = 0
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const step = useCallback(() => {
    const element = elementRef.current
    const velocity = velocityRef.current
    if (!element || velocity === 0) {
      frameRef.current = null
      return
    }

    const before = element.scrollTop
    element.scrollTop = before + velocity

    // Hitting either end means there is nothing left to scroll; stop
    // rather than burning frames.
    if (element.scrollTop === before) {
      frameRef.current = null
      velocityRef.current = 0
      return
    }
    frameRef.current = requestAnimationFrame(step)
  }, [])

  const update = useCallback(
    (clientY: number) => {
      const element = elementRef.current
      if (!element) return

      const box = element.getBoundingClientRect()
      const fromTop = clientY - box.top
      const fromBottom = box.bottom - clientY

      let velocity = 0
      if (fromTop < EDGE_ZONE) {
        // Ramp from MIN at the edge of the zone to MAX at the boundary,
        // so precise adjustments near a target stay controllable.
        const depth = Math.max(0, Math.min(1, (EDGE_ZONE - fromTop) / EDGE_ZONE))
        velocity = -(MIN_SPEED + depth * (MAX_SPEED - MIN_SPEED))
      } else if (fromBottom < EDGE_ZONE) {
        const depth = Math.max(0, Math.min(1, (EDGE_ZONE - fromBottom) / EDGE_ZONE))
        velocity = MIN_SPEED + depth * (MAX_SPEED - MIN_SPEED)
      }

      velocityRef.current = velocity
      if (velocity !== 0 && frameRef.current === null) {
        frameRef.current = requestAnimationFrame(step)
      } else if (velocity === 0) {
        stop()
      }
    },
    [step, stop],
  )

  const ref = useCallback((node: HTMLElement | null) => {
    elementRef.current = node
  }, [])

  // A drag can end anywhere — outside the window, on another element, or by
  // pressing Escape — and any of those must stop the scrolling.
  useEffect(() => {
    const onEnd = () => stop()
    window.addEventListener('dragend', onEnd)
    window.addEventListener('drop', onEnd)
    return () => {
      window.removeEventListener('dragend', onEnd)
      window.removeEventListener('drop', onEnd)
      stop()
    }
  }, [stop])

  return { ref, update, stop }
}
