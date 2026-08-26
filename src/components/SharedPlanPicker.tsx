import { useCallback, useEffect, useState } from 'react'
import { appUrl } from '../lib/basePath.ts'

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
    try {
      // Owners see every plan on the account; collaborators see the ones
      // they have been invited to under this name, which a single
      // name-and-password sign-in unlocks.
      const res = await fetch(appUrl(canManage ? 'api/plans' : 'api/my-plans'))
      if (!res.ok) return
      const data = (await res.json()) as { plans: (PlanRow & { planId?: string })[] }
      // The two endpoints name the id differently; normalise here so the
      // rest of the component does not care which one answered.
      setPlans(data.plans.map((p) => ({ ...p, id: p.id ?? p.planId ?? '' })))
    } catch {
      // Offline: keep showing just the active plan rather than an error.
    }
  }, [canManage])

  useEffect(() => {
    void load()
  }, [load])

  // A collaborator invited to only one plan has nothing to switch between,
  // so the picker would just be a dropdown with a single entry.
  if (!canManage && plans.length < 2) {
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
      const res = await fetch(
        appUrl(canManage ? `api/plans/${planId}/open` : `api/my-plans/${planId}/open`),
        { method: 'POST' },
      )
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
      const res = await fetch(appUrl('api/plans'), {
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
      {canManage && (
        <>
          <option disabled>──────────</option>
          <option value={NEW_PLAN}>+ New playlist plan…</option>
        </>
      )}
    </select>
  )
}
