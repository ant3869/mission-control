// title: Scoring methodology panel for the Evaluations view
// path: src/components/evaluations/Methodology.tsx

import { useEffect, useState } from 'react'
import { BookOpen, RefreshCw, Brain } from 'lucide-react'
import { clsx } from 'clsx'
import { evaluations, memoryEvaluations, type ScoringMethodology, type MemoryScoringMethodology } from '../../lib/api'
import { ErrorBanner } from './shared'

export function MethodologyPanel() {
  const [data, setData]       = useState<ScoringMethodology | null>(null)
  const [mem,  setMem]        = useState<MemoryScoringMethodology | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [m, mm] = await Promise.all([evaluations.methodology(), memoryEvaluations.methodology()])
      setData(m); setMem(mm)
    }
    catch (e: any) { setError(e?.message ?? 'Failed to load') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  if (error) return <ErrorBanner message={error} />
  if (!data) return <div className="px-6 py-6 text-xs text-text-muted">Loading methodology…</div>

  return (
    <div className="space-y-4">
      <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={14} className="text-violet-400" />
          <h3 className="text-sm font-semibold text-text-primary">How scores are computed</h3>
          <button onClick={load} disabled={loading} className="ml-auto flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary">
            <RefreshCw size={10} className={clsx(loading && 'animate-spin')} /> refresh
          </button>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">{data.overview}</p>
      </div>

      <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Per-run outcomes</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {data.outcomes.map(o => (
            <div key={o.key} className="flex items-start gap-3 p-3 bg-white/[0.02] rounded-lg border border-white/5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-violet-300 w-20 flex-shrink-0">{o.key}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text-primary font-medium">{o.label}</p>
                <p className="text-[11px] text-text-muted leading-snug mt-0.5">{o.detail}</p>
              </div>
              <span className="text-xs font-semibold tabular-nums text-text-primary">{o.score == null ? '—' : o.score}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Sub-scores and weights</h3>
        <div className="space-y-2">
          {data.subScores.map(s => (
            <div key={s.key} className="flex items-center gap-3 px-3 py-2 bg-white/[0.02] rounded-lg border border-white/5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-violet-300 w-28 flex-shrink-0">{s.key}</span>
              <span className="text-xs text-text-primary flex-1 min-w-0 truncate">{s.label}</span>
              <span className="text-[10px] text-text-muted">weight</span>
              <span className="text-xs font-semibold tabular-nums text-text-primary w-12 text-right">{s.weight.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Composition rules</h3>
        <ul className="space-y-1.5 text-xs text-text-muted leading-relaxed list-disc pl-5">
          {data.composition.map((rule, i) => <li key={i}>{rule}</li>)}
        </ul>
      </div>

      {data.autoGradedBuiltinSlugs && data.autoGradedBuiltinSlugs.length > 0 && (
        <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Auto-graded built-in benchmarks</h3>
          <p className="text-[11px] text-text-muted leading-relaxed mb-2">
            These slugs have a deterministic server-side grader. Each dispatch produces a 0–100 rubricScore automatically (exact-match, JSON deep-equal, refusal-pattern, timezone parse, …). User-defined tasks fall through to manual scoring.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.autoGradedBuiltinSlugs.map(slug => (
              <span key={slug} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                {slug}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Raw configuration</h3>
        <pre className="text-[10px] text-text-muted font-mono whitespace-pre-wrap overflow-x-auto">{JSON.stringify(data.config, null, 2)}</pre>
      </div>

      {mem && (
        <>
          <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain size={14} className="text-violet-400" />
              <h3 className="text-sm font-semibold text-text-primary">Memory Score methodology</h3>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">{mem.overview}</p>
          </div>

          <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Memory task kinds</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {mem.kinds.map(k => (
                <div key={k.key} className="flex items-start gap-3 p-3 bg-white/[0.02] rounded-lg border border-white/5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-violet-300 w-20 flex-shrink-0">{k.key}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-primary font-medium">{k.label}</p>
                    <p className="text-[11px] text-text-muted leading-snug mt-0.5">{k.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Memory sub-scores and weights</h3>
            <div className="space-y-2">
              {mem.subScores.map(s => (
                <div key={s.key} className="flex items-center gap-3 px-3 py-2 bg-white/[0.02] rounded-lg border border-white/5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-violet-300 w-32 flex-shrink-0 truncate">{s.key}</span>
                  <span className="text-xs text-text-primary flex-1 min-w-0 truncate">{s.label}</span>
                  <span className="text-[10px] text-text-muted">weight</span>
                  <span className={clsx('text-xs font-semibold tabular-nums w-14 text-right', s.weight < 0 ? 'text-red-300' : 'text-text-primary')}>
                    {s.weight.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Memory composition rules</h3>
            <ul className="space-y-1.5 text-xs text-text-muted leading-relaxed list-disc pl-5">
              {mem.composition.map((rule, i) => <li key={i}>{rule}</li>)}
            </ul>
          </div>

          <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Raw memory configuration</h3>
            <pre className="text-[10px] text-text-muted font-mono whitespace-pre-wrap overflow-x-auto">{JSON.stringify(mem.config, null, 2)}</pre>
          </div>
        </>
      )}
    </div>
  )
}
