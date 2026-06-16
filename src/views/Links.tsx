import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  Archive, CheckSquare, ExternalLink, Globe,
  NotebookPen, Pencil, Pin, PinOff, Plus, RefreshCw, Search, Trash2, X,
} from 'lucide-react'
import { links, tasks, type LinkCreateBody, type LinkItem } from '../lib/api'
import { createQuickNotePage, openDocsTab, openHubTab, openNotePage, requestNavigate } from '../lib/quickActions'
import { friendlyError } from '../lib/friendlyError'

function TagsInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('')

  function addTag() {
    const tag = draft.trim().toLowerCase().replace(/\s+/g, '-')
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
          placeholder="Add tag…"
          className="flex-1 rounded-lg border border-border bg-base px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/50"
        />
        <button onClick={addTag} className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary hover:bg-card-hover">Add</button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(tag => (
            <span key={tag} className="flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-xxs text-text-muted">
              {tag}
              <button onClick={() => onChange(value.filter(entry => entry !== tag))}><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function LinkModal({
  initial,
  onClose,
  onSave,
  saving,
}: {
  initial: LinkItem | null
  onClose: () => void
  onSave: (body: LinkCreateBody) => Promise<void>
  saving: boolean
}) {
  const [url, setUrl] = useState(initial?.url ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [pinned, setPinned] = useState(Boolean(initial?.pinned))
  const [error, setError] = useState('')

  async function submit() {
    if (!url.trim()) { setError('URL is required'); return }
    try {
      await onSave({ url: url.trim(), title, note, tags, pinned })
    } catch (err: any) {
      setError(err?.message ?? 'Could not save link')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-text-primary">{initial ? 'Edit Link' : 'Save Link'}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <label className="flex flex-col gap-1">
            <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">URL</span>
            <input value={url} onChange={e => { setUrl(e.target.value); setError('') }} placeholder="https://example.com/article"
              className="rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/50" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Title</span>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Optional custom title"
              className="rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/50" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Note</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} placeholder="Why this matters, what to revisit, what to build…"
              className="rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/50" />
          </label>
          <div>
            <span className="mb-1 block text-xxs font-semibold uppercase tracking-wide text-text-muted">Tags</span>
            <TagsInput value={tags} onChange={setTags} />
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> Pin this link
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-xs text-text-muted hover:text-text-secondary">Cancel</button>
          <button onClick={submit} disabled={saving} className="rounded-lg bg-accent-blue px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Save link'}
          </button>
        </div>
      </div>
    </div>
  )
}

function buildNoteContent(link: LinkItem): string {
  return [`# ${link.title}`, '', link.url, '', link.note].filter(Boolean).join('\n')
}

export function Links() {
  const [items, setItems] = useState<LinkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<LinkItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await links.list(archived)
      setItems(response.links)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load links')
    } finally {
      setLoading(false)
    }
  }, [archived])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(item =>
      item.title.toLowerCase().includes(q)
      || item.url.toLowerCase().includes(q)
      || item.note.toLowerCase().includes(q)
      || item.tags.some(tag => tag.toLowerCase().includes(q)),
    )
  }, [items, query])

  async function handleSave(body: LinkCreateBody) {
    setSaving(true)
    try {
      if (editing) await links.update(editing.id, body)
      else await links.create({ ...body, source: 'manual' })
      setModalOpen(false)
      setEditing(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handleTogglePin(item: LinkItem) {
    setBusyId(item.id)
    try { await links.update(item.id, { pinned: !item.pinned }); await load() }
    catch (err: any) { setError(err?.message ?? 'Could not update link') }
    finally { setBusyId(null) }
  }

  async function handleArchive(item: LinkItem) {
    setBusyId(item.id)
    try { await links.update(item.id, { archived: !item.archived }); await load() }
    catch (err: any) { setError(err?.message ?? 'Could not archive link') }
    finally { setBusyId(null) }
  }

  async function handleDelete(item: LinkItem) {
    if (!confirm(`Delete "${item.title}"?`)) return
    setBusyId(item.id)
    try { await links.remove(item.id); await load() }
    catch (err: any) { setError(err?.message ?? 'Could not delete link') }
    finally { setBusyId(null) }
  }

  async function handleOpen(item: LinkItem) {
    window.open(item.url, '_blank', 'noopener,noreferrer')
    setBusyId(item.id)
    try { await links.update(item.id, { openedAt: new Date().toISOString() }); await load() }
    catch { /* ignore */ }
    finally { setBusyId(null) }
  }

  async function handleCreateTask(item: LinkItem) {
    setBusyId(item.id)
    try {
      await tasks.create({
        title: item.title,
        description: [item.url, item.note].filter(Boolean).join('\n\n'),
        priority: 'medium',
        status: 'queued',
        tags: [...new Set(['link', item.domain, ...item.tags])],
      })
      openHubTab('todos', 'tasks')
    } catch (err: any) {
      setError(err?.message ?? 'Could not create task from link')
    } finally {
      setBusyId(null)
    }
  }

  async function handleCreateNote(item: LinkItem) {
    setBusyId(item.id)
    try {
      const created = await createQuickNotePage({
        title: item.title,
        content: buildNoteContent(item),
        tags: [...new Set(['link', ...item.tags])],
      })
      openNotePage(created.page.id)
      requestNavigate('docs')
      openDocsTab('notes')
    } catch (err: any) {
      setError(err?.message ?? 'Could not create note from link')
    } finally {
      setBusyId(null)
    }
  }

  const pinnedCount = items.filter(item => item.pinned).length

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 pt-5 pb-4 shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Links</h1>
          <p className="mt-0.5 text-xs text-text-muted">
            {loading ? 'Loading…' : `${items.length} saved links${pinnedCount > 0 ? ` · ${pinnedCount} pinned` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setEditing(null); setModalOpen(true) }} className="flex items-center gap-1.5 rounded border border-border bg-card px-3 py-1.5 text-xs text-text-secondary hover:bg-card-hover hover:text-text-primary">
            <Plus size={12} /> Save link
          </button>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 rounded border border-border bg-card px-3 py-1.5 text-xs text-text-secondary hover:bg-card-hover hover:text-text-primary">
            <RefreshCw size={12} className={clsx(loading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-b border-border px-6 py-3 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search links…"
            className="w-full rounded border border-border bg-card py-1.5 pl-7 pr-3 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border" />
        </div>
        <button onClick={() => setArchived(false)} className={clsx('rounded px-2.5 py-1 text-xs font-medium', !archived ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
          Active
        </button>
        <button onClick={() => setArchived(true)} className={clsx('rounded px-2.5 py-1 text-xs font-medium', archived ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
          Archived
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {friendlyError(error, 'saved links')}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-2 max-w-4xl">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-24 rounded-lg border border-border bg-card animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <Globe size={22} className="text-text-muted" />
            <p className="text-sm text-text-secondary">{items.length === 0 ? 'No saved links yet' : 'No links match'}</p>
            <p className="max-w-sm text-xs text-text-muted">Save articles, specs, docs, and ideas here so they are easy to revisit and turn into work.</p>
          </div>
        ) : (
          <div className="flex max-w-4xl flex-col gap-2">
            {filtered.map(item => (
              <div key={item.id} className={clsx('rounded-lg border bg-card p-4 transition-colors hover:bg-card-hover', busyId === item.id && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 flex-wrap">
                      <button onClick={() => handleOpen(item)} className="truncate text-left text-sm font-semibold text-text-primary hover:text-accent-blue">
                        {item.title}
                      </button>
                      {item.pinned && <span className="rounded border border-amber-900/40 bg-amber-950/20 px-1.5 py-0.5 text-xxs text-amber-300">Pinned</span>}
                      <span className="rounded border border-border bg-base px-1.5 py-0.5 text-xxs text-text-muted">{item.domain}</span>
                      <span className="text-xxs text-text-muted">{item.updatedAgo}</span>
                    </div>
                    <p className="truncate font-mono text-xxs text-accent-blue">{item.url}</p>
                    {item.note && <p className="mt-2 text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">{item.note}</p>}
                    {item.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.tags.map(tag => <span key={tag} className="rounded border border-border-subtle bg-base px-1.5 py-0.5 text-xxs text-text-muted">{tag}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 flex-wrap justify-end max-w-[240px]">
                    <button onClick={() => handleOpen(item)} className="rounded border border-border px-2.5 py-1 text-xxs text-text-secondary hover:bg-card-hover"><ExternalLink size={11} className="inline mr-1" />Open</button>
                    <button onClick={() => handleCreateTask(item)} className="rounded border border-border px-2.5 py-1 text-xxs text-text-secondary hover:bg-card-hover"><CheckSquare size={11} className="inline mr-1" />Task</button>
                    <button onClick={() => handleCreateNote(item)} className="rounded border border-border px-2.5 py-1 text-xxs text-text-secondary hover:bg-card-hover"><NotebookPen size={11} className="inline mr-1" />Note</button>
                    <button onClick={() => handleTogglePin(item)} className="rounded border border-border px-2.5 py-1 text-xxs text-text-secondary hover:bg-card-hover">{item.pinned ? <PinOff size={11} className="inline mr-1" /> : <Pin size={11} className="inline mr-1" />}{item.pinned ? 'Unpin' : 'Pin'}</button>
                    <button onClick={() => { setEditing(item); setModalOpen(true) }} className="rounded border border-border px-2.5 py-1 text-xxs text-text-secondary hover:bg-card-hover"><Pencil size={11} className="inline mr-1" />Edit</button>
                    <button onClick={() => handleArchive(item)} className="rounded border border-border px-2.5 py-1 text-xxs text-text-secondary hover:bg-card-hover"><Archive size={11} className="inline mr-1" />{item.archived ? 'Restore' : 'Archive'}</button>
                    <button onClick={() => handleDelete(item)} className="rounded border border-red-900/40 bg-red-950/20 px-2.5 py-1 text-xxs text-red-300 hover:bg-red-950/35"><Trash2 size={11} className="inline mr-1" />Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <LinkModal
          initial={editing}
          saving={saving}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}