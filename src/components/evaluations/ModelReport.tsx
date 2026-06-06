// title: Unified Model Report — narrative card combining all signals
// path: src/components/evaluations/ModelReport.tsx
// purpose: Replace the disconnected "score breakdown" panel with a single card
//          that answers what this model is good at, what it's bad at, why it
//          ranks where it ranks, what evidence supports that, and what to
//          test next. Pulls from heuristics + benchmark + memory in one
//          place so a user does not have to cross-reference three panels.

import { clsx } from 'clsx'
import {
  Award, TrendingDown, TrendingUp, Beaker, Brain, AlertCircle, BookOpen, Sparkles, Target,
} from 'lucide-react'
import type {
  ModelScorecard, BenchmarkRun, BenchmarkTask, MemoryScorecard, MemoryBenchmarkRun,
} from '../../lib/api'
import { synthesizeModel, type Finding, type Source } from './synthesis'
import { scoreBg, scoreColor, HeuristicTag, fmtPct } from './shared'

interface Props {
  scorecard:    ModelScorecard
  leaderboard:  ModelScorecard[]
  tasks:        BenchmarkTask[]
  runs:         BenchmarkRun[]
  /** Memory scorecard matched on model name, if any. */
  memory?:      MemoryScorecard | null
  /** Raw memory runs for the selected model (so the report can list provider
   *  attribution and notable hits without forcing the user to switch tabs). */
  memoryRuns?:  MemoryBenchmarkRun[]
}

export function ModelReport({ scorecard, leaderboard, tasks, runs, memory, memoryRuns }: Props) {
  const s = synthesizeModel({ scorecard, leaderboard, tasks, runs, memory: memory ?? null })
  const myMemoryRuns = (memoryRuns ?? []).filter(r => r.model === scorecard.model)

  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      {/* Header — model identity + verdict + rank + headline scores. */}
      <div className="px-4 py-3 border-b border-white/10 flex items-start gap-3 flex-wrap">
        <Award size={14} className={clsx('mt-0.5', s.rank === 1 ? 'text-amber-400' : 'text-text-muted')} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-text-primary truncate">{s.modelLabel}</h3>
            <span className="text-[10px] font-mono text-text-muted truncate">{s.model}</span>
            {s.rank != null && s.totalModels > 1 && (
              <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide',
                s.rank === 1 ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30' : 'bg-white/5 text-text-muted')}>
                {s.rank === 1 ? 'Leading' : `#${s.rank} of ${s.totalModels}`}
              </span>
            )}
            <HeuristicTag tip="One-card verdict synthesized from session sub-scores, latest-per-task benchmark grades, and the matching memory composite — no fabricated data." />
          </div>
          <p className="text-xs text-text-primary mt-1 leading-snug">{s.verdict}</p>
        </div>
        <div className="flex items-center gap-2">
          <HeadlineScore label="Overall" value={s.overall} tip="Composite of sub-scores. Weight is in the Methodology tab." />
          <HeadlineScore label="Bench"   value={s.benchmarkAvg}   muted={!s.hasRealBenchmarkData}
            tip={s.benchmarkAvg == null ? 'No graded benchmark runs yet — dispatch a built-in to populate.' : `Average of latest-per-task rubric scores · ${s.benchmarkCoverage.ran}/${s.benchmarkCoverage.total} tasks`} />
          <HeadlineScore label="Memory"  value={s.memoryComposite}
            tip={s.memoryComposite == null ? 'No memory benchmark runs for this model yet.' : `Memory composite · ${s.sampleSize.memoryRuns} run${s.sampleSize.memoryRuns === 1 ? '' : 's'}`} />
        </div>
      </div>

      {/* Sample-size strip. Only flags low confidence + missing benchmark
          coverage; we don't bother shouting when the sample is solid. */}
      <div className={clsx('px-4 py-2 border-b border-white/5 flex items-center gap-3 flex-wrap text-[10px]',
        s.confidence < 50 ? 'bg-amber-500/[0.06] text-amber-200' : 'bg-white/[0.02] text-text-muted')}>
        <span><span className="uppercase tracking-wider">Confidence</span> {s.confidenceNote}</span>
        <span className="opacity-50">·</span>
        <span>{s.sampleSize.evaluatedRuns} session{s.sampleSize.evaluatedRuns === 1 ? '' : 's'}</span>
        <span>· {s.sampleSize.benchmarkRuns} graded bench{s.sampleSize.benchmarkRuns === 1 ? '' : 'es'}</span>
        <span>· {s.sampleSize.memoryRuns} memory run{s.sampleSize.memoryRuns === 1 ? '' : 's'}</span>
        {!s.hasRealBenchmarkData && (
          <span className="ml-auto text-amber-300 inline-flex items-center gap-1">
            <AlertCircle size={10} /> overall is heuristic — no graded benchmarks
          </span>
        )}
      </div>

      {/* Strengths / weaknesses side by side. */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-white/5">
        <FindingsColumn
          title="Strengths"
          icon={<TrendingUp size={12} className="text-emerald-400" />}
          empty={s.hasRealBenchmarkData
            ? 'Nothing scored above 75 yet — no clear strengths.'
            : 'No graded data yet. Dispatch a built-in benchmark to surface strengths.'}
          findings={s.strengths}
        />
        <FindingsColumn
          title="Weaknesses"
          icon={<TrendingDown size={12} className="text-red-400" />}
          empty="Nothing dropped below 50 — no obvious weaknesses."
          findings={s.weaknesses}
        />
      </div>

      {/* Evidence — the data behind the verdict, plus best/worst anchors. */}
      <div className="px-4 py-3 border-t border-white/5 space-y-2">
        <div className="flex items-center gap-2">
          <Target size={12} className="text-violet-400" />
          <h4 className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Supporting evidence</h4>
        </div>
        <ul className="text-xs text-text-secondary list-disc pl-5 space-y-1 leading-snug">
          {s.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        {(s.bestBenchmark || s.worstBenchmark) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
            {s.bestBenchmark && (
              <AnchorRow icon={<Sparkles size={11} className="text-emerald-400" />} label="Best task"
                title={s.bestBenchmark.taskTitle} score={s.bestBenchmark.score} />
            )}
            {s.worstBenchmark && (
              <AnchorRow icon={<AlertCircle size={11} className="text-red-400" />} label="Worst task"
                title={s.worstBenchmark.taskTitle} score={s.worstBenchmark.score} />
            )}
          </div>
        )}
      </div>

      {/* What to test next — actionable list derived from coverage gaps. */}
      <div className="px-4 py-3 border-t border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-2 mb-2">
          <Beaker size={12} className="text-violet-400" />
          <h4 className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Run next</h4>
          <span className="text-[10px] text-text-muted">
            {s.nextTests.length > 0
              ? `${s.nextTests.length} suggestion${s.nextTests.length === 1 ? '' : 's'}`
              : 'caught up'}
          </span>
        </div>
        {s.nextTests.length > 0 ? (
          <ul className="space-y-1">
            {s.nextTests.map(n => (
              <li key={n.taskId} className="flex items-start gap-2 text-[11px]">
                {n.builtIn
                  ? <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300 mt-0.5">auto</span>
                  : <span className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-text-muted mt-0.5">custom</span>}
                <span className="text-text-primary truncate flex-1 min-w-0" title={n.taskTitle}>{n.taskTitle}</span>
                <span className="text-text-muted truncate">{n.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-text-muted italic">
            {s.hasRealBenchmarkData
              ? 'Every task in the catalog has a graded run for this model. Add a custom task or wait for new built-ins.'
              : 'No benchmark catalog yet. Define a task on the Benchmarks tab to start grading.'}
          </p>
        )}
      </div>

      {/* Memory subsection — folds retrieval/false-recall/provider data into
          the same report card so memory isn't a separate page. Only renders
          when there's something to say. */}
      {(memory || myMemoryRuns.length > 0) && (
        <MemorySubsection memory={memory ?? null} runs={myMemoryRuns} />
      )}

      {/* Methodology pointer so users can jump to the meaning of the signals. */}
      <div className="px-4 py-2 border-t border-white/5 text-[10px] text-text-muted flex items-center gap-1.5">
        <BookOpen size={10} />
        Sub-score weights and outcome rules live in the <span className="text-violet-300">Methodology</span> section below.
        {memory && <> Memory weights are in the same section under <span className="text-violet-300">Memory Score</span>.</>}
      </div>
    </div>
  )
}

function HeadlineScore({ label, value, muted, tip }: { label: string; value: number | null; muted?: boolean; tip?: string }) {
  return (
    <div className="flex flex-col items-end gap-0.5 min-w-[60px]" title={tip}>
      <span className="text-[9px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className={clsx(
        'inline-flex items-center justify-center min-w-[44px] px-2 py-0.5 rounded font-semibold tabular-nums',
        value == null ? 'bg-white/5 text-text-muted' : scoreBg(value),
        value == null ? '' : scoreColor(value),
        muted && value != null && 'opacity-50',
      )}>
        {value == null ? '—' : Math.round(value)}
      </span>
    </div>
  )
}

function FindingsColumn({ title, icon, findings, empty }: { title: string; icon: React.ReactNode; findings: Finding[]; empty: string }) {
  return (
    <div className="p-4 min-h-[120px]">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h4 className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">{title}</h4>
        <span className="text-[10px] text-text-muted">{findings.length}</span>
      </div>
      {findings.length === 0 ? (
        <p className="text-[11px] text-text-muted italic leading-snug">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {findings.map(f => <FindingRow key={f.key + f.source} f={f} />)}
        </ul>
      )}
    </div>
  )
}

function FindingRow({ f }: { f: Finding }) {
  return (
    <li className="flex flex-col gap-1 px-2 py-1.5 bg-white/[0.02] rounded border border-white/5">
      <div className="flex items-center gap-2">
        <SourceChip source={f.source} />
        <span className="text-xs text-text-primary truncate flex-1 min-w-0">{f.label}</span>
        <span className={clsx('text-xs font-semibold tabular-nums', scoreColor(f.value))}>{Math.round(f.value)}</span>
      </div>
      <p className="text-[10px] text-text-muted leading-snug">{f.detail}</p>
    </li>
  )
}

function SourceChip({ source }: { source: Source }) {
  const map: Record<Source, { label: string; cls: string; icon: React.ReactNode }> = {
    subscore:  { label: 'session', cls: 'bg-white/5 text-text-muted',           icon: <TrendingUp size={9} /> },
    benchmark: { label: 'bench',   cls: 'bg-violet-500/15 text-violet-200',     icon: <Beaker size={9} /> },
    memory:    { label: 'memory',  cls: 'bg-cyan-500/15 text-cyan-200',         icon: <Brain size={9} /> },
  }
  const m = map[source]
  return (
    <span className={clsx('inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded', m.cls)}>
      {m.icon}{m.label}
    </span>
  )
}

function AnchorRow({ icon, label, title, score }: { icon: React.ReactNode; label: string; title: string; score: number }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-white/[0.02] rounded border border-white/5">
      {icon}
      <span className="text-[10px] uppercase tracking-wider text-text-muted w-20 flex-shrink-0">{label}</span>
      <span className="text-xs text-text-primary truncate flex-1 min-w-0" title={title}>{title}</span>
      <span className={clsx('text-xs font-semibold tabular-nums', scoreColor(score))}>{Math.round(score)}</span>
    </div>
  )
}

// ─── Memory subsection ───────────────────────────────────────────────────────

function MemorySubsection({ memory, runs }: { memory: MemoryScorecard | null; runs: MemoryBenchmarkRun[] }) {
  // Aggregate provider attribution across runs so the report can answer
  // "where did the score come from" without forcing a tab switch.
  const providerCount = new Map<string, number>()
  let denialCount = 0
  let forbiddenHits = 0
  for (const r of runs) {
    for (const p of r.providersUsed) providerCount.set(p, (providerCount.get(p) ?? 0) + 1)
    if (r.denialDetected) denialCount++
    forbiddenHits += r.forbiddenFound
  }
  const sortedProviders = [...providerCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  const topProvider = sortedProviders[0]?.[0] ?? null

  // Recent failing/refusing runs anchor the "where did each model fail" story.
  const worstRun = [...runs].sort((a, b) => (a.composite ?? 0) - (b.composite ?? 0))[0] ?? null

  return (
    <div className="px-4 py-3 border-t border-white/5 bg-cyan-500/[0.03]">
      <div className="flex items-center gap-2 mb-2">
        <Brain size={12} className="text-cyan-400" />
        <h4 className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Memory for this model</h4>
        {memory && <span className="text-[10px] text-text-muted">{memory.runCount} run{memory.runCount === 1 ? '' : 's'}</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
        <Metric label="Composite"   value={memory ? memory.composite.toString() : '—'} color={memory ? scoreColor(memory.composite) : ''} />
        <Metric label="Retrieval"   value={fmtPct(memory?.subScores?.retrievalAccuracy as number | null | undefined)} />
        <Metric label="False recall" value={memory ? memory.falseRecallPenalty.toFixed(0) : '—'}
          color={memory && memory.falseRecallPenalty > 15 ? 'text-red-300' : undefined}
          sub={memory && memory.falseRecallPenalty > 15 ? 'restating forbidden facts' : forbiddenHits > 0 ? `${forbiddenHits} forbidden hits` : 'clean'} />
        <Metric label="Refusals"    value={String(denialCount)} sub={denialCount > 0 ? 'correct denial detected' : 'no negative-control denials'} />
      </div>
      {sortedProviders.length > 0 && (
        <div className="text-[10px] text-text-muted">
          <span className="uppercase tracking-wider">Provider mix · </span>
          {sortedProviders.map(([p, n], i) => (
            <span key={p}>
              {i > 0 && ' · '}
              <span className="font-mono text-text-secondary">{p}</span> <span className="text-text-muted/70">×{n}</span>
            </span>
          ))}
          {topProvider && (
            <span className="ml-2 text-text-muted/70">· primary source: <span className="text-cyan-300">{topProvider}</span></span>
          )}
        </div>
      )}
      {worstRun && (
        <div className="mt-2 text-[10px] text-text-muted">
          <span className="uppercase tracking-wider">Weakest memory run · </span>
          composite {worstRun.composite}
          {worstRun.scoringNote && (
            <span className="italic text-text-muted/80"> — {worstRun.scoringNote.slice(0, 100)}{worstRun.scoringNote.length > 100 ? '…' : ''}</span>
          )}
        </div>
      )}
      {runs.length === 0 && memory && (
        <p className="text-[10px] text-text-muted italic">Per-run detail not yet loaded — composite reflects aggregated leaderboard data only.</p>
      )}
    </div>
  )
}

function Metric({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5 bg-white/[0.02] rounded border border-white/5">
      <span className="text-[9px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className={clsx('text-sm font-semibold tabular-nums', color ?? 'text-text-primary')}>{value}</span>
      {sub && <span className="text-[9px] text-text-muted truncate" title={sub}>{sub}</span>}
    </div>
  )
}
