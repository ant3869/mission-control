import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, RefreshCw, Siren } from 'lucide-react'
import { incidents, type Incident } from '../lib/api'
import { friendlyError } from '../lib/friendlyError'

export function Incidents() {
  const [items, setItems] = useState<Incident[]>([])
  const [counts, setCounts] = useState({ open: 0, resolved: 0 })
  const [timeline, setTimeline] = useState<Record<string, Array<{ kind: string; ts: string }>>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const refresh = useCallback(async () => { setLoading(true); setError(''); try { const data = await incidents.refresh(); setItems(data.incidents); setCounts({ open: data.open, resolved: data.resolved }) } catch (cause) { setError(friendlyError(cause, 'Failed to load incidents.')) } finally { setLoading(false) } }, [])
  useEffect(() => { void refresh() }, [refresh])

  const replay = async (id: string) => {
    if (timeline[id]) { setTimeline((current) => { const next = { ...current }; delete next[id]; return next }); return }
    setBusy(id); try { const data = await incidents.replay(id); setTimeline((current) => ({ ...current, [id]: data.timeline })) } catch (cause) { setError(friendlyError(cause, 'Replay failed.')) } finally { setBusy('') }
  }
  const resolve = async (id: string) => { setBusy(id); try { await incidents.resolve(id); await refresh() } catch (cause) { setError(friendlyError(cause, 'Resolve failed.')) } finally { setBusy('') } }

  return <div className="h-full overflow-y-auto p-5">
    <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-text-primary">Incidents</h2><p className="text-xs text-text-muted">{counts.open} open · {counts.resolved} resolved · stable grouping by alert rule</p></div><button onClick={() => void refresh()} className="flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1.5 text-xs text-text-secondary hover:bg-card-hover"><RefreshCw size={13} />Refresh</button></div>
    {error && <p className="mb-3 rounded border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-300">{error}</p>}
    {loading ? <div className="flex h-48 items-center justify-center"><Loader2 size={18} className="animate-spin text-text-muted" /></div> : items.length === 0 ? <div className="flex h-48 flex-col items-center justify-center gap-2 text-text-muted"><Siren size={24} /><p className="text-xs">No incidents recorded.</p></div> : <div className="space-y-2">{items.map((item) => <article key={item.id} className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3"><button onClick={() => void replay(item.id)} className="min-w-0 flex-1 text-left"><div className="flex items-center gap-2">{timeline[item.id] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span className={`h-2 w-2 rounded-full ${item.status === 'open' ? 'bg-red-400' : 'bg-green-400'}`} /><span className="truncate text-xs font-semibold text-text-primary">{item.title}</span><span className="text-[10px] uppercase text-text-muted">{item.severity}</span></div><p className="mt-1 truncate pl-7 text-[11px] text-text-secondary">{item.message}</p><p className="mt-1 pl-7 text-[10px] text-text-muted">{item.occurrences} sightings · last {new Date(item.lastSeenAt).toLocaleString()}</p></button>{item.status === 'open' && <button disabled={Boolean(busy)} onClick={() => void resolve(item.id)} className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-card-hover disabled:opacity-40"><CheckCircle2 size={12} />Resolve</button>}</div>
      {timeline[item.id] && <div className="mt-3 border-t border-border pt-2"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Replay · {timeline[item.id].length} events</p><div className="max-h-48 space-y-1 overflow-y-auto">{timeline[item.id].map((event, index) => <div key={`${event.ts}-${index}`} className="flex gap-2 font-mono text-[10px] text-text-muted"><span>{new Date(event.ts).toLocaleTimeString()}</span><span className="text-accent">{event.kind}</span></div>)}</div></div>}
    </article>)}</div>}
  </div>
}
