// title: Cross-model benchmark comparison table
// path: src/components/evaluations/BenchmarkComparison.tsx
// purpose: One row per benchmark task, one column per model. Each cell is the
//          latest auto-graded rubric score that (task, model) pair produced.
//          Highlights the best score per row so a user can see at a glance
//          which model wins each task, and surfaces coverage gaps so empty
//          cells become actionable ("dispatch X to fill this row") instead
//          of cosmetic dashes.

import { useMemo } from 'react'
import { clsx } from 'clsx'
import { GitCompare, Trophy, AlertCircle } from 'lucide-react'
import type { BenchmarkTask, BenchmarkRun } from '../../lib/api'
import { fmtTimeAgo, fmtDuration, scoreBg, scoreColor, HeuristicTag } from './shared'
import { buildComparisonMatrix, gapsInComparison } from './synthesis'

interface Props {
  tasks: BenchmarkTask[]
  runs:  BenchmarkRun[]
  /** Optional callback so clicking a column header re-targets the Model Report. */
  onSelectModel?: (model: string) => void
}

export function BenchmarkComparison({ tasks, runs, onSelectModel }: Props) {
  const { models, rows, modelColumnSummary } = useMemo(
    () => buildComparisonMatrix({ tasks, runs }),
    [tasks, runs],
  )

  // Sort built-in tasks first; preserves the catalog ordering the user expects.
  const orderedRows = useMemo(() => {
    const builtIn = rows.filter(r => r.task.builtIn)
    const custom  = rows.filter(r => !r.task.builtIn)
    return [...builtIn, ...custom]
  }, [rows])

  const { neverRun, lowestCoverage } = useMemo(() => gapsInComparison(orderedRows), [orderedRows])

  if (models.length === 0 || tasks.length === 0) {
    // Show an actionable empty-state instead of hiding the section. A user who
    // lands here without runs needs to know what would populate it.
    return (
      <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <GitCompare size={13} className="text-violet-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Benchmark comparison — task × model</h3>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">
          No model has run a benchmark yet. Dispatch any task below (built-ins are auto-graded) and a comparison grid will populate as scores come in.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 flex-wrap">
        <GitCompare size={13} className="text-violet-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Benchmark comparison — task × model</h3>
        <HeuristicTag tip="Each cell is the latest auto-graded rubric score this model produced for this task. The trophy marks the best score per row. Empty cells mean the model hasn't run that task yet — dispatch to fill the gap." />
        <span className="ml-auto text-[10px] text-text-muted">{orderedRows.length} task{orderedRows.length === 1 ? '' : 's'} · {models.length} model{models.length === 1 ? '' : 's'}</span>
      </div>

      {(neverRun.length > 0 || lowestCoverage.length > 0) && (
        <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/15 text-[11px] text-amber-200 flex items-start gap-2">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <div className="leading-snug">
            {neverRun.length > 0 && (
              <p>
                <span className="font-semibold">Untested:</span>{' '}
                {neverRun.slice(0, 4).map(t => t.title).join(', ')}
                {neverRun.length > 4 && ` +${neverRun.length - 4} more`}
                {' '}— dispatch any task to populate its row.
              </p>
            )}
            {lowestCoverage.length > 0 && (
              <p>
                <span className="font-semibold">Partial coverage:</span> {lowestCoverage.length} task{lowestCoverage.length === 1 ? '' : 's'} only graded on a subset of models — fill the gaps to make rows comparable.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-white/[0.02] text-text-muted">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium whitespace-nowrap">Task ↓ · Model →</th>
              {models.map(m => {
                const s = modelColumnSummary.get(m)
                return (
                  <th key={m} className="px-2 py-2 font-medium whitespace-nowrap min-w-[120px]">
                    <button type="button"
                      onClick={() => onSelectModel?.(m)}
                      className={clsx('flex flex-col gap-0.5 w-full text-left',
                        onSelectModel && 'hover:text-violet-200 cursor-pointer')}
                      title={onSelectModel ? `Open report for ${m}` : m}>
                      <span className="text-text-primary truncate max-w-[200px]">{m}</span>
                      <span className="text-[9px] font-normal text-text-muted">
                        {s?.avg == null
                          ? 'no graded runs'
                          : <>avg <span className={scoreColor(s.avg)}>{s.avg}</span> · {s.tasksGraded}/{orderedRows.length} tasks</>}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {orderedRows.map(row => {
              const t = row.task
              const winnerSet = new Set(row.bestModels)
              return (
                <tr key={t.id} className="border-t border-white/5">
                  <td className="px-3 py-2 max-w-[260px]">
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary text-xs truncate" title={t.title}>{t.title}</span>
                      {t.builtIn && (
                        <span className="text-[9px] uppercase tracking-wide px-1 py-px rounded bg-violet-500/15 text-violet-200 flex-shrink-0" title="Built-in — auto-graded">
                          auto
                        </span>
                      )}
                      {row.aliasTaskIds.length > 0 && (
                        <span className="text-[9px] uppercase tracking-wide px-1 py-px rounded bg-white/10 text-text-muted flex-shrink-0" title="Same built-in task is installed on both platforms — runs from both are merged into this row.">
                          merged
                        </span>
                      )}
                      {row.ungradeable && (
                        <span className="text-[9px] uppercase tracking-wide px-1 py-px rounded bg-amber-500/15 text-amber-200 flex-shrink-0" title="Runs completed but no rubric score — this task has no auto-grader. Add a rubric or build a deterministic grader.">
                          needs grader
                        </span>
                      )}
                      {!row.ungradeable && row.coverage.graded === 0 && (
                        <span className="text-[9px] uppercase tracking-wide px-1 py-px rounded bg-amber-500/15 text-amber-200 flex-shrink-0" title="No model has produced a graded run for this task yet.">
                          unrun
                        </span>
                      )}
                      {row.bestScore != null && row.bestModels.length === 1 && row.coverage.graded >= 2 && row.spreadAcross >= 10 && (
                        <span className="text-[9px] uppercase tracking-wide px-1 py-px rounded bg-emerald-500/15 text-emerald-200 flex-shrink-0" title={`Spread of ${row.spreadAcross} pts across graded models — clear winner`}>
                          decisive
                        </span>
                      )}
                    </div>
                    <span className="block text-[10px] text-text-muted truncate" title={t.prompt}>{t.prompt.slice(0, 80)}{t.prompt.length > 80 ? '…' : ''}</span>
                  </td>
                  {models.map(m => {
                    const c = row.cells.get(m)
                    if (!c || c.runCount === 0) {
                      return (
                        <td key={m} className="px-2 py-2 text-text-muted/40 text-center text-[10px]"
                            title="Not yet dispatched on this model. Run the task with this model selected to fill this cell.">
                          —
                        </td>
                      )
                    }
                    const score = c.latestScore
                    const winner = winnerSet.has(m) && row.bestModels.length === 1 && score != null
                    const outcome = c.latestOutcome ?? c.latestStatus ?? '—'
                    const outcomeColor =
                      outcome === 'success' || outcome === 'recovered' ? 'text-emerald-300' :
                      outcome === 'failure' || outcome === 'error'      ? 'text-red-300' :
                      'text-text-muted'
                    const titleLine = `${c.runCount} run${c.runCount === 1 ? '' : 's'} · ${c.rubricScored} graded`
                      + (score != null ? ` · best ${c.bestScore} / worst ${c.worstScore} · spread ${c.spread}` : ' · no rubric grade')
                      + ` · latest ${fmtTimeAgo(c.latestTs)} · ${fmtDuration(c.durationMs ?? 0)}`
                      + (c.notes ? ` · ${c.notes.slice(0, 80)}` : '')
                    return (
                      <td key={m} className={clsx('px-2 py-2 text-center align-top', winner && 'bg-emerald-500/[0.06]')}
                          title={titleLine}>
                        {score == null ? (
                          <span className={clsx('inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded',
                            c.needsGrader ? 'bg-white/5 text-text-muted border border-amber-500/20' : 'bg-white/5 text-text-muted')}>
                            <span className={outcomeColor}>{outcome}</span>
                          </span>
                        ) : (
                          <span className={clsx('inline-flex items-center justify-center min-w-[40px] px-1.5 py-0.5 rounded font-semibold tabular-nums gap-1',
                            scoreBg(score), scoreColor(score),
                            winner && 'ring-1 ring-emerald-400/50')}>
                            {winner && <Trophy size={9} className="text-emerald-300" />}
                            {Math.round(score)}
                          </span>
                        )}
                        <span className="block text-[9px] text-text-muted/80 mt-0.5 leading-tight">
                          <span className={outcomeColor}>{outcome}</span>
                          {' · n='}{c.runCount}
                          {c.durationMs != null && c.durationMs > 0 && <> · {fmtDuration(c.durationMs)}</>}
                        </span>
                        {c.runCount > 1 && score != null && (
                          <span className="block text-[9px] text-text-muted/60">±{c.spread}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
