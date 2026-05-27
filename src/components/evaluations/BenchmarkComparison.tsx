// title: Cross-model benchmark comparison table
// path: src/components/evaluations/BenchmarkComparison.tsx
// purpose: Show one row per benchmark task and one column per model, with each
//          cell holding the latest auto-graded rubric score that model produced
//          for that task. This is the natural model-vs-model surface — the
//          per-model leaderboard mixes historical-session heuristics with
//          benchmark scores, so a side-by-side per-task view is what tells you
//          which model actually answers each test correctly.
//
//          Models are columns; tasks are rows. Cells aggregate via "latest
//          completed run per (model, task)" to avoid one stale low score
//          dragging a model's column down forever. Hover shows runCount and
//          the most recent attempt time.

import { useMemo } from 'react'
import { clsx } from 'clsx'
import { GitCompare } from 'lucide-react'
import type { BenchmarkTask, BenchmarkRun } from '../../lib/api'
import { fmtTimeAgo, scoreBg, scoreColor, HeuristicTag } from './shared'

interface Cell {
  model:        string
  taskId:       string
  latest:       BenchmarkRun | null
  runCount:     number
  rubricScored: number     // how many runs had a non-null rubricScore
  bestScore:    number | null
  worstScore:   number | null
}

interface Props {
  tasks: BenchmarkTask[]
  runs:  BenchmarkRun[]
}

const SCORED_STATUSES = new Set(['success', 'failure', 'unresolved'])

export function BenchmarkComparison({ tasks, runs }: Props) {
  const { models, cellMap, columnSummary } = useMemo(() => {
    // Collect models that have at least one completed (non-running) run.
    const modelSet = new Set<string>()
    for (const r of runs) {
      if (!r.model || r.model === 'unknown') continue
      if (!SCORED_STATUSES.has(r.status)) continue
      modelSet.add(r.model)
    }
    const models = [...modelSet].sort()

    // Bucket runs by (taskId, model), keep the latest per bucket.
    const buckets = new Map<string, BenchmarkRun[]>()
    for (const r of runs) {
      if (!r.model || r.model === 'unknown') continue
      if (!SCORED_STATUSES.has(r.status)) continue
      const k = `${r.taskId}::${r.model}`
      const arr = buckets.get(k) ?? []
      arr.push(r); buckets.set(k, arr)
    }

    const cellMap = new Map<string, Cell>()
    for (const [k, arr] of buckets) {
      arr.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      const [taskId, model] = k.split('::')
      const scored = arr.filter(r => r.rubricScore != null)
      cellMap.set(k, {
        model, taskId,
        latest: arr[0] ?? null,
        runCount: arr.length,
        rubricScored: scored.length,
        bestScore:  scored.length ? Math.max(...scored.map(r => r.rubricScore as number)) : null,
        worstScore: scored.length ? Math.min(...scored.map(r => r.rubricScore as number)) : null,
      })
    }

    // Column-level summary: average of the latest auto-graded score per task
    // for this model. Models with no auto-graded runs anywhere stay null.
    const columnSummary = new Map<string, { avg: number | null; tasksGraded: number }>()
    for (const m of models) {
      const perTaskLatest: number[] = []
      for (const t of tasks) {
        const c = cellMap.get(`${t.id}::${m}`)
        if (c?.latest && c.latest.rubricScore != null) perTaskLatest.push(c.latest.rubricScore)
      }
      columnSummary.set(m, {
        avg: perTaskLatest.length ? Math.round(perTaskLatest.reduce((s, v) => s + v, 0) / perTaskLatest.length) : null,
        tasksGraded: perTaskLatest.length,
      })
    }

    return { models, cellMap, columnSummary }
  }, [tasks, runs])

  if (models.length === 0 || tasks.length === 0) return null
  const builtIn = tasks.filter(t => t.builtIn)
  const custom  = tasks.filter(t => !t.builtIn)
  const ordered = [...builtIn, ...custom]

  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
        <GitCompare size={13} className="text-violet-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Benchmark comparison — task × model</h3>
        <HeuristicTag tip="Each cell is the latest auto-graded rubric score this model produced for this task. Built-in tasks grade deterministically; user-defined tasks show — until you assign a manual rubric score. Empty cells mean the model hasn't run that task yet." />
        <span className="ml-auto text-[10px] text-text-muted">{ordered.length} task{ordered.length === 1 ? '' : 's'} · {models.length} model{models.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-white/[0.02] text-text-muted">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium whitespace-nowrap">Task ↓ · Model →</th>
              {models.map(m => {
                const s = columnSummary.get(m)
                return (
                  <th key={m} className="px-2 py-2 font-medium whitespace-nowrap min-w-[120px]">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-text-primary truncate max-w-[200px]" title={m}>{m}</span>
                      <span className="text-[9px] font-normal text-text-muted">
                        {s?.avg == null
                          ? 'no graded runs'
                          : <>avg <span className={scoreColor(s.avg)}>{s.avg}</span> · {s.tasksGraded}/{ordered.length} tasks</>}
                      </span>
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {ordered.map(t => (
              <tr key={t.id} className="border-t border-white/5">
                <td className="px-3 py-2 max-w-[260px]">
                  <div className="flex items-center gap-2">
                    <span className="text-text-primary text-xs truncate" title={t.title}>{t.title}</span>
                    {t.builtIn && (
                      <span className="text-[9px] uppercase tracking-wide px-1 py-px rounded bg-violet-500/15 text-violet-200 flex-shrink-0" title="Built-in — auto-graded">
                        auto
                      </span>
                    )}
                  </div>
                  <span className="block text-[10px] text-text-muted truncate" title={t.prompt}>{t.prompt.slice(0, 80)}{t.prompt.length > 80 ? '…' : ''}</span>
                </td>
                {models.map(m => {
                  const c = cellMap.get(`${t.id}::${m}`)
                  if (!c || !c.latest) {
                    return <td key={m} className="px-2 py-2 text-text-muted/40 text-center text-[10px]">—</td>
                  }
                  const score = c.latest.rubricScore
                  const status = c.latest.status
                  // Failed dispatches with no rubric score still convey signal.
                  if (score == null) {
                    return (
                      <td key={m} className="px-2 py-2 text-center"
                          title={`${c.runCount} run${c.runCount === 1 ? '' : 's'} · latest ${status} · ${fmtTimeAgo(c.latest.ts)} · no rubric grade`}>
                        <span className={clsx('text-[10px] px-1 py-0.5 rounded',
                          status === 'failure' || status === 'error' ? 'bg-red-500/15 text-red-300' : 'bg-white/5 text-text-muted')}>
                          {status}
                        </span>
                      </td>
                    )
                  }
                  return (
                    <td key={m} className="px-2 py-2 text-center"
                        title={`${c.runCount} run${c.runCount === 1 ? '' : 's'} · ${c.rubricScored} graded · best ${c.bestScore} / worst ${c.worstScore} · latest ${fmtTimeAgo(c.latest.ts)}`}>
                      <span className={clsx('inline-flex items-center justify-center min-w-[40px] px-1.5 py-0.5 rounded font-semibold tabular-nums',
                        scoreBg(score), scoreColor(score))}>
                        {Math.round(score)}
                      </span>
                      {c.runCount > 1 && (
                        <span className="block text-[9px] text-text-muted/70 mt-0.5">
                          ±{Math.max(0, (c.bestScore ?? 0) - (c.worstScore ?? 0))} · n={c.rubricScored}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
