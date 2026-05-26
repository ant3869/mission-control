// title: Evaluations view — Mission Control top-level surface
// path: src/views/Evaluations.tsx
// purpose: Scoped to Hermes + OpenClaw only. All data loads from real backend
//          APIs (/api/evaluations/*) which derive from real session history and
//          persisted benchmark / manual records. No mock data, no Claude Code
//          telemetry. Empty states are honest when data is unavailable.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  Target, RefreshCw, AlertCircle, Activity, TrendingUp, Beaker, BookOpen, Layers, Trophy, Brain,
} from 'lucide-react'
import {
  evaluations, ApiError,
  type EvalPlatform, type PlatformEvalOverview, type ModelScorecard, type EvaluationRun, type ModelSnapshot,
} from '../lib/api'
import {
  ModelLeaderboard, ScoreBreakdown, PlatformFactorBar, MiniSummaryStat,
} from '../components/evaluations/Scorecards'
import { AgentModelMatrix } from '../components/evaluations/Matrix'
import { ScoreTrendChart } from '../components/evaluations/TrendChart'
import { RunList } from '../components/evaluations/Drilldown'
import { BenchmarksPanel } from '../components/evaluations/BenchmarksPanel'
import { MemoryPanel } from '../components/evaluations/MemoryPanel'
import { MethodologyPanel } from '../components/evaluations/Methodology'
import {
  EmptyState, NotConnected, ErrorBanner, PlatformBadge, fmtPct, HeuristicTag,
} from '../components/evaluations/shared'

type Tab = 'hermes' | 'openclaw' | 'benchmarks' | 'memory' | 'methodology'

export function Evaluations() {
  const [tab, setTab] = useState<Tab>('openclaw')

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Target size={20} className="text-violet-400" />
          <h1 className="text-lg font-semibold text-text-primary">Evaluations</h1>
          <span className="text-xs text-text-muted bg-white/5 px-2 py-0.5 rounded-full">Hermes + OpenClaw only</span>
        </div>
        <div className="text-[11px] text-text-muted hidden md:block">
          Real session history · derived heuristics · persisted benchmarks
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 pt-3 flex-shrink-0">
        <TabBtn t="openclaw"    active={tab} setActive={setTab} icon={<Activity size={11} />}>OpenClaw</TabBtn>
        <TabBtn t="hermes"      active={tab} setActive={setTab} icon={<Activity size={11} />}>Hermes</TabBtn>
        <TabBtn t="benchmarks"  active={tab} setActive={setTab} icon={<Beaker size={11} />}>Benchmarks</TabBtn>
        <TabBtn t="memory"      active={tab} setActive={setTab} icon={<Brain size={11} />}>Memory</TabBtn>
        <TabBtn t="methodology" active={tab} setActive={setTab} icon={<BookOpen size={11} />}>Scoring Methodology</TabBtn>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-3 pb-6">
        {(tab === 'openclaw' || tab === 'hermes') && (
          <PlatformTab platform={tab} key={tab} />
        )}
        {tab === 'benchmarks' && (
          <div className="px-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
            <BenchmarksPanel platform="openclaw" reachable={true} />
            <BenchmarksPanel platform="hermes" reachable={true} />
          </div>
        )}
        {tab === 'memory' && (
          <div className="px-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
            <MemoryPanel platform="openclaw" />
            <MemoryPanel platform="hermes" />
          </div>
        )}
        {tab === 'methodology' && <div className="px-6">
          <MethodologyPanel />
        </div>}
      </div>
    </div>
  )
}

function TabBtn({ t, active, setActive, icon, children }: { t: Tab; active: Tab; setActive: (t: Tab) => void; icon: React.ReactNode; children: React.ReactNode }) {
  const on = active === t
  return (
    <button
      onClick={() => setActive(t)}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
        on ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'text-text-muted hover:text-text-primary hover:bg-white/5 border border-transparent',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

// ─── Per-platform tab ─────────────────────────────────────────────────────────

function PlatformTab({ platform }: { platform: EvalPlatform }) {
  const [overview, setOverview] = useState<PlatformEvalOverview | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [selectedSnapshots, setSelectedSnapshots] = useState<ModelSnapshot[] | null>(null)
  const [drillFilter, setDrillFilter] = useState<'failures' | 'loops' | 'wasteful' | 'recent'>('failures')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const ov = await evaluations.overview(platform)
      setOverview(ov)
      if (ov.leaderboard.length > 0) {
        const first = ov.leaderboard[0].model
        setSelectedModel(prev => prev && ov.leaderboard.find(c => c.model === prev) ? prev : first)
      } else {
        setSelectedModel(null)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load overview')
    } finally { setLoading(false) }
  }, [platform])
  useEffect(() => { load() }, [load])

  // Pull snapshot history for the selected model so the trend chart shows
  // real persisted score history when it exists.
  useEffect(() => {
    if (!selectedModel || !overview?.reachable) { setSelectedSnapshots(null); return }
    let cancelled = false
    evaluations.model(selectedModel, platform).then(r => {
      if (cancelled) return
      const platformResult = r.results.find(x => x.platform === platform)
      setSelectedSnapshots(platformResult?.snapshots ?? [])
    }).catch(() => setSelectedSnapshots([]))
    return () => { cancelled = true }
  }, [selectedModel, platform, overview?.fetchedAt, overview?.reachable])

  const selectedCard = useMemo<ModelScorecard | null>(() => {
    if (!overview || !selectedModel) return null
    return overview.leaderboard.find(c => c.model === selectedModel) ?? null
  }, [overview, selectedModel])

  const drilldownRuns: EvaluationRun[] = useMemo(() => {
    if (!overview) return []
    switch (drillFilter) {
      case 'failures': return overview.representativeFailures
      case 'loops':    return overview.loopRuns
      case 'wasteful': return overview.wastefulRuns
      case 'recent':   return overview.recentRuns
    }
  }, [overview, drillFilter])

  if (error) return <ErrorBanner message={error} />
  if (loading && !overview) return <div className="px-6 py-6 text-xs text-text-muted">Loading {platform} evaluations…</div>
  if (!overview) return null
  if (!overview.reachable) {
    return (
      <>
        <div className="px-6 flex items-center gap-3 mb-3">
          <PlatformBadge platform={platform} />
          <span className="text-[11px] text-text-muted">unreachable</span>
          <button onClick={load} disabled={loading} className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded">
            <RefreshCw size={11} className={clsx(loading && 'animate-spin')} /> Retry
          </button>
        </div>
        <NotConnected platform={platform} />
        {overview.error && (
          <div className="mx-6 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2 text-xs text-red-300">
            <AlertCircle size={14} /> <span>{overview.error}</span>
          </div>
        )}
      </>
    )
  }

  const s = overview.summary

  return (
    <div className="px-6 space-y-4">
      {/* Sub-header */}
      <div className="flex items-center gap-3 flex-wrap">
        <PlatformBadge platform={platform} />
        <span className="text-[11px] text-text-muted">
          {overview.fetchedAt && `updated ${new Date(overview.fetchedAt).toLocaleTimeString()}`}
        </span>
        <HeuristicTag tip="Outcomes, tool-quality and scores are inferred from real session transcripts. Conservative — unresolved runs are excluded from rates." />
        <button onClick={load} disabled={loading} className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded">
          <RefreshCw size={11} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MiniSummaryStat label="Runs" value={s.runCount.toString()} sub={`${s.evaluatedCount} evaluated`} />
        <MiniSummaryStat label="Models" value={s.modelCount.toString()} sub={`${s.agentCount} agent${s.agentCount === 1 ? '' : 's'}`} />
        <MiniSummaryStat label="Success rate" value={fmtPct(s.successRate)} sub={`fail ${fmtPct(s.failureRate)}`} />
        <MiniSummaryStat label="Tool waste" value={fmtPct(s.wasteRate)} sub="repeats + osc + errors" />
        <MiniSummaryStat label="Recovery" value={fmtPct(s.recoveryRate)} sub="after errors" />
        <MiniSummaryStat label="Top model" value={s.topModel ?? '—'} sub={s.topModelScore != null ? `score ${s.topModelScore}` : 'no scored model yet'} />
      </div>

      {/* Leaderboard + breakdown */}
      {overview.leaderboard.length === 0 ? (
        <div className="bg-bg-secondary border border-white/10 rounded-xl">
          <EmptyState
            icon={<Trophy size={28} />}
            title="No evaluable runs in the captured window"
            hint="Once the connected agent runs sessions with an attributable model, they will appear here. No fabricated runs are shown."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2">
            <ModelLeaderboard
              scorecards={overview.leaderboard}
              selectedModel={selectedModel}
              onSelect={setSelectedModel}
            />
          </div>
          <div className="space-y-4">
            {selectedCard && <ScoreBreakdown scorecard={selectedCard} />}
          </div>
        </div>
      )}

      {/* Factor breakdown + trend */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <PlatformFactorBar factors={overview.factorBreakdown} />
        <ScoreTrendChart
          trend={overview.trend}
          snapshots={selectedSnapshots ?? undefined}
          title={selectedCard ? `Score trend · ${selectedCard.modelLabel}` : 'Activity trend'}
        />
      </div>

      {/* Agent × model matrix */}
      <AgentModelMatrix
        agents={overview.agentModelMatrix.agents}
        models={overview.agentModelMatrix.models}
        cells={overview.agentModelMatrix.cells}
        onSelectCell={cell => setSelectedModel(cell.model)}
      />

      {/* Drilldowns */}
      <div className="bg-bg-secondary border border-white/10 rounded-xl">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
          <Layers size={13} className="text-violet-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Run drilldowns</h3>
          <div className="ml-auto flex items-center gap-1">
            {(['failures', 'loops', 'wasteful', 'recent'] as const).map(k => (
              <button
                key={k}
                onClick={() => setDrillFilter(k)}
                className={clsx(
                  'px-2 py-0.5 text-[11px] rounded transition-colors capitalize',
                  drillFilter === k ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'text-text-muted hover:text-text-primary',
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <div className="p-3">
          <RunList kind={drillFilter} runs={drilldownRuns} />
        </div>
      </div>

      {/* Heads-up trend chart link to benchmarks (informational only) */}
      <div className="text-[11px] text-text-muted px-1 pt-1 pb-2 flex items-center gap-1.5">
        <TrendingUp size={11} />
        Scores compound over time via daily snapshots — keep the dashboard open or refresh occasionally so the score trend fills in.
      </div>
    </div>
  )
}
