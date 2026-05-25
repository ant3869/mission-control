// Reusable run-trace viewer: compact summary row + waterfall timeline merged with
// a nested span tree. Dependency-free (Tailwind + lucide icons only).

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  Cpu, Brain, Bot, Sparkles, Wrench, Database, MessageSquare,
  ChevronRight, Clock, Coins, DollarSign, Boxes, CircleDot,
} from 'lucide-react'
import type { SpanKind, SpanStatus, TraceRun, TraceSpan } from './types'

// ─── Formatters ─────────────────────────────────────────────────────────────────

function fmtDur(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function fmtCost(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function shortModel(m: string): string {
  if (m.includes('opus')) return 'Opus'
  if (m.includes('haiku')) return 'Haiku'
  if (m.includes('sonnet')) return 'Sonnet'
  return m
}

// ─── Status + kind styling ───────────────────────────────────────────────────────

const STATUS: Record<SpanStatus, { bar: string; dot: string; text: string; badge: string; label: string }> = {
  success: { bar: 'bg-emerald-500',            dot: 'bg-emerald-400',           text: 'text-emerald-400', badge: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300', label: 'Success' },
  running: { bar: 'bg-blue-500 animate-pulse', dot: 'bg-blue-400 animate-pulse', text: 'text-blue-400',    badge: 'bg-blue-500/15 border-blue-500/30 text-blue-300',       label: 'Running' },
  failed:  { bar: 'bg-red-500',                dot: 'bg-red-400',               text: 'text-red-400',     badge: 'bg-red-500/15 border-red-500/30 text-red-300',          label: 'Failed' },
  skipped: { bar: 'bg-slate-600',              dot: 'bg-slate-500',             text: 'text-slate-400',   badge: 'bg-slate-500/15 border-slate-500/30 text-slate-400',     label: 'Skipped' },
}

const KIND_ICON: Record<SpanKind, React.ReactNode> = {
  run:     <Cpu size={12} />,
  plan:    <Brain size={12} />,
  agent:   <Bot size={12} />,
  model:   <Sparkles size={12} />,
  tool:    <Wrench size={12} />,
  memory:  <Database size={12} />,
  message: <MessageSquare size={12} />,
}

const KIND_COLOR: Record<SpanKind, string> = {
  run:     'text-text-primary',
  plan:    'text-amber-300',
  agent:   'text-violet-300',
  model:   'text-blue-300',
  tool:    'text-emerald-300',
  memory:  'text-cyan-300',
  message: 'text-slate-300',
}

// ─── Tree flattening ──────────────────────────────────────────────────────────────

interface Row { span: TraceSpan; depth: number; hasChildren: boolean }

function flatten(spans: TraceSpan[], collapsed: Set<string>): Row[] {
  const byParent = new Map<string | null, TraceSpan[]>()
  const ids = new Set(spans.map(s => s.id))
  for (const s of spans) {
    const key = s.parentId && ids.has(s.parentId) ? s.parentId : null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(s)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.startMs - b.startMs)

  const rows: Row[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const s of byParent.get(parent) ?? []) {
      const kids = byParent.get(s.id) ?? []
      rows.push({ span: s, depth, hasChildren: kids.length > 0 })
      if (kids.length > 0 && !collapsed.has(s.id)) walk(s.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

// ─── Summary row ──────────────────────────────────────────────────────────────────

function SummaryCell({ icon, label, value, accent }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; accent?: string
}) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2 bg-card border border-border rounded-lg min-w-0">
      <span className="flex items-center gap-1 text-xxs uppercase tracking-wider text-text-muted">{icon}{label}</span>
      <span className={clsx('text-sm font-semibold tabular-nums truncate', accent ?? 'text-text-primary')}>{value}</span>
    </div>
  )
}

function Summary({ run }: { run: TraceRun }) {
  const st = STATUS[run.status]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      <SummaryCell icon={<Clock size={10} />} label="Runtime" value={fmtDur(run.durationMs)} />
      <SummaryCell icon={<Coins size={10} />} label="Tokens" value={fmtTok(run.totalTokens)} accent="text-amber-300" />
      <SummaryCell icon={<DollarSign size={10} />} label="Est. cost" value={fmtCost(run.totalCost)} accent="text-emerald-300" />
      <SummaryCell icon={<Boxes size={10} />} label="Models" value={
        <span className="truncate">{run.models.map(shortModel).join(', ') || '—'}</span>
      } />
      <SummaryCell icon={<CircleDot size={10} />} label="Status" value={
        <span className={clsx('inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-xxs font-semibold', st.badge)}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', st.dot)} />{st.label}
        </span>
      } />
    </div>
  )
}

// ─── Payload detail ───────────────────────────────────────────────────────────────

function SpanDetail({ span }: { span: TraceSpan }) {
  return (
    <div className="ml-2 mr-3 mb-1.5 rounded-lg border border-border bg-base/60 p-3 text-xxs">
      <div className="flex flex-wrap gap-x-5 gap-y-1 mb-2 text-text-muted">
        <span>start <span className="text-text-secondary tabular-nums">+{fmtDur(span.startMs)}</span></span>
        <span>duration <span className="text-text-secondary tabular-nums">{fmtDur(span.durationMs)}</span></span>
        {span.model && <span>model <span className="text-blue-300">{span.model}</span></span>}
        {span.tool && <span>tool <span className="text-emerald-300">{span.tool}</span></span>}
        {span.tokens && <span>tokens <span className="text-amber-300 tabular-nums">{span.tokens.input}→{span.tokens.output} ({fmtTok(span.tokens.total)})</span></span>}
        {span.cost != null && <span>cost <span className="text-emerald-300 tabular-nums">{fmtCost(span.cost)}</span></span>}
      </div>
      {span.attributes && Object.keys(span.attributes).length > 0 && (
        <pre className="font-mono text-xxs leading-relaxed text-text-secondary whitespace-pre-wrap break-words max-h-56 overflow-auto">
          {JSON.stringify(span.attributes, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ─── Span row (tree + waterfall) ────────────────────────────────────────────────

function SpanRow({ row, total, open, collapsed, onToggleDetail, onToggleCollapse }: {
  row: Row
  total: number
  open: boolean
  collapsed: boolean
  onToggleDetail: () => void
  onToggleCollapse: () => void
}) {
  const { span, depth, hasChildren } = row
  const st = STATUS[span.status]
  const leftPct = total > 0 ? Math.min((span.startMs / total) * 100, 99) : 0
  const widthPct = total > 0 ? Math.max((span.durationMs / total) * 100, 0.7) : 0
  const labelLeft = leftPct < 60

  const tip = [
    span.name,
    fmtDur(span.durationMs),
    span.tokens ? `${fmtTok(span.tokens.total)} tok` : null,
    span.cost != null ? fmtCost(span.cost) : null,
    span.model ? shortModel(span.model) : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className={clsx('group border-b border-border-subtle', open && 'bg-card/40')}>
      <div className="flex items-stretch hover:bg-card-hover/60 transition-colors">
        {/* Tree / label column */}
        <button
          onClick={onToggleDetail}
          className="flex items-center gap-1.5 py-1.5 pr-2 text-left shrink-0 w-[44%] min-w-[200px]"
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggleCollapse() }}
            className={clsx('shrink-0 w-3.5 flex items-center justify-center', hasChildren ? 'text-text-muted hover:text-text-primary' : 'opacity-0')}
          >
            <ChevronRight size={12} className={clsx('transition-transform', !collapsed && 'rotate-90')} />
          </span>
          <span className={clsx('shrink-0', KIND_COLOR[span.kind])}>{KIND_ICON[span.kind]}</span>
          <span className="text-xs text-text-secondary truncate group-hover:text-text-primary">{span.name}</span>
          {span.kind === 'model' && span.model && (
            <span className="shrink-0 text-xxs text-text-muted">{shortModel(span.model)}</span>
          )}
        </button>

        {/* Waterfall track */}
        <div className="relative flex-1 my-1 mr-3 min-w-0" title={tip}>
          <div className="absolute inset-0 rounded bg-border-subtle/40" />
          <div
            className={clsx('absolute top-0 bottom-0 rounded flex items-center', st.bar)}
            style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 3 }}
          />
          <span
            className={clsx('absolute top-1/2 -translate-y-1/2 text-xxs tabular-nums text-text-muted whitespace-nowrap px-1',
              labelLeft ? '' : 'text-right')}
            style={labelLeft ? { left: `calc(${leftPct + widthPct}% + 4px)` } : { right: `calc(${100 - leftPct}% + 4px)` }}
          >
            {fmtDur(span.durationMs)}
          </span>
        </div>
      </div>
      {open && <SpanDetail span={span} />}
    </div>
  )
}

// ─── Public component ─────────────────────────────────────────────────────────────

export function TraceViewer({ run, className }: { run: TraceRun; className?: string }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [openDetail, setOpenDetail] = useState<Set<string>>(new Set())

  const rows = useMemo(() => flatten(run.spans, collapsed), [run.spans, collapsed])
  const total = run.durationMs || Math.max(...run.spans.map(s => s.startMs + s.durationMs), 1)

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className={clsx('flex flex-col gap-3 min-h-0', className)}>
      <Summary run={run} />

      <div className="flex flex-col min-h-0 border border-border rounded-lg overflow-hidden bg-surface">
        {/* Track header */}
        <div className="flex items-center text-xxs uppercase tracking-wider text-text-muted bg-card border-b border-border shrink-0">
          <span className="w-[44%] min-w-[200px] px-3 py-1.5">Span · {run.spanCount} total</span>
          <span className="flex-1 px-3 py-1.5">Timeline · {fmtDur(total)}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {rows.map(row => (
            <SpanRow
              key={row.span.id}
              row={row}
              total={total}
              open={openDetail.has(row.span.id)}
              collapsed={collapsed.has(row.span.id)}
              onToggleDetail={() => toggle(setOpenDetail, row.span.id)}
              onToggleCollapse={() => toggle(setCollapsed, row.span.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
