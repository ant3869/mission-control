// title: Inline methodology accordion — cross-references the live UI labels
// path: src/components/evaluations/InlineMethodology.tsx
// purpose: Demote the standalone Methodology tab into a glossary that lives at
//          the bottom of the cockpit, and annotate the labels users actually
//          see ("Bench", "Memory", "Tool waste", "False recall", "n=runs",
//          "needs grader", …) instead of being a separate reference page.

import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { BookOpen, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { evaluations, memoryEvaluations, type ScoringMethodology, type MemoryScoringMethodology } from '../../lib/api'

// Inline definitions for every label the cockpit surfaces. Keys map to either
// a sub-score key from the methodology endpoint or to one of the cockpit's
// own UI labels (cells, queue buckets, source chips).
const UI_GLOSSARY: Array<{ label: string; detail: string }> = [
  { label: 'Overall',       detail: 'Weighted combination of all sub-scores. Sub-scores and weights are listed below; the weights are pulled live from /evaluations/scoring-methodology.' },
  { label: 'Bench',         detail: 'Average of the latest auto-graded rubric score per task for this model. Dash = no graded benchmark dispatches yet — overall reverts to heuristic-only.' },
  { label: 'Memory',        detail: 'Memory benchmark composite for this model (retrieval + usage + freshness − false-recall penalty). Aggregated from per-task memory runs.' },
  { label: 'Success / Failure / Recovery', detail: 'Outcomes inferred from transcripts. Unresolved runs (no clear ending) are excluded from rates; recovery = an error followed by a successful assistant response.' },
  { label: 'Tool waste',    detail: 'Repeated tool calls + oscillations + tool errors as a fraction of total tool calls. > 25% triggers a drag warning.' },
  { label: 'False recall',  detail: 'Penalty applied when memory retrieval surfaces or restates forbidden / stale facts. Counts toward the memory composite and is also tracked on its own.' },
  { label: 'n=runs',        detail: 'Number of completed (non-running) runs aggregated into the cell. Higher n raises confidence but does not change the displayed score (we show the latest, not the average — older outliers do not drag the column).' },
  { label: 'auto',          detail: 'Built-in task with a deterministic server-side grader registered. Every dispatch produces a 0–100 rubricScore automatically.' },
  { label: 'needs grader',  detail: 'Task ran but no rubricScore was produced — typically a custom task without an auto-grader. Either add a manual rubric or build a deterministic check.' },
  { label: 'merged',        detail: 'Same built-in slug is installed on both OpenClaw and Hermes. The comparison row merges runs from both platforms so you see one row, not two.' },
  { label: 'unrun',         detail: 'No model has produced any graded run for this task yet. Dispatch any model to fill the row.' },
  { label: 'decisive',      detail: 'A clear winner: the top model is ≥ 10 pts ahead of the next, across ≥ 2 graded models.' },
  { label: 'session / bench / memory chips', detail: 'Source-of-truth tag on each strength/weakness finding. "session" = inferred from real transcripts, "bench" = auto-graded rubric, "memory" = memory benchmark composite.' },
  { label: 'Confidence',    detail: 'Engine score for sample adequacy. < 50 = directional only; ≥ 75 = solid sample. Strip is highlighted amber when low.' },
]

export function InlineMethodology({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [data, setData] = useState<ScoringMethodology | null>(null)
  const [mem,  setMem]  = useState<MemoryScoringMethodology | null>(null)
  const [loading, setLoading] = useState(false)

  // Lazy-load methodology only when the user opens the accordion. Saves an API
  // round-trip on cockpit boot and keeps the methodology endpoint optional.
  useEffect(() => {
    if (!open || data) return
    setLoading(true)
    Promise.all([evaluations.methodology(), memoryEvaluations.methodology()])
      .then(([m, mm]) => { setData(m); setMem(mm) })
      .catch(() => { /* silent — glossary still renders */ })
      .finally(() => setLoading(false))
  }, [open, data])

  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-white/[0.04]">
        {open ? <ChevronDown size={12} className="text-text-muted" /> : <ChevronRight size={12} className="text-text-muted" />}
        <BookOpen size={13} className="text-violet-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Methodology — what every label means</h3>
        {loading && <RefreshCw size={11} className="text-text-muted animate-spin ml-auto" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4">
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Labels you see in the cockpit</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {UI_GLOSSARY.map(g => (
                <div key={g.label} className="flex flex-col gap-0.5 p-2 bg-white/[0.02] rounded border border-white/5">
                  <span className="text-[11px] font-semibold text-text-primary">{g.label}</span>
                  <p className="text-[10px] text-text-muted leading-snug">{g.detail}</p>
                </div>
              ))}
            </div>
          </div>

          {data && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Sub-scores · weights (live)</h4>
              <div className="space-y-1">
                {data.subScores.map(s => (
                  <div key={s.key} className="flex items-center gap-3 px-2 py-1 bg-white/[0.02] rounded border border-white/5">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-violet-300 w-28 flex-shrink-0">{s.key}</span>
                    <span className="text-[11px] text-text-primary flex-1 min-w-0 truncate">{s.label}</span>
                    <span className="text-[10px] text-text-muted">weight</span>
                    <span className="text-[11px] font-semibold tabular-nums text-text-primary w-10 text-right">{s.weight.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-text-muted mt-2 leading-snug">{data.overview}</p>
            </div>
          )}

          {mem && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Memory sub-scores · weights (live)</h4>
              <div className="space-y-1">
                {mem.subScores.map(s => (
                  <div key={s.key} className="flex items-center gap-3 px-2 py-1 bg-white/[0.02] rounded border border-white/5">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-300 w-32 flex-shrink-0 truncate">{s.key}</span>
                    <span className="text-[11px] text-text-primary flex-1 min-w-0 truncate">{s.label}</span>
                    <span className="text-[10px] text-text-muted">weight</span>
                    <span className={clsx('text-[11px] font-semibold tabular-nums w-12 text-right', s.weight < 0 ? 'text-red-300' : 'text-text-primary')}>{s.weight.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-text-muted mt-2 leading-snug">{mem.overview}</p>
            </div>
          )}

          {data?.autoGradedBuiltinSlugs && data.autoGradedBuiltinSlugs.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Auto-graded built-in slugs ({data.autoGradedBuiltinSlugs.length})</h4>
              <div className="flex flex-wrap gap-1">
                {data.autoGradedBuiltinSlugs.map(slug => (
                  <span key={slug} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">{slug}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
