import { useCallback, useEffect, useState } from 'react'

type PlanRow = {
  id: string
  name: string
  spotify_playlist_id: string | null
  updated_at: number
}

const NEW_PLAN = '__new_plan__'

/**
 * Playlist switcher for a shared plan.
 *
 * A session is bound to one plan on the server, so switching or creating
 * one means asking the server for a new session and reloading — unlike the
 * local-only picker, which just changes which plan the store reads.
 */
export default function SharedPlanPicker({
  activePlanId,
  activeName,
  canManage,
}: {
  activePlanId: string
  activeName: string
  canManage: boolean
}) {
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!canManage) return
    try {
      const res = await fetch('/api/plans')
      if (!res.ok) return
      const data = (await res.json()) as { plans: PlanRow[] }
      setPlans(data.plans)
    } catch {
      // Offline: keep showing just the active plan rather than an error.
    }
  }, [canManage])

  useEffect(() => {
    void load()
  }, [load])

  // A collaborator only has the one plan their link was for.
  if (!canManage) {
    return (
      <span className="pill truncate" title={activeName}>
        {activeName}
      </span>
    )
  }

  const go = async (planId: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/plans/${planId}/open`, { method: 'POST' })
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Could not open that playlist.')
      // The session cookie changed, so reload rather than trying to
      // re-point the live socket at a different plan.
      window.location.reload()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const create = async () => {
    const name = window.prompt('Name for the new playlist plan?', 'Camp Week 2')
    if (name === null) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'New playlist' }),
      })
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Could not create it.')
      window.location.reload()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  // Before the list loads, at least show the plan we are in.
  const options = plans.length ? plans : [{ id: activePlanId, name: activeName, spotify_playlist_id: null, updated_at: 0 }]

  return (
    <select
      style={{ width: 'auto', maxWidth: 220 }}
      value={activePlanId}
      disabled={busy}
      onChange={(e) => {
        const value = e.target.value
        if (value === NEW_PLAN) void create()
        else if (value !== activePlanId) void go(value)
      }}
      aria-label="Playlist"
      title={error ?? 'Each playlist has its own sections and schedule'}
    >
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      <option disabled>──────────</option>
      <option value={NEW_PLAN}>+ New playlist plan…</option>
    </select>
  )
}
