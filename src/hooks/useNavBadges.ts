import { useCallback, useEffect, useState } from 'react'
import type { View } from '../types'
import { apiFetch } from '../lib/apiTransport.js'

type BadgeCounts = {
  tasks: number
  approvals: number
  inbox: number
  todos: number
  tobuy: number
  health: number
}

const EMPTY_BADGES: BadgeCounts = {
  tasks: 0,
  approvals: 0,
  inbox: 0,
  todos: 0,
  tobuy: 0,
  health: 0,
}

export function useNavBadges(): {
  getBadge: (view: View) => number | undefined
  healthWarning: boolean
} {
  const [badges, setBadges] = useState<BadgeCounts>(EMPTY_BADGES)

  useEffect(() => {
    let alive = true

    const fetchCounts = async () => {
      try {
        const [tRes, aRes, dRes, iRes, bRes, hRes] = await Promise.all([
          apiFetch<{ tasks?: Array<{ status: string }> }>('/api/tasks'),
          apiFetch<{ approvals?: Array<{ status: string }> }>('/api/approvals'),
          apiFetch<{ todos?: Array<{ done: boolean }> }>('/api/todos'),
          apiFetch<{ counts?: { active?: number } }>('/api/inbox'),
          apiFetch<{ items?: Array<{ purchased: boolean }> }>('/api/tobuy'),
          apiFetch<{ alerts?: Array<{ severity: string }> }>('/api/alerts/active'),
        ])
        if (!alive) return

        setBadges({
          tasks: (tRes.tasks ?? []).filter((task) => task.status !== 'completed').length,
          approvals: (aRes.approvals ?? []).filter((approval) => approval.status === 'pending').length,
          todos: (dRes.todos ?? []).filter((todo) => !todo.done).length,
          inbox: Number(iRes.counts?.active ?? 0),
          tobuy: (bRes.items ?? []).filter((item) => !item.purchased).length,
          health: (hRes.alerts ?? []).filter(
            (alert) => alert.severity === 'critical' || alert.severity === 'warning',
          ).length,
        })
      } catch {
        // Badges are decorative; stale or missing counts should not block navigation.
      }
    }

    void fetchCounts()
    const timer = setInterval(fetchCounts, 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const getBadge = useCallback((view: View): number | undefined => {
    if (view === 'todos') {
      const total = badges.todos + badges.tasks + badges.approvals + badges.inbox
      return total > 0 ? total : undefined
    }
    if (view === 'tobuy') return badges.tobuy > 0 ? badges.tobuy : undefined
    if (view === 'health') return badges.health > 0 ? badges.health : undefined
    return undefined
  }, [badges])

  return {
    getBadge,
    healthWarning: badges.health > 0,
  }
}
