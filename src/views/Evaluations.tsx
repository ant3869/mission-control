// title: Evaluations Cockpit — single-page view (no tabs)
// path: src/views/Evaluations.tsx
// purpose: One scrolling cockpit that walks the user through the seven
//          questions in order — who's winning, why, what evidence, where
//          each model fails, whether the score is real, what's missing,
//          what to run next. A sticky anchor nav lets you jump between
//          sections without splitting them across tabs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  Target, RefreshCw, AlertCircle, Beaker, BookOpen, Layers, Trophy, Brain, GitCompare, Award,
} from 'lucide-react'
import {
  evaluations, memoryEvaluations,
  type EvalPlatform, type PlatformEvalOverview, type ModelScorecard, type EvaluationRun,
  type BenchmarkTask, type BenchmarkRun, type MemoryScorecard, type MemoryOverview, type MemoryBenchmarkRun,
} from '../lib/api'
import {
  ModelLeaderboard, PlatformFactorBar, MiniSummaryStat,
} from '../components/evaluations/Scorecards'
import { AgentModelMatrix } from '../components/evaluations/Matrix'
import { ScoreTrendChart } from '../components/evaluations/TrendChart'
import { RunList } from '../components/evaluations/Drilldown'
import { BenchmarkComparison } from '../components/evaluations/BenchmarkComparison'
import { ModelReport } from '../components/evaluations/ModelReport'
import { TaskQueues } from '../components/evaluations/TaskQueues'
import { InlineMethodology } from '../components/evaluations/InlineMethodology'
import { synthesizeMemoryArea } from '../components/evaluations/synthesis'
import { NewBenchmarkTaskForm } from '../components/evaluations/BenchmarksPanel'
import { NewMemoryTaskForm } from '../components/evaluations/MemoryPanel'
import {
  EmptyState, NotConnected, ErrorBanner, PlatformBadge, fmtPct, fmtTimeAgo, HeuristicTag, scoreBg, scoreColor,
} from '../components/evaluations/shared'

type Scope = 'both' | 'openclaw' | 'hermes'
type SectionId = 'overview' | 'compare' | 'tasks' | 'memory' | 'methodology'

// ─── Loader ──────────────────────────────────────────────────────────────────

interface CockpitData {
  overviews:   Record<EvalPlatform, PlatformEvalOverview | null>
  tasks:       BenchmarkTask[]
  runs:        BenchmarkRun[]
  memory:      Record<EvalPlatform, MemoryOverview | null>
  memoryRuns:  MemoryBenchmarkRun[]
  fetchedAt:   string
}

const EMPTY: CockpitData = {
  overviews: { openclaw: null, hermes: null },
  tasks: [], runs: [],
  memory: { openclaw: null, hermes: null },
  memoryRuns: [],
  fetchedAt: '',
}

async function loadCockpit(): Promise<{ data: CockpitData; errors: string[] }> {
  const errors: string[] = []
  const [oc, hr] = await Promise.all([
    evaluations.overview('openclaw').catch(e => { errors.push(`openclaw overview: ${e?.message ?? e}`); return null }),
    evaluations.overview('hermes').catch(e   => { errors.push(`hermes overview: ${e?.message ?? e}`);   return null }),
  ])
  const [ocBench, hrBench] = await Promise.all([
    evaluations.benchmarks('openclaw').catch(() => ({ tasks: [], runs: [] } as any)),
    evaluations.benchmarks('hermes').catch(()   => ({ tasks: [], runs: [] } as any)),
  ])
  const [ocMem, hrMem] = await Promise.all([
    memoryEvaluations.overview('openclaw').catch(() => null),
    memoryEvaluations.overview('hermes').catch(()   => null),
  ])
  const data: CockpitData = {
    overviews:  { openclaw: oc, hermes: hr },
    tasks:      [...(ocBench.tasks ?? []), ...(hrBench.tasks ?? [])],
    runs:       [...(ocBench.runs  ?? []), ...(hrBench.runs  ?? [])],
    memory:     { openclaw: ocMem, hermes: hrMem },
    memoryRuns: [...((ocMem?.recentRuns) ?? []), ...((hrMem?.recentRuns) ?? [])],
    fetchedAt:  new Date().toISOString(),
  }
  return { data, errors }
}

// ─── Cockpit ─────────────────────────────────────────────────────────────────

export function Evaluations() {
  const [scope, setScope] = useState<Scope>('both')
  const [data, setData]   = useState<CockpitData>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors]   = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [showNewBench, setShowNewBench]   = useState(false)
  const [showNewMemory, setShowNewMemory] = useState(false)
  const [drillFilter, setDrillFilter] = useState<'failures' | 'loops' | 'wasteful' | 'recent'>('failures')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, errors } = await loadCockpit()
    setData(data); setErrors(errors)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // ─── Scope filtering — every downstream view consumes these slices ─────────
  const platforms: EvalPlatform[] = scope === 'both' ? ['openclaw', 'hermes'] : [scope]

  const leaderboard = useMemo(() => {
    const cards: ModelScorecard[] = []
    for (const p of platforms) {
      const ov = data.overviews[p]
      if (ov?.reachable) cards.push(...ov.leaderboard)
    }
    // When scope=both, multiple platforms can each have their own scorecard
    // for the same model. Collapse by model key, picking the higher overall
    // so the leaderboard line still ranks meaningfully.
    const byModel = new Map<string, ModelScorecard>()
    for (const c of cards) {
      const existing = byModel.get(c.model)
      if (!existing || c.overall > existing.overall) byModel.set(c.model, c)
    }
    return [...byModel.values()].sort((a, b) => b.overall - a.overall)
  }, [data, platforms])

  const scopedTasks = useMemo(() =>
    data.tasks.filter(t => platforms.includes(t.platform)), [data.tasks, platforms])
  const scopedRuns  = useMemo(() =>
    data.runs.filter(r => platforms.includes(r.platform)), [data.runs, platforms])

  const scopedMemoryRuns = useMemo(() =>
    data.memoryRuns.filter(r => platforms.includes(r.platform)), [data.memoryRuns, platforms])

  // Memory scorecards keyed by model name — collapsed across platforms.
  const memoryByModel = useMemo(() => {
    const m = new Map<string, MemoryScorecard>()
    for (const p of platforms) {
      for (const c of data.memory[p]?.modelLeaderboard ?? []) {
        if (!c.scope) continue
        const existing = m.get(c.scope)
        if (!existing || c.composite > existing.composite) m.set(c.scope, c)
      }
    }
    return m
  }, [data, platforms])

  // Initial / scope-change selection: lock onto the leader of the current scope.
  useEffect(() => {
    if (leaderboard.length === 0) { setSelectedModel(null); return }
    setSelectedModel(prev => prev && leaderboard.find(c => c.model === prev) ? prev : leaderboard[0].model)
  }, [leaderboard])

  const selectedCard = useMemo<ModelScorecard | null>(() =>
    leaderboard.find(c => c.model === selectedModel) ?? null, [leaderboard, selectedModel])

  // Aggregate summary across the active scope.
  const aggregate = useMemo(() => {
    let runs = 0, evaluated = 0, success = 0, failure = 0, waste = 0, recovery = 0
    let succWeight = 0, failWeight = 0, wasteWeight = 0, recoveryWeight = 0
    for (const p of platforms) {
      const o = data.overviews[p]
      if (!o?.reachable) continue
      const s = o.summary
      runs += s.runCount; evaluated += s.evaluatedCount
      if (s.successRate  != null) { success += s.successRate * s.evaluatedCount; succWeight += s.evaluatedCount }
      if (s.failureRate  != null) { failure += s.failureRate * s.evaluatedCount; failWeight += s.evaluatedCount }
      if (s.wasteRate    != null) { waste   += s.wasteRate   * s.evaluatedCount; wasteWeight += s.evaluatedCount }
      if (s.recoveryRate != null) { recovery+= s.recoveryRate* s.evaluatedCount; recoveryWeight += s.evaluatedCount }
    }
    return {
      runs, evaluated,
      successRate:  succWeight     ? success  / succWeight  : null,
      failureRate:  failWeight     ? failure  / failWeight  : null,
      wasteRate:    wasteWeight    ? waste    / wasteWeight : null,
      recoveryRate: recoveryWeight ? recovery / recoveryWeight : null,
    }
  }, [data, platforms])

  const reachableCount = platforms.filter(p => data.overviews[p]?.reachable).length

  // Combined drilldown runs (failures/loops/wasteful/recent) across scope.
  const drillRuns: EvaluationRun[] = useMemo(() => {
    const out: EvaluationRun[] = []
    for (const p of platforms) {
      const o = data.overviews[p]; if (!o?.reachable) continue
      switch (drillFilter) {
        case 'failures': out.push(...o.representativeFailures); break
        case 'loops':    out.push(...o.loopRuns); break
        case 'wasteful': out.push(...o.wastefulRuns); break
        case 'recent':   out.push(...o.recentRuns); break
      }
    }
    return out
  }, [data, platforms, drillFilter])

  // First reachable overview drives the trend chart (chart accepts one series).
  const trendOverview = platforms.map(p => data.overviews[p]).find(o => o?.reachable) ?? null

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      <StickyHeader scope={scope} setScope={setScope}
        loading={loading} onRefresh={load}
        reachableCount={reachableCount} platforms={platforms}
        fetchedAt={data.fetchedAt}
        onJump={id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-6 py-4 space-y-6">
          {errors.length > 0 && errors.map((e, i) => <ErrorBanner key={i} message={e} />)}

          {/* ─── Section 1 · Overview ─────────────────────────────────────── */}
          <Section id="overview" icon={<Trophy size={14} className="text-amber-400" />} title="Who's winning"
            hint="Aggregated across the selected scope. Click any model row to drive the report below.">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <MiniSummaryStat label="Leading" value={leaderboard[0]?.modelLabel ?? '—'}
                sub={leaderboard[0] ? `overall ${leaderboard[0].overall}` : 'no scored model yet'} />
              <MiniSummaryStat label="Runs" value={aggregate.runs.toString()} sub={`${aggregate.evaluated} evaluable`} />
              <MiniSummaryStat label="Models" value={leaderboard.length.toString()} sub={`${platforms.join(' + ')}`} />
              <MiniSummaryStat label="Success" value={fmtPct(aggregate.successRate)} sub={`fail ${fmtPct(aggregate.failureRate)}`} />
              <MiniSummaryStat label="Tool waste" value={fmtPct(aggregate.wasteRate)} sub="repeats + osc + errors" />
              <MiniSummaryStat label="Recovery" value={fmtPct(aggregate.recoveryRate)} sub="after errors" />
            </div>

            {reachableCount === 0 ? (
              <div className="space-y-3">
                {platforms.map(p => <NotConnected key={p} platform={p} />)}
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="bg-bg-secondary border border-white/10 rounded-xl">
                <EmptyState icon={<Trophy size={28} />} title="No evaluable runs in the captured window"
                  hint="Once the connected agent runs sessions with an attributable model, they will appear here." />
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2">
                  <ModelLeaderboard scorecards={leaderboard} selectedModel={selectedModel} onSelect={setSelectedModel} />
                </div>
                <div className="space-y-4">
                  {selectedCard && (
                    <ModelReport
                      scorecard={selectedCard}
                      leaderboard={leaderboard}
                      tasks={scopedTasks}
                      runs={scopedRuns}
                      memory={memoryByModel.get(selectedCard.model) ?? null}
                      memoryRuns={scopedMemoryRuns}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Factor breakdown + trend stay below — they answer "why" without
                claiming to be standalone surfaces. */}
            {trendOverview && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <PlatformFactorBar factors={trendOverview.factorBreakdown} />
                <ScoreTrendChart trend={trendOverview.trend}
                  title={selectedCard ? `Score trend · ${selectedCard.modelLabel}` : 'Activity trend'} />
              </div>
            )}

            {/* Agent × model matrix is unique evidence — keep close to overview. */}
            {trendOverview && (
              <AgentModelMatrix
                agents={trendOverview.agentModelMatrix.agents}
                models={trendOverview.agentModelMatrix.models}
                cells={trendOverview.agentModelMatrix.cells}
                onSelectCell={cell => setSelectedModel(cell.model)} />
            )}

            {/* Run drilldowns — failures and loops feed "where did each model fail". */}
            <div className="bg-bg-secondary border border-white/10 rounded-xl">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
                <Layers size={13} className="text-violet-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Where it fell over</h3>
                <div className="ml-auto flex items-center gap-1">
                  {(['failures', 'loops', 'wasteful', 'recent'] as const).map(k => (
                    <button key={k} onClick={() => setDrillFilter(k)}
                      className={clsx('px-2 py-0.5 text-[11px] rounded transition-colors capitalize',
                        drillFilter === k ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'text-text-muted hover:text-text-primary')}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-3">
                <RunList kind={drillFilter} runs={drillRuns} />
              </div>
            </div>
          </Section>

          {/* ─── Section 2 · Compare ─────────────────────────────────────── */}
          <Section id="compare" icon={<GitCompare size={14} className="text-violet-400" />} title="Compare per task"
            hint="One row per benchmark task, one column per model. Cells show score · outcome · run count · timing. Click a column header to re-target the model report above.">
            <BenchmarkComparison tasks={scopedTasks} runs={scopedRuns} onSelectModel={setSelectedModel} />
          </Section>

          {/* ─── Section 3 · Tasks (work queues) ─────────────────────────── */}
          <Section id="tasks" icon={<Beaker size={14} className="text-violet-400" />} title="What to run next"
            hint="Every task lands in exactly one bucket — read the queue, dispatch from it. No parallel catalogs."
            action={
              <button onClick={() => setShowNewBench(v => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/30 rounded">
                + New benchmark task
              </button>
            }>
            {showNewBench && (
              <NewBenchmarkTaskForm platform={platforms[0]} onClose={() => setShowNewBench(false)} onCreated={() => { setShowNewBench(false); load() }} />
            )}
            <TaskQueues tasks={scopedTasks} runs={scopedRuns} onChanged={load} />
          </Section>

          {/* ─── Section 4 · Memory ─────────────────────────────────────── */}
          <Section id="memory" icon={<Brain size={14} className="text-cyan-400" />} title="Memory at a glance"
            hint="Per-model retrieval, false-recall, and provider attribution. Detailed per-run findings live inside the Model Report above."
            action={
              <button onClick={() => setShowNewMemory(v => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/30 rounded">
                + New memory task
              </button>
            }>
            <MemoryArea data={data} platforms={platforms} onSelectModel={setSelectedModel} />
            {showNewMemory && (
              <NewMemoryTaskForm platform={platforms[0]}
                providers={data.memory[platforms[0]]?.providers ?? []}
                onClose={() => setShowNewMemory(false)} onCreated={() => { setShowNewMemory(false); load() }} />
            )}
          </Section>

          {/* ─── Section 5 · Methodology ─────────────────────────────────── */}
          <Section id="methodology" icon={<BookOpen size={14} className="text-violet-400" />} title="Methodology"
            hint="Annotates every label you see above. Definitions are loaded live from the server.">
            <InlineMethodology />
          </Section>
        </div>
      </div>
    </div>
  )
}

// ─── Sticky header with anchor nav + scope toggle ────────────────────────────

function StickyHeader({
  scope, setScope, loading, onRefresh, reachableCount, platforms, fetchedAt, onJump,
}: {
  scope: Scope; setScope: (s: Scope) => void
  loading: boolean; onRefresh: () => void
  reachableCount: number; platforms: EvalPlatform[]; fetchedAt: string
  onJump: (id: SectionId) => void
}) {
  const navRef = useRef<HTMLDivElement | null>(null)
  return (
    <div ref={navRef} className="flex flex-col gap-2 px-6 py-3 border-b border-white/10 flex-shrink-0 bg-bg-primary">
      <div className="flex items-center gap-3 flex-wrap">
        <Target size={20} className="text-violet-400" />
        <h1 className="text-lg font-semibold text-text-primary">Evaluations</h1>
        <span className="text-xs text-text-muted bg-white/5 px-2 py-0.5 rounded-full">Cockpit — Hermes + OpenClaw only</span>
        <HeuristicTag tip="Every number is derived from real session transcripts, persisted benchmark runs, or memory benchmark runs. Heuristic where labeled — no fabricated data." />
        <span className="text-[11px] text-text-muted">
          {fetchedAt && `updated ${new Date(fetchedAt).toLocaleTimeString()}`}
          {reachableCount > 0 && ` · ${reachableCount}/${platforms.length} reachable`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ScopePicker value={scope} onChange={setScope} />
          <button onClick={onRefresh} disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded">
            <RefreshCw size={11} className={clsx(loading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <AnchorBtn icon={<Award size={11} />}      onClick={() => onJump('overview')}>Overview</AnchorBtn>
        <AnchorBtn icon={<GitCompare size={11} />} onClick={() => onJump('compare')}>Compare</AnchorBtn>
        <AnchorBtn icon={<Beaker size={11} />}     onClick={() => onJump('tasks')}>Tasks</AnchorBtn>
        <AnchorBtn icon={<Brain size={11} />}      onClick={() => onJump('memory')}>Memory</AnchorBtn>
        <AnchorBtn icon={<BookOpen size={11} />}   onClick={() => onJump('methodology')}>Methodology</AnchorBtn>
      </div>
    </div>
  )
}

function AnchorBtn({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1 text-[11px] rounded text-text-muted hover:text-text-primary hover:bg-white/5 border border-transparent">
      {icon}{children}
    </button>
  )
}

function ScopePicker({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  const opts: Array<{ key: Scope; label: string }> = [
    { key: 'both',     label: 'Both' },
    { key: 'openclaw', label: 'OpenClaw' },
    { key: 'hermes',   label: 'Hermes' },
  ]
  return (
    <div className="flex items-center gap-1 p-0.5 bg-white/5 border border-white/10 rounded">
      {opts.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)}
          className={clsx('px-2.5 py-0.5 text-[11px] rounded transition-colors',
            value === o.key ? 'bg-violet-500/25 text-violet-100' : 'text-text-muted hover:text-text-primary')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─── Section wrapper (anchor + title + hint + optional action) ───────────────

function Section({ id, icon, title, hint, action, children }: {
  id: SectionId; icon: React.ReactNode; title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section id={id} className="space-y-3 scroll-mt-32">
      <div className="flex items-start gap-3 flex-wrap">
        {icon}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          {hint && <p className="text-[11px] text-text-muted leading-snug">{hint}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </section>
  )
}

// ─── Memory area ────────────────────────────────────────────────────────────

function MemoryArea({ data, platforms, onSelectModel }: { data: CockpitData; platforms: EvalPlatform[]; onSelectModel: (m: string) => void }) {
  const cards = useMemo(() => {
    const m = new Map<string, MemoryScorecard>()
    let totalRuns = 0
    let bestProvider: { scope: string; composite: number } | null = null
    for (const p of platforms) {
      const o = data.memory[p]; if (!o) continue
      totalRuns += o.summary.runCount
      for (const c of o.modelLeaderboard) {
        const existing = m.get(c.scope)
        if (!existing || c.composite > existing.composite) m.set(c.scope, c)
      }
      if (o.summary.bestProvider && (!bestProvider || o.summary.bestProvider.composite > bestProvider.composite)) {
        bestProvider = o.summary.bestProvider
      }
    }
    return { cards: [...m.values()], totalRuns, bestProvider }
  }, [data, platforms])

  const verdict = useMemo(() => synthesizeMemoryArea({
    cards: cards.cards, totalRuns: cards.totalRuns, bestProvider: cards.bestProvider,
  }), [cards])

  const anyReachable = platforms.some(p => data.memory[p]?.reachable)
  if (!anyReachable) {
    return <div className="bg-bg-secondary border border-white/10 rounded-xl p-4 text-xs text-text-muted">No reachable memory backend in scope.</div>
  }

  return (
    <div className="space-y-3">
      {/* Headline verdict — answers "who wins on memory and why" in one line. */}
      <div className="bg-cyan-500/[0.06] border border-cyan-500/20 rounded-xl px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <Brain size={13} className="text-cyan-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Memory verdict</h3>
          <span className="ml-auto text-[10px] text-text-muted">{verdict.modelCount} model{verdict.modelCount === 1 ? '' : 's'} · {verdict.totalRuns} run{verdict.totalRuns === 1 ? '' : 's'}</span>
        </div>
        <p className="text-xs text-text-secondary leading-snug">{verdict.headline}</p>
        {verdict.nextSuggestions.length > 0 && (
          <div className="text-[11px] text-text-muted">
            <span className="uppercase tracking-wider text-[10px]">Suggested next steps:</span>
            <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
              {verdict.nextSuggestions.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Compact leaderboard — click jumps the report. */}
      <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
          <h4 className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Memory by model</h4>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-white/[0.02] text-text-muted">
            <tr className="text-left">
              <th className="px-3 py-1.5 font-medium">Model</th>
              <th className="px-2 py-1.5 font-medium text-right">Comp</th>
              <th className="px-2 py-1.5 font-medium text-right">Retr</th>
              <th className="px-2 py-1.5 font-medium text-right">Use</th>
              <th className="px-2 py-1.5 font-medium text-right">Fresh</th>
              <th className="px-2 py-1.5 font-medium text-right">False</th>
              <th className="px-2 py-1.5 font-medium text-right">Runs</th>
            </tr>
          </thead>
          <tbody>
            {cards.cards.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-4 text-text-muted text-center italic">No memory runs attributed to a model yet.</td></tr>
            ) : cards.cards.sort((a, b) => b.composite - a.composite).map(c => {
              const muted = c.scope === 'unknown' || !c.scope.trim()
              return (
                <tr key={c.scope} className={clsx('border-t border-white/5', !muted && 'cursor-pointer hover:bg-white/[0.04]')}
                  onClick={() => !muted && onSelectModel(c.scope)}>
                  <td className="px-3 py-1.5">
                    <span className={clsx(muted ? 'text-text-muted italic' : 'text-text-primary')}>{muted ? '(no model)' : c.label}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={clsx('inline-flex items-center justify-center min-w-[36px] px-1.5 py-0.5 rounded font-semibold tabular-nums', scoreBg(c.composite), scoreColor(c.composite))}>
                      {c.composite}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.subScores.retrievalAccuracy == null ? '—' : `${Math.round(c.subScores.retrievalAccuracy as number)}%`}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.subScores.usageAccuracy == null ? '—' : `${Math.round(c.subScores.usageAccuracy as number)}%`}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.subScores.freshnessScore == null ? '—' : `${Math.round(c.subScores.freshnessScore as number)}%`}</td>
                  <td className={clsx('px-2 py-1.5 text-right tabular-nums', c.falseRecallPenalty > 15 && 'text-red-300')}>{c.falseRecallPenalty.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">{c.runCount}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Provider mix + recent runs feed the "what evidence / where it failed" lens. */}
      <RecentMemoryRuns runs={data.memoryRuns.filter(r => platforms.includes(r.platform))} />
    </div>
  )
}

function RecentMemoryRuns({ runs }: { runs: MemoryBenchmarkRun[] }) {
  if (runs.length === 0) return null
  const recent = [...runs].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 6)
  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
        <h4 className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Recent memory runs</h4>
        <span className="ml-auto text-[10px] text-text-muted">{runs.length} total · showing {recent.length}</span>
      </div>
      <div className="divide-y divide-white/5">
        {recent.map(r => (
          <div key={r.id} className="px-4 py-2 flex items-center gap-2 text-[11px]">
            <span className={clsx('w-2 h-2 rounded-full flex-shrink-0',
              r.status === 'success' ? 'bg-emerald-400' : r.status === 'failure' ? 'bg-red-400' : 'bg-amber-400')} />
            <span className="text-text-primary truncate flex-1 min-w-0">{r.model || '(no model)'}</span>
            <PlatformBadge platform={r.platform} />
            {r.denialDetected && <span className="text-[9px] uppercase px-1 py-px rounded bg-emerald-500/15 text-emerald-300">refused ✓</span>}
            <span className="text-text-muted tabular-nums w-12 text-right">{r.composite}</span>
            <span className={clsx('tabular-nums w-12 text-right', r.falseRecallPenalty > 15 ? 'text-red-300' : 'text-text-muted')}>
              {r.falseRecallPenalty.toFixed(0)}
            </span>
            <span className="text-text-muted w-16 text-right">{fmtTimeAgo(r.ts)}</span>
            {r.scoringNote && <AlertCircle size={11} className="text-text-muted" />}
          </div>
        ))}
      </div>
    </div>
  )
}

// Convenience export so other surfaces that imported the old shape keep
// compiling (no-op for users — Cockpit is the only entry point).
export default Evaluations
