// title: Agent × model evaluation matrix
// path: src/components/evaluations/Matrix.tsx

import { clsx } from 'clsx'
import { Grid3x3 } from 'lucide-react'
import type { AgentModelCell } from '../../lib/api'
import { scoreBg, scoreColor, fmtPct, HeuristicTag } from './shared'

interface MatrixProps {
  agents: string[]
  models: string[]
  cells:  AgentModelCell[]
  onSelectCell?: (cell: AgentModelCell) => void
}

export function AgentModelMatrix({ agents, models, cells, onSelectCell }: MatrixProps) {
  if (agents.length === 0 || models.length === 0) return null
  const cellMap = new Map<string, AgentModelCell>()
  for (const c of cells) cellMap.set(`${c.agent}|${c.model}`, c)

  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <Grid3x3 size={13} className="text-violet-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Agent × model matrix</h3>
        <HeuristicTag />
        <span className="ml-auto text-[10px] text-text-muted">{agents.length} agent{agents.length === 1 ? '' : 's'} · {models.length} model{models.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left font-medium text-text-muted">Agent ↓ · Model →</th>
              {models.map(m => {
                const sc = cells.find(c => c.model === m)
                return (
                  <th key={m} className="px-2 py-2 text-left font-medium text-text-primary whitespace-nowrap">
                    {sc?.modelLabel ?? m}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {agents.map(a => (
              <tr key={a} className="border-t border-white/5">
                <td className="px-3 py-2 text-text-primary font-medium whitespace-nowrap">{a}</td>
                {models.map(m => {
                  const cell = cellMap.get(`${a}|${m}`)
                  if (!cell) return <td key={m} className="px-2 py-2"><span className="text-text-muted opacity-30">—</span></td>
                  return (
                    <td key={m} className="px-2 py-2">
                      <button
                        onClick={() => onSelectCell?.(cell)}
                        className={clsx('w-full px-2 py-1.5 rounded text-left transition-opacity hover:opacity-100 opacity-90', scoreBg(cell.overall))}
                        title={`${cell.runCount} runs · ${cell.evaluatedCount} evaluated · success ${fmtPct(cell.successRate)} · waste ${fmtPct(cell.wasteRate)}`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={clsx('font-semibold tabular-nums', scoreColor(cell.overall))}>{cell.overall ?? '—'}</span>
                          <span className="text-[10px] text-text-muted tabular-nums">{cell.runCount}r</span>
                        </div>
                        <div className="text-[10px] text-text-muted tabular-nums">
                          ✓ {fmtPct(cell.successRate)} · 🗑 {fmtPct(cell.wasteRate)}
                        </div>
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-white/5 text-[10px] text-text-muted">
        Cell color = composite score (green = strong, red = weak). Empty cells mean the agent never ran that model in the captured window.
      </div>
    </div>
  )
}
