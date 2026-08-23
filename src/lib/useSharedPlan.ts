/**
 * Live connection to a shared plan.
 *
 * Edits apply locally first so dragging stays instant, then go to the
 * server. The server assigns an order and echoes everyone's ops back;
 * because every client applies the same ops in the same sequence, they all
 * converge. A snapshot always wins over local state — it is the server's
 * authoritative view.
 *
 * When the socket is down, edits queue and flush on reconnect. The plan
 * stays editable offline; it just is not shared until the link returns.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Plan } from './types.ts'
import type { ClientMessage, Op, Presence, ServerMessage, SyncState } from './protocol.ts'
import { applyOps } from './applyOp.ts'

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'denied'

export type SharedPlan = {
  connection: ConnectionState
  plan: Plan | null
  you: Presence | null
  peers: Presence[]
  sync: SyncState
  /** Ops made locally that the server has not acknowledged yet. */
  pending: number
  error: string | null
  send: (ops: Op[]) => void
}

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
/** Keeps intermediaries from closing an idle socket. */
const PING_MS = 30_000

const IDLE_SYNC: SyncState = {
  status: 'off',
  lastSyncedAt: null,
  error: null,
  playlistName: null,
}

/**
 * @param enabled false for a purely local plan, which skips the socket
 *        entirely and leaves the app working exactly as it did before.
 */
export function useSharedPlan(enabled: boolean): SharedPlan {
  const [connection, setConnection] = useState<ConnectionState>(enabled ? 'connecting' : 'offline')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [you, setYou] = useState<Presence | null>(null)
  const [peers, setPeers] = useState<Presence[]>([])
  const [sync, setSync] = useState<SyncState>(IDLE_SYNC)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)

  const socketRef = useRef<WebSocket | null>(null)
  const queueRef = useRef<{ seq: number; ops: Op[] }[]>([])
  const seqRef = useRef(0)
  const attemptRef = useRef(0)
  const closedRef = useRef(false)

  const flush = useCallback(() => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    for (const item of queueRef.current) {
      const message: ClientMessage = { t: 'ops', ops: item.ops, clientSeq: item.seq }
      socket.send(JSON.stringify(message))
    }
  }, [])

  const send = useCallback(
    (ops: Op[]) => {
      if (!ops.length) return
      // Optimistic: the local plan moves now, so the UI never waits on a
      // round trip. The server's echo is what makes it durable.
      setPlan((prev) => (prev ? applyOps(prev, ops) : prev))

      if (!enabled) return
      const seq = ++seqRef.current
      queueRef.current.push({ seq, ops })
      setPending(queueRef.current.length)
      flush()
    },
    [enabled, flush],
  )

  useEffect(() => {
    if (!enabled) return
    closedRef.current = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let pingTimer: number | undefined

    const connect = () => {
      if (closedRef.current) return
      setConnection((c) => (c === 'online' ? 'connecting' : c))

      const url = new URL('/api/socket', window.location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(url.toString())
      socketRef.current = socket

      socket.addEventListener('open', () => {
        attemptRef.current = 0
        setConnection('online')
        setError(null)
        // Anything queued while offline goes out now.
        flush()
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ t: 'ping' } satisfies ClientMessage))
          }
        }, PING_MS)
      })

      socket.addEventListener('message', (event) => {
        let message: ServerMessage
        try {
          message = JSON.parse(event.data as string) as ServerMessage
        } catch {
          return
        }

        switch (message.t) {
          case 'snapshot':
            // The server's copy is authoritative. Local ops the server has
            // not seen are still queued and will replay on top.
            setPlan(message.doc as Plan)
            setYou(message.you)
            setPeers(message.peers)
            setSync(message.sync)
            break
          case 'ops':
            // Someone else's edit. Ours arrive as an ack instead, since we
            // already applied them locally.
            setPlan((prev) => (prev ? applyOps(prev, message.ops) : prev))
            break
          case 'ack':
            queueRef.current = queueRef.current.filter((q) => q.seq !== message.clientSeq)
            setPending(queueRef.current.length)
            break
          case 'presence':
            setPeers(message.peers)
            break
          case 'sync':
            setSync(message.sync)
            break
          case 'error':
            setError(message.message)
            if (message.fatal) {
              closedRef.current = true
              setConnection('denied')
              socket?.close()
            }
            break
        }
      })

      const scheduleReconnect = () => {
        if (closedRef.current) return
        setConnection('offline')
        window.clearInterval(pingTimer)
        // Back off so a server outage does not turn into a retry storm.
        const wait = Math.min(RECONNECT_BASE_MS * 2 ** attemptRef.current, RECONNECT_MAX_MS)
        attemptRef.current += 1
        reconnectTimer = window.setTimeout(connect, wait)
      }

      socket.addEventListener('close', scheduleReconnect)
      socket.addEventListener('error', () => socket?.close())
    }

    connect()

    return () => {
      closedRef.current = true
      window.clearTimeout(reconnectTimer)
      window.clearInterval(pingTimer)
      socket?.close()
      socketRef.current = null
    }
  }, [enabled, flush])

  return useMemo(
    () => ({ connection, plan, you, peers, sync, pending, error, send }),
    [connection, plan, you, peers, sync, pending, error, send],
  )
}
