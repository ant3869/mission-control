// title: Score / activity trend chart for the Evaluations view
// path: src/components/evaluations/TrendChart.tsx

import { TrendingUp } from 'lucide-react'
import type { EvalTrendPoint, ModelSnapshot } from '../../lib/api'
import { HeuristicTag } from './shared'

interface TrendProps { trend: EvalTrendPoint[]; snapshots?: ModelSnapshot[]; title?: string }

export function ScoreTrendChart({ trend, snapshots, title = 'Score trends over time' }: TrendProps) {
  const useSnapshots = (snapshots?.length ?? 0) >= 2
  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={13} className="text-violet-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h3>
        <HeuristicTag />
        <span className="ml-auto text-[10px] text-text-muted">
          {useSnapshots ? `${snapshots!.length} daily snapshots` : `${trend.length} day${trend.length === 1 ? '' : 's'} of runs`}
        </span>
      </div>
      {useSnapshots ? <SnapshotLines snapshots={snapshots!} /> : <ActivityBars trend={trend} />}
    </div>
  )
}

function SnapshotLines({ snapshots }: { snapshots: ModelSnapshot[] }) {
  const W = 600, H = 160, padL = 32, padR = 8, padT = 8, padB = 22
  if (snapshots.length === 0) {
    return <div className="h-[160px] flex items-center justify-center text-xs text-text-muted">No snapshots yet</div>
  }
  const xs = snapshots.map(s => new Date(s.ts).getTime())
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const dx = xMax === xMin ? 1 : xMax - xMin
  const sx = (t: number) => padL + ((t - xMin) / dx) * (W - padL - padR)
  const sy = (v: number) => padT + (1 - v / 100) * (H - padT - padB)
  const pts = snapshots.map(s => `${sx(new Date(s.ts).getTime())},${sy(s.overall)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line x1={padL} y1={sy(v)} x2={W - padR} y2={sy(v)} stroke="rgba(255,255,255,0.05)" />
          <text x={padL - 6} y={sy(v) + 3} fontSize={9} textAnchor="end" fill="rgba(255,255,255,0.4)">{v}</text>
        </g>
      ))}
      <polyline points={pts} fill="none" stroke="#a78bfa" strokeWidth={1.6} />
      {snapshots.map((s, i) => (
        <circle key={i} cx={sx(new Date(s.ts).getTime())} cy={sy(s.overall)} r={2.4} fill="#a78bfa">
          <title>{`${new Date(s.ts).toLocaleString()} · overall ${s.overall} · ${s.runCount} runs`}</title>
        </circle>
      ))}
    </svg>
  )
}

function ActivityBars({ trend }: { trend: EvalTrendPoint[] }) {
  if (trend.length === 0) {
    return (
      <div className="h-[160px] flex flex-col items-center justify-center text-xs text-text-muted gap-1">
        <span>No daily activity yet</span>
        <span className="opacity-70 text-[10px]">snapshots accumulate from your real runs over time</span>
      </div>
    )
  }
  const maxRuns = Math.max(...trend.map(t => t.runs), 1)
  return (
    <div className="flex items-end gap-px h-[120px] mb-2">
      {trend.map(t => {
        const h = (t.runs / maxRuns) * 100
        const sr = t.successRate ?? 0
        const color = sr >= 80 ? '#4ade80' : sr >= 60 ? '#2dd4bf' : sr >= 45 ? '#fbbf24' : '#f87171'
        return (
          <div key={t.date} className="flex-1 min-w-0 flex flex-col items-stretch gap-0.5" title={`${t.date}: ${t.runs} runs · success ${t.successRate ?? '—'}%`}>
            <div style={{ height: `${h}%`, backgroundColor: color, opacity: t.evaluated > 0 ? 0.85 : 0.4 }} className="rounded-t-sm" />
          </div>
        )
      })}
    </div>
  )
}
