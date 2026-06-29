import { useCallback, useEffect, useState } from 'react'
import { FileClock, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { journal, type OperationJournalEntry } from '../lib/api'
import { friendlyError } from '../lib/friendlyError'

export function Journal() {
  const [entries, setEntries] = useState<OperationJournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { setEntries((await journal.list()).entries) }
    catch (cause) { setError(friendlyError(cause, 'Failed to load the operations journal.')) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const undo = async (entry: OperationJournalEntry) => {
    setBusy(entry.id); setError('')
    try { await journal.undo(entry.id); await refresh() }
    catch (cause) { setError(friendlyError(cause, 'Undo failed.')) }
    finally { setBusy('') }
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h2 className="text-sm font-semibold text-text-primary">Operations journal</h2><p className="text-xs text-text-muted">Successful mutations, with sensitive values redacted.</p></div>
        <button onClick={() => void refresh()} className="flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1.5 text-xs text-text-secondary hover:bg-card-hover"><RefreshCw size={13} />Refresh</button>
      </div>
      {error && <p className="mb-3 rounded border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-300">{error}</p>}
      {loading ? <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-text-muted" size={18} /></div> : entries.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-text-muted"><FileClock size={24} /><p className="text-xs">No mutations recorded yet.</p></div>
      ) : <div className="space-y-2">{entries.map((entry) => (
        <article key={entry.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><div className="flex items-center gap-2"><span className="rounded bg-card-hover px-1.5 py-0.5 font-mono text-[10px] text-accent">{entry.method}</span><span className="truncate font-mono text-xs text-text-primary">{entry.path}</span></div><p className="mt-1 text-[11px] text-text-muted">{new Date(entry.createdAt).toLocaleString()} · {entry.changes.length} file change{entry.changes.length === 1 ? '' : 's'}{entry.undoneAt ? ' · undone' : ''}</p></div>
            {entry.undoable && <button disabled={busy === entry.id} onClick={() => void undo(entry)} className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-card-hover disabled:opacity-50">{busy === entry.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}Undo</button>}
          </div>
          {entry.changes.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{entry.changes.map((change, index) => <span key={`${change.path}-${index}`} className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{change.path}</span>)}</div>}
        </article>
      ))}</div>}
    </div>
  )
}
