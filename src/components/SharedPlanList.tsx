import { useCallback, useEffect, useState } from 'react'
import { appUrl } from '../lib/basePath.ts'

type PlanRow = {
  id: string
  name: string
  spotify_playlist_id: string | null
  updated_at: number
}

type Counts = { people: number; links: number }

/**
 * Delete a shared playlist, owner only.
 *
 * The Playlists card elsewhere in settings manages the browser's own plans
 * and has no bearing on a shared one, whose copy lives on the server — so
 * this is the only place a shared plan can be removed.
 *
 * Deleting cascades to collaborators and share links, which is why the
 * confirm says how many people it affects rather than just asking twice.
 */
export default function SharedPlanList({ activePlanId }: { activePlanId: string }) {
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [counts, setCounts] = useState<Record<string, Counts>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(appUrl('api/plans'))
      if (!res.ok) return
      const data = (await res.json()) as { plans: PlanRow[]; counts?: Record<string, Counts> }
      setPlans(data.plans ?? [])
      setCounts(data.counts ?? {})
    } catch {
      // Offline: the card simply stays empty rather than showing an error
      // for something the user did not ask for.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (plan: PlanRow) => {
    const c = counts[plan.id]
    const others = c ? Math.max(0, c.people - 1) : 0
    const lines = [`Delete “${plan.name}”?`, '']
    if (others > 0) {
      lines.push(
        `${others} ${others === 1 ? 'person loses' : 'people lose'} access and ` +
          `${c && c.links === 1 ? 'the invite link stops' : 'any invite links stop'} working.`,
        '',
      )
    }
    lines.push('Its songs, sections and schedule go with it. This cannot be undone.')
    if (!confirm(lines.join('\n'))) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(appUrl(`api/plans/${plan.id}`), { method: 'DELETE' })
      if (!res.ok) {
        throw new Error(((await res.json()) as { error?: string }).error ?? 'Could not delete it.')
      }
      // Deleting the open plan issues a new session for another one, so a
      // reload is the honest way to land wherever the server put us.
      if (plan.id === activePlanId) window.location.reload()
      else {
        await load()
        setBusy(false)
      }
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  if (plans.length < 2) return null

  return (
    <div className="card">
      <h3>Shared playlists</h3>
      <p className="tiny muted" style={{ marginTop: 4 }}>
        Every playlist on this Spotify account. Deleting one removes it for everyone who has
        its link.
      </p>
      {error && <div className="notice error">{error}</div>}
      {plans.map((p) => {
        const c = counts[p.id]
        return (
          <div className="row" key={p.id} style={{ marginBottom: 6 }}>
            <span className="grow truncate">
              {p.name || 'Untitled'}
              {p.id === activePlanId && <span className="tiny faint"> · open now</span>}
            </span>
            {c && (
              <span className="pill" title={`${c.people} with access · ${c.links} invite link(s)`}>
                {c.people}◦
              </span>
            )}
            <button
              className="btn sm danger"
              disabled={busy}
              onClick={() => void remove(p)}
              title={`Delete “${p.name}” for everyone`}
            >
              Delete
            </button>
          </div>
        )
      })}
    </div>
  )
}
