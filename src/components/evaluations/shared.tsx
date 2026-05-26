// title: Shared helpers for the Evaluations view
// path: src/components/evaluations/shared.tsx
// purpose: Small formatting + color helpers reused across evaluation panels.

import { clsx } from 'clsx'
import type { RunOutcome } from '../../lib/api'

export const fmtNum = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

export const fmtPct = (n: number | null | undefined, digits = 0): string =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}%`

export const fmtDuration = (ms: number): string => {
  if (!ms || !Number.isFinite(ms)) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60); const rem = s % 60
  if (m < 60) return `${m}m ${rem}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export const fmtTimeAgo = (iso: string | null): string => {
  if (!iso) return '—'
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  const m = Math.floor(sec / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60);   if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Score → color, matching the rest of the app's accents.
export const scoreColor = (score: number | null): string => {
  if (score == null) return 'text-text-muted'
  if (score >= 80) return 'text-accent-green'
  if (score >= 60) return 'text-accent-teal'
  if (score >= 45) return 'text-accent-amber'
  return 'text-accent-red'
}

export const scoreBg = (score: number | null): string => {
  if (score == null) return 'bg-white/5'
  if (score >= 80) return 'bg-emerald-500/20'
  if (score >= 60) return 'bg-teal-500/20'
  if (score >= 45) return 'bg-amber-500/20'
  return 'bg-red-500/20'
}

export const outcomeColor = (o: RunOutcome): string => {
  switch (o) {
    case 'success':    return 'text-accent-green'
    case 'recovered':  return 'text-accent-teal'
    case 'partial':    return 'text-accent-amber'
    case 'stalled':    return 'text-accent-amber'
    case 'failure':    return 'text-accent-red'
    case 'unresolved': return 'text-text-muted'
  }
}

export const outcomeBg = (o: RunOutcome): string => {
  switch (o) {
    case 'success':    return 'bg-emerald-500/15 border-emerald-500/30'
    case 'recovered':  return 'bg-teal-500/15 border-teal-500/30'
    case 'partial':    return 'bg-amber-500/15 border-amber-500/30'
    case 'stalled':    return 'bg-amber-500/10 border-amber-500/20'
    case 'failure':    return 'bg-red-500/15 border-red-500/30'
    case 'unresolved': return 'bg-white/5 border-white/10'
  }
}

export function OutcomeBadge({ outcome }: { outcome: RunOutcome }) {
  return (
    <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border', outcomeBg(outcome), outcomeColor(outcome))}>
      {outcome}
    </span>
  )
}

export function PlatformBadge({ platform }: { platform: 'hermes' | 'openclaw' }) {
  const isOc = platform === 'openclaw'
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold',
      isOc ? 'bg-cyan-500/15 text-cyan-300' : 'bg-violet-500/15 text-violet-300',
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', isOc ? 'bg-cyan-400' : 'bg-violet-400')} />
      {isOc ? 'OpenClaw' : 'Hermes'}
    </span>
  )
}

export function HeuristicTag({ tip }: { tip?: string }) {
  return (
    <span
      title={tip ?? 'Heuristic / inferred — every per-run metric is derived from real transcripts but can be wrong'}
      className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium bg-white/5 text-text-muted border border-white/10 cursor-help"
    >
      heuristic
    </span>
  )
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 gap-2 text-text-muted">
      {icon && <div className="opacity-40">{icon}</div>}
      <p className="text-sm">{title}</p>
      {hint && <p className="text-xs opacity-70 text-center max-w-md">{hint}</p>}
    </div>
  )
}

export function NotConnected({ platform }: { platform: 'hermes' | 'openclaw' }) {
  return (
    <div className="mx-6 my-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
      <p className="text-sm text-amber-300 font-medium">{platform} is not connected.</p>
      <p className="text-xs text-text-muted mt-1">
        Enable the connector and add a token under Settings to start collecting real run data.
        Until then this tab will stay empty — no fabricated runs.
      </p>
    </div>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-6 my-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
      <p className="text-sm text-red-300">{message}</p>
    </div>
  )
}
