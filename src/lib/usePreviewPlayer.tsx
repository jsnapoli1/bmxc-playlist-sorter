/**
 * One audio player for the whole app.
 *
 * Previews are short and exploratory — you click through a lot of songs
 * while sorting — so playing a second song must stop the first rather than
 * layering. A single shared <audio> element makes that automatic and means
 * only one thing can ever be making noise.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Track } from './types.ts'
import { resolvePreview } from './preview.ts'

type PlayerState = {
  /** Track currently playing, or being looked up. */
  trackId: string | null
  status: 'idle' | 'loading' | 'playing'
  /** 0–1 through the clip, for the progress ring. */
  progress: number
  /** Why the last attempt produced nothing, keyed to that track. */
  failure: { trackId: string; reason: string } | null
  /** Set when the audio came from iTunes rather than Spotify. */
  substitute: { trackId: string; matched: string } | null
}

type PlayerValue = PlayerState & {
  toggle: (track: Track) => void
  stop: () => void
}

const PreviewPlayerContext = createContext<PlayerValue | null>(null)

export function PreviewPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [state, setState] = useState<PlayerState>({
    trackId: null,
    status: 'idle',
    progress: 0,
    failure: null,
    substitute: null,
  })
  // Guards against a slow lookup resolving after the user moved on.
  const wantedRef = useRef<string | null>(null)

  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current
    const audio = new Audio()
    audio.preload = 'none'
    audioRef.current = audio
    return audio
  }, [])

  const stop = useCallback(() => {
    wantedRef.current = null
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setState((s) => ({ ...s, trackId: null, status: 'idle', progress: 0 }))
  }, [])

  const toggle = useCallback(
    (track: Track) => {
      // Clicking the song that is already playing stops it.
      if (state.trackId === track.id && state.status !== 'idle') {
        stop()
        return
      }

      const audio = ensureAudio()
      audio.pause()
      wantedRef.current = track.id
      setState({
        trackId: track.id,
        status: 'loading',
        progress: 0,
        failure: null,
        substitute: null,
      })

      void resolvePreview(track).then((result) => {
        // Another song was clicked while this one was resolving.
        if (wantedRef.current !== track.id) return

        if (result.status === 'none') {
          wantedRef.current = null
          setState({
            trackId: null,
            status: 'idle',
            progress: 0,
            failure: { trackId: track.id, reason: result.reason },
            substitute: null,
          })
          return
        }

        audio.src = result.url
        void audio
          .play()
          .then(() => {
            if (wantedRef.current !== track.id) return
            setState((s) => ({
              ...s,
              status: 'playing',
              substitute:
                result.source === 'itunes' && result.matched
                  ? { trackId: track.id, matched: result.matched }
                  : null,
            }))
          })
          .catch(() => {
            if (wantedRef.current !== track.id) return
            wantedRef.current = null
            setState({
              trackId: null,
              status: 'idle',
              progress: 0,
              // Autoplay policies block audio without a user gesture; every
              // path here is behind a click, so this is usually a dead URL.
              failure: { trackId: track.id, reason: 'That preview would not play.' },
              substitute: null,
            })
          })
      })
    },
    [ensureAudio, state.trackId, state.status, stop],
  )

  // Track progress and clean up when the clip ends.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => {
      if (!audio.duration || !Number.isFinite(audio.duration)) return
      setState((s) => (s.status === 'playing' ? { ...s, progress: audio.currentTime / audio.duration } : s))
    }
    const onEnded = () => {
      wantedRef.current = null
      setState((s) => ({ ...s, trackId: null, status: 'idle', progress: 0 }))
    }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnded)
    }
  }, [state.status])

  // Stop audio if the tab goes away, and on unmount.
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  // Space is a natural "stop", but not while typing a name or a note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      if (state.status !== 'idle') stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.status, stop])

  const value = useMemo<PlayerValue>(() => ({ ...state, toggle, stop }), [state, toggle, stop])

  return <PreviewPlayerContext.Provider value={value}>{children}</PreviewPlayerContext.Provider>
}

export function usePreviewPlayer(): PlayerValue {
  const ctx = useContext(PreviewPlayerContext)
  if (!ctx) throw new Error('usePreviewPlayer must be used inside <PreviewPlayerProvider>')
  return ctx
}
