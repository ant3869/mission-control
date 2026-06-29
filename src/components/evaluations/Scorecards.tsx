// title: Model leaderboard + score breakdown for the Evaluations view
// path: src/components/evaluations/Scorecards.tsx

import { clsx } from 'clsx'
import { ChevronRight, Trophy } from 'lucide-react'
import type { ModelScorecard } from '../../lib/api'
import { fmtNum, fmtPct, scoreColor, scoreBg, HeuristicTag } from './shared'

interface LeaderboardProps {
  scorecards: ModelScorecard[]
  selectedModel: string | null
  onSelect:     (model: string) => void
}

export function ModelLeaderboard({ scorecards, selectedModel, onSelect }: LeaderboardProps) {
  if (scorecards.length === 0) return null
  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <Trophy size={13} className="text-amber-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Model leaderboard</h3>
        <HeuristicTag />
        <span className="ml-auto text-[10px] text-text-muted">{scorecards.length} model{scorecards.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-white/[0.02] text-text-muted">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-2 py-2 font-medium text-right">Overall</th>
              <th className="px-2 py-2 font-medium text-right" title="Average auto-graded benchmark rubric score (built-in tasks). Most reliable signal for comparing models.">Bench</th>
              <th className="px-2 py-2 font-medium text-right">Success</th>
              <th className="px-2 py-2 font-medium text-right">Failure</th>
              <th className="px-2 py-2 font-medium text-right">Recovery</th>
              <th className="px-2 py-2 font-medium text-right">Tool waste</th>
              <th className="px-2 py-2 font-medium text-right">Repeats</th>
              <th className="px-2 py-2 font-medium text-right">Runs</th>
              <th className="px-2 py-2 font-medium text-right">Confidence</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {scorecards.map(c => {
              const selected = c.model === selectedModel
              return (
                <tr
                  key={c.platform + ':' + c.model}
                  onClick={() => onSelect(c.model)}
                  className={clsx(
                    'border-t border-white/5 cursor-pointer transition-colors',
                    selected ? 'bg-violet-500/10' : 'hover:bg-white/5',
                  )}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col">
                      <span className="text-text-primary font-medium">{c.modelLabel}</span>
                      <span className="text-text-muted text-[10px] font-mono truncate max-w-[200px]">{c.model}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <span className={clsx('inline-flex items-center justify-center min-w-[42px] px-2 py-0.5 rounded-md font-semibold tabular-nums', scoreBg(c.overall), scoreColor(c.overall))}>
                      {c.overall}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums" title={c.benchmarkScore != null ? `${c.benchmarkRuns} benchmark run${c.benchmarkRuns === 1 ? '' : 's'} (auto-graded built-ins + any manual rubric scores averaged)` : 'no graded benchmark runs yet — dispatch a built-in task'}>
                    {c.benchmarkScore == null
                      ? <span className="text-text-muted">—</span>
                      : <span className={clsx('inline-flex items-center justify-center min-w-[36px] px-1.5 py-0.5 rounded font-semibold', scoreBg(c.benchmarkScore), scoreColor(c.benchmarkScore))}>
                          {Math.round(c.benchmarkScore)}
                        </span>}
                  </td>
                  <td className={clsx('px-2 py-2.5 text-right tabular-nums', c.successRate != null && c.successRate < 60 && 'text-amber-300')}>{fmtPct(c.successRate)}</td>
                  <td className={clsx('px-2 py-2.5 text-right tabular-nums', c.failureRate != null && c.failureRate > 20 && 'text-red-300')}>{fmtPct(c.failureRate)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtPct(c.recoveryRate)}</td>
                  <td className={clsx('px-2 py-2.5 text-right tabular-nums', c.wasteRate != null && c.wasteRate > 25 && 'text-amber-300')}>{fmtPct(c.wasteRate)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtPct(c.repeatRate)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-text-muted">{c.evaluatedCount}/{c.runCount}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-text-muted">{Math.round(c.confidence)}%</td>
                  <td className="px-2 py-2.5 text-right"><ChevronRight size={12} className={clsx(selected ? 'text-violet-300' : 'text-text-muted')} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function PlatformFactorBar({ factors }: { factors: Array<{ key: string; label: string; value: number | null }> }) {
  if (factors.length === 0) return null
  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Score factor breakdown (platform-wide)</h3>
        <HeuristicTag />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {factors.map(f => (
          <div key={f.key} className="flex flex-col gap-1.5 p-3 bg-white/[0.02] rounded-lg border border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-primary">{f.label}</span>
              <span className={clsx('text-sm font-semibold tabular-nums', scoreColor(f.value))}>{f.value == null ? '—' : Math.round(f.value)}</span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{
                width: f.value == null ? '0%' : `${Math.min(100, Math.max(3, f.value))}%`,
                background: f.value == null ? undefined : f.value >= 80 ? '#4ade80' : f.value >= 60 ? '#2dd4bf' : f.value >= 45 ? '#fbbf24' : '#f87171',
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MiniSummaryStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 bg-bg-secondary border border-white/10 rounded-xl">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className="text-xl font-semibold tabular-nums text-text-primary leading-none">{value}</span>
      {sub && <span className="text-[10px] text-text-muted truncate">{sub}</span>}
    </div>
  )
}

export { fmtNum }
