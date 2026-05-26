// title: Run drilldown lists (failures, loops, wasteful runs, recent runs)
// path: src/components/evaluations/Drilldown.tsx

import { useState } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, RotateCcw, Trash2, ListOrdered, ChevronDown, ChevronRight } from 'lucide-react'
import type { EvaluationRun } from '../../lib/api'
import { fmtDuration, fmtTimeAgo, OutcomeBadge, EmptyState, HeuristicTag } from './shared'

type ListKind = 'failures' | 'loops' | 'wasteful' | 'recent'

const HEADERS: Record<ListKind, { title: string; icon: React.ReactNode; hint: string }> = {
  failures: { title: 'Representative failures', icon: <AlertTriangle size={13} className="text-red-400" />, hint: 'Runs whose transcript or status ended in an error with no recovery.' },
  loops:    { title: 'Loop / churn signals',    icon: <RotateCcw    size={13} className="text-amber-400" />, hint: 'Runs with ≥ 3 repeated tool calls or ≥ 4 oscillations.' },
  wasteful: { title: 'Wasted tool patterns',    icon: <Trash2       size={13} className="text-amber-400" />, hint: 'Runs whose tool sequence had the most repeated / no-progress / oscillating calls.' },
  recent:   { title: 'Recent runs',             icon: <ListOrdered  size={13} className="text-violet-400" />, hint: 'Most recent sessions captured for evaluation.' },
}

export function RunList({ kind, runs }: { kind: ListKind; runs: EvaluationRun[] }) {
  const meta = HEADERS[kind]
  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        {meta.icon}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{meta.title}</h3>
        <HeuristicTag tip={meta.hint} />
        <span className="ml-auto text-[10px] text-text-muted">{runs.length}</span>
      </div>
      {runs.length === 0 ? (
        <EmptyState title="Nothing here yet" hint={meta.hint} />
      ) : (
        <div className="divide-y divide-white/5">
          {runs.map(r => <RunRow key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

function RunRow({ r }: { r: EvaluationRun }) {
  const [open, setOpen] = useState(false)
  const seq = r.toolSequence.slice(0, 20)
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
      >
        <OutcomeBadge outcome={r.outcome} />
        <span className="text-text-primary text-xs font-medium truncate flex-1 min-w-0">{r.modelLabel}</span>
        <span className="text-text-muted text-[10px] font-mono truncate w-28 text-right">{r.agent}</span>
        <span className="text-text-muted text-[10px] tabular-nums w-16 text-right">{r.toolCalls}t</span>
        <span className={clsx('text-[10px] tabular-nums w-16 text-right', r.wastedToolCalls > 0 ? 'text-amber-300' : 'text-text-muted')}>
          {r.wastedToolCalls}w
        </span>
        <span className="text-text-muted text-[10px] tabular-nums w-16 text-right">{fmtDuration(r.durationMs)}</span>
        <span className="text-text-muted text-[10px] w-16 text-right">{fmtTimeAgo(r.lastActiveAt)}</span>
        {open ? <ChevronDown size={12} className="text-text-muted" /> : <ChevronRight size={12} className="text-text-muted" />}
      </button>
      {open && (
        <div className="px-4 pb-3 bg-black/20 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-[10px]">
            <Cell label="Session" value={r.id.slice(0, 32)} mono />
            <Cell label="Model" value={r.model} mono />
            <Cell label="Repeats" value={String(r.repeatedToolCalls)} />
            <Cell label="Oscillations" value={String(r.oscillations)} />
            <Cell label="No-progress" value={String(r.noProgressTools)} />
            <Cell label="Tokens" value={r.tokens.toLocaleString()} />
            <Cell label="Cost" value={r.cost ? `$${r.cost.toFixed(4)}` : '—'} />
            <Cell label="Transcript" value={r.transcriptAvailable ? 'available' : 'status-only'} />
          </div>
          {seq.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Tool sequence</p>
              <div className="flex flex-wrap gap-1">
                {seq.map((name, i) => {
                  const prev = i > 0 ? seq[i - 1] : null
                  const repeat = prev === name
                  return (
                    <span key={i} className={clsx(
                      'text-[10px] px-1.5 py-0.5 rounded font-mono',
                      repeat ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-white/5 text-text-muted',
                    )}>
                      {name}
                    </span>
                  )
                })}
                {r.toolSequence.length > seq.length && (
                  <span className="text-[10px] text-text-muted">+{r.toolSequence.length - seq.length} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Cell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-text-muted uppercase tracking-wider">{label}</span>
      <span className={clsx('text-text-primary truncate', mono && 'font-mono')}>{value || '—'}</span>
    </div>
  )
}
