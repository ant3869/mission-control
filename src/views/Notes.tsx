/**
 * Notes — OneNote-inspired three-pane note-taking view
 *
 * Left panel:   Notebooks tree (expandable → sections)
 * Middle panel: Page list for selected scope (section | notebook | all | search)
 * Right panel:  Page editor with markdown preview, auto-save, tags, pin
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Plus, Search, X, ChevronRight, ChevronDown, Pin, PinOff,
  Tag, Trash2, Eye, Edit3, Loader2, RefreshCw, BookOpen,
  NotebookPen, AlignLeft, Check,
} from 'lucide-react'
import { notes as notesApi } from '../lib/api'
import type { NoteNotebook, NoteSection, NotePage } from '../lib/api'
import {
  clearStoredValue, NOTES_PAGE_EVENT, NOTES_PAGE_STORAGE_KEY, readStoredValue,
} from '../lib/quickActions'

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMd(src: string): React.ReactNode[] {
  const lines = src.split('\n')
  const out: React.ReactNode[] = []
  let codeBlock = false
  let codeLines: string[] = []
  let listItems: React.ReactNode[] = []

  const flushList = () => {
    if (!listItems.length) return
    out.push(<ul key={out.length} className="my-2 pl-4 flex flex-col gap-0.5">{listItems}</ul>)
    listItems = []
  }

  const inlineFmt = (text: string): React.ReactNode => {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|~~[^~]+~~|\[([^\]]+)\]\(([^)]+)\))/)
    if (parts.length === 1) return text
    return <>{parts.map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} className="font-semibold text-text-primary">{p.slice(2,-2)}</strong>
      if (p.startsWith('*')  && p.endsWith('*')  && !p.startsWith('**')) return <em key={i} className="italic text-text-secondary">{p.slice(1,-1)}</em>
      if (p.startsWith('~~') && p.endsWith('~~')) return <span key={i} className="line-through text-text-muted">{p.slice(2,-2)}</span>
      if (p.startsWith('`')  && p.endsWith('`'))  return <code key={i} className="font-mono text-xxs bg-base border border-border-subtle px-1 py-0.5 rounded text-blue-400">{p.slice(1,-1)}</code>
      const linkMatch = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) return <a key={i} href={linkMatch[2]} target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300">{linkMatch[1]}</a>
      return p
    })}</>
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code fences
    if (line.startsWith('```')) {
      if (codeBlock) {
        flushList()
        out.push(
          <pre key={out.length} className="my-3 px-4 py-3 rounded-lg bg-base border border-border-subtle overflow-x-auto">
            <code className="text-xxs font-mono text-green-400 leading-relaxed">{codeLines.join('\n')}</code>
          </pre>
        )
        codeBlock = false; codeLines = []
      } else {
        codeBlock = true; codeLines = []
      }
      continue
    }
    if (codeBlock) { codeLines.push(line); continue }

    // Headings
    const h3 = line.match(/^### (.+)/)
    const h2 = line.match(/^## (.+)/)
    const h1 = line.match(/^# (.+)/)
    if (h1) { flushList(); out.push(<h1 key={out.length} className="text-xl font-semibold text-text-primary mt-6 mb-3 pb-2 border-b border-border">{inlineFmt(h1[1])}</h1>); continue }
    if (h2) { flushList(); out.push(<h2 key={out.length} className="text-base font-semibold text-text-primary mt-5 mb-2">{inlineFmt(h2[1])}</h2>); continue }
    if (h3) { flushList(); out.push(<h3 key={out.length} className="text-sm font-semibold text-text-primary mt-4 mb-1.5">{inlineFmt(h3[1])}</h3>); continue }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList()
      out.push(<blockquote key={out.length} className="my-2 pl-4 border-l-2 border-blue-500/40 text-text-secondary text-sm italic">{inlineFmt(line.slice(2))}</blockquote>)
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      flushList(); out.push(<hr key={out.length} className="my-4 border-border" />); continue
    }

    // Unordered list
    if (/^[-*+] /.test(line)) {
      listItems.push(
        <li key={listItems.length} className="flex gap-2 text-sm text-text-secondary leading-relaxed">
          <span className="text-text-muted mt-[5px] shrink-0 text-xs">•</span>
          <span>{inlineFmt(line.slice(2))}</span>
        </li>
      )
      continue
    }

    // Ordered list
    const ol = line.match(/^(\d+)\. (.+)/)
    if (ol) {
      listItems.push(
        <li key={listItems.length} className="flex gap-2 text-sm text-text-secondary leading-relaxed">
          <span className="text-text-muted shrink-0 text-xs tabular-nums font-mono min-w-[1.5rem]">{ol[1]}.</span>
          <span>{inlineFmt(ol[2])}</span>
        </li>
      )
      continue
    }

    // Task list
    const task = line.match(/^- \[(x| )\] (.+)/i)
    if (task) {
      const done = task[1].toLowerCase() === 'x'
      listItems.push(
        <li key={listItems.length} className={clsx('flex gap-2 text-sm leading-relaxed', done ? 'text-text-muted line-through' : 'text-text-secondary')}>
          <span className={clsx('w-3.5 h-3.5 rounded border shrink-0 mt-0.5 flex items-center justify-center', done ? 'bg-green-600 border-green-700' : 'border-border')}>
            {done && <Check size={9} className="text-white" />}
          </span>
          <span>{inlineFmt(task[2])}</span>
        </li>
      )
      continue
    }

    flushList()

    // Empty line
    if (!line.trim()) { out.push(<div key={out.length} className="h-2" />); continue }

    // Paragraph
    out.push(<p key={out.length} className="text-sm text-text-secondary leading-relaxed my-1">{inlineFmt(line)}</p>)
  }

  flushList()
  return out
}

// ─── Notebook color palette ───────────────────────────────────────────────────

const COLORS = [
  { hex: '#6366f1', label: 'Indigo' },
  { hex: '#3b82f6', label: 'Blue'   },
  { hex: '#0ea5e9', label: 'Sky'    },
  { hex: '#10b981', label: 'Emerald'},
  { hex: '#f59e0b', label: 'Amber'  },
  { hex: '#ef4444', label: 'Red'    },
  { hex: '#ec4899', label: 'Pink'   },
  { hex: '#8b5cf6', label: 'Violet' },
  { hex: '#14b8a6', label: 'Teal'   },
  { hex: '#64748b', label: 'Slate'  },
]
const ICONS = ['📓','📔','📒','📕','📗','📘','📙','🗒️','📄','💡','🔬','💻','🎨','📊','🚀','⭐']

// ─── Inline rename input ──────────────────────────────────────────────────────

function InlineInput({ value, onConfirm, onCancel, placeholder = 'Name…' }: {
  value: string; onConfirm: (v: string) => void; onCancel: () => void; placeholder?: string
}) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  return (
    <input
      ref={ref}
      value={v}
      onChange={e => setV(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') onConfirm(v); if (e.key === 'Escape') onCancel() }}
      onBlur={() => onConfirm(v)}
      placeholder={placeholder}
      className="flex-1 bg-transparent text-xs text-text-primary outline-none border-b border-blue-500/60 pb-0.5"
      onClick={e => e.stopPropagation()}
    />
  )
}

// ─── Section row (extracted to avoid hooks-in-loop violation) ────────────────

interface SectionRowProps {
  sec: NoteSection
  isActive: boolean
  pageCount: number
  forceRename: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => void
  onRename: (name: string) => void
  onRenameEnd: () => void
}

function SectionRow({ sec, isActive, pageCount, forceRename, onSelect, onContextMenu, onRename, onRenameEnd }: SectionRowProps) {
  const [renaming, setRenaming] = useState(false)
  const prevForce = useRef(false)

  useEffect(() => {
    if (forceRename && !prevForce.current) setRenaming(true)
    prevForce.current = forceRename
  }, [forceRename])

  return (
    <div className="group relative pl-5">
      <button
        onClick={onSelect}
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={onContextMenu}
        className={clsx('w-full flex items-center gap-2 px-2.5 py-1 rounded text-left transition-all',
          isActive ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:bg-card/60 hover:text-text-secondary')}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: sec.color }} />
        {renaming ? (
          <InlineInput
            value={sec.name}
            onConfirm={v => { onRename(v || sec.name); setRenaming(false); onRenameEnd() }}
            onCancel={() => { setRenaming(false); onRenameEnd() }}
          />
        ) : (
          <span className="text-xs truncate flex-1">{sec.name}</span>
        )}
        <span className="text-xxs opacity-40 tabular-nums">{pageCount}</span>
      </button>
    </div>
  )
}

// ─── New Notebook Modal ───────────────────────────────────────────────────────

function NotebookModal({ onClose, onSave }: {
  onClose: () => void
  onSave: (name: string, color: string, icon: string) => Promise<void>
}) {
  const [name, setName]   = useState('')
  const [color, setColor] = useState(COLORS[0].hex)
  const [icon, setIcon]   = useState('📓')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try { await onSave(name.trim(), color, icon); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 " onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card " onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">New Notebook</h2>
          <button aria-label="Close" onClick={onClose}><X size={16} className="text-text-muted hover:text-text-secondary" /></button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {/* Icon picker */}
          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Icon</label>
            <div className="flex flex-wrap gap-1.5">
              {ICONS.map(ic => (
                <button key={ic} onClick={() => setIcon(ic)}
                  className={clsx('w-8 h-8 rounded text-base hover:bg-card-hover transition-colors flex items-center justify-center',
                    icon === ic ? 'bg-card-hover ring-1 ring-blue-500/40' : '')}>
                  {ic}
                </button>
              ))}
            </div>
          </div>
          {/* Color */}
          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Color</label>
            <div className="flex gap-1.5 flex-wrap">
              {COLORS.map(c => (
                <button key={c.hex} onClick={() => setColor(c.hex)} title={c.label}
                  className={clsx('w-6 h-6 rounded-full transition-all', color === c.hex ? 'ring-2 ring-offset-1 ring-offset-card ring-white/30 scale-110' : 'hover:scale-105')}
                  style={{ backgroundColor: c.hex }} />
              ))}
            </div>
          </div>
          {/* Name */}
          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Name</label>
            <input ref={ref} value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="Notebook name…"
              className="w-full px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-xs text-text-muted hover:text-text-secondary transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving || !name.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}Create
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tag input ────────────────────────────────────────────────────────────────

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [v, setV] = useState('')
  const add = () => {
    const t = v.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t)) onChange([...tags, t])
    setV('')
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tags.map(tag => (
        <span key={tag} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-base border border-border-subtle text-xxs text-text-muted">
          <Tag size={8} />{tag}
          <button onClick={() => onChange(tags.filter(t => t !== tag))} className="ml-0.5 hover:text-red-400 transition-colors"><X size={8} /></button>
        </span>
      ))}
      <input
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } if (e.key === 'Backspace' && !v && tags.length) onChange(tags.slice(0,-1)) }}
        placeholder={tags.length ? '' : 'Add tag…'}
        className="bg-transparent text-xxs text-text-muted placeholder:text-text-muted outline-none w-16 min-w-0"
      />
    </div>
  )
}

// ─── Main Notes view ──────────────────────────────────────────────────────────

type Scope = { type: 'all' } | { type: 'notebook'; id: string } | { type: 'section'; id: string; notebookId: string }

export function Notes() {
  // ── Data state ──
  const [notebooks, setNotebooks] = useState<NoteNotebook[]>([])
  const [sections,  setSections]  = useState<NoteSection[]>([])
  const [pages,     setPages]     = useState<NotePage[]>([])
  const [activePage, setActivePage] = useState<NotePage | null>(null)

  // ── UI state ──
  const [scope, setScope]                 = useState<Scope>({ type: 'all' })
  const [expandedNbs, setExpandedNbs]     = useState<Set<string>>(new Set())
  const [search, setSearch]               = useState('')
  const [previewMode, setPreviewMode]     = useState(false)
  const [saving, setSaving]               = useState(false)
  const [loading, setLoading]             = useState(true)
  const [showNotebookModal, setShowNotebookModal] = useState(false)
  const [editingTitle, setEditingTitle]   = useState(false)
  const [nbContextMenu, setNbContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [secContextMenu, setSecContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingSecId, setRenamingSecId] = useState<string | null>(null)
  const [requestedPageId, setRequestedPageId] = useState<string | null>(() => readStoredValue(NOTES_PAGE_STORAGE_KEY))

  const editorRef = useRef<HTMLTextAreaElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load all data ──
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [nbRes, secRes, pgRes] = await Promise.all([
        notesApi.listNotebooks(),
        notesApi.listSections(),
        notesApi.listPages(),
      ])
      setNotebooks(nbRes.notebooks)
      setSections(secRes.sections)
      setPages(pgRes.pages)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // Expand first notebook by default
  useEffect(() => {
    if (notebooks.length > 0 && expandedNbs.size === 0) {
      setExpandedNbs(new Set([notebooks[0].id]))
    }
  }, [notebooks])

  useEffect(() => {
    if (loading || requestedPageId || activePage || pages.length === 0) return
    void loadPage(pages[0].id)
  }, [activePage, loading, pages, requestedPageId])

  // ── Load single page with content ──
  const loadPage = async (id: string) => {
    try {
      const res = await notesApi.getPage(id)
      setActivePage(res.page)
      setPreviewMode(false)
      setEditingTitle(false)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ pageId?: string }>
      if (custom.detail?.pageId) setRequestedPageId(custom.detail.pageId)
    }
    window.addEventListener(NOTES_PAGE_EVENT, handler as EventListener)
    return () => window.removeEventListener(NOTES_PAGE_EVENT, handler as EventListener)
  }, [])

  useEffect(() => {
    if (!requestedPageId) return
    let cancelled = false

    const openRequestedPage = async () => {
      try {
        const existing = pages.find(entry => entry.id === requestedPageId)
        const resolved = await notesApi.getPage(requestedPageId)
        if (cancelled) return

        const page = resolved.page
        clearStoredValue(NOTES_PAGE_STORAGE_KEY)
        setRequestedPageId(null)
        setSearch('')
        setScope({ type: 'section', id: page.sectionId, notebookId: page.notebookId })
        setExpandedNbs(prev => new Set([...prev, page.notebookId]))
        setPages(prev => {
          const nextPage = existing ? { ...existing, ...page } : page
          const index = prev.findIndex(entry => entry.id === page.id)
          if (index === -1) return [nextPage, ...prev]
          return prev.map(entry => entry.id === page.id ? nextPage : entry)
        })
        setActivePage(page)
        setPreviewMode(false)
        setEditingTitle(false)
      } catch {
        if (!cancelled && !loading) {
          clearStoredValue(NOTES_PAGE_STORAGE_KEY)
          setRequestedPageId(null)
        }
      }
    }

    void openRequestedPage()
    return () => { cancelled = true }
  }, [loading, pages, requestedPageId])

  // ── Filtered page list ──
  const filteredPages = useMemo(() => {
    let list = pages
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.tags.some(t => t.includes(q))
      )
    } else {
      if (scope.type === 'section')  list = list.filter(p => p.sectionId === scope.id)
      if (scope.type === 'notebook') list = list.filter(p => p.notebookId === scope.id)
    }
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
  }, [pages, scope, search])

  // ── Auto-save ──
  const scheduleAutoSave = (field: 'title' | 'content', value: string) => {
    if (!activePage) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        const res = await notesApi.updatePage(activePage.id, { [field]: value })
        setActivePage(res.page)
        setPages(prev => prev.map(p => p.id === activePage.id ? { ...p, [field]: value, updatedAgo: 'just now', wordCount: res.page.wordCount } : p))
      } finally { setSaving(false) }
    }, 1200)
  }

  const handleEditorChange = (value: string) => {
    if (!activePage) return
    setActivePage(prev => prev ? { ...prev, content: value } : null)
    scheduleAutoSave('content', value)
  }

  const handleTitleChange = (value: string) => {
    if (!activePage) return
    setActivePage(prev => prev ? { ...prev, title: value } : null)
    setPages(prev => prev.map(p => p.id === activePage.id ? { ...p, title: value } : p))
    scheduleAutoSave('title', value)
  }

  // ── CRUD: Notebooks ──
  const createNotebook = async (name: string, color: string, icon: string) => {
    const res = await notesApi.createNotebook({ name, color, icon })
    setNotebooks(prev => [...prev, res.notebook])
    setExpandedNbs(prev => new Set([...prev, res.notebook.id]))
  }

  const deleteNotebook = async (id: string) => {
    setNotebooks(prev => prev.filter(n => n.id !== id))
    setSections(prev => prev.filter(s => s.notebookId !== id))
    setPages(prev => prev.filter(p => p.notebookId !== id))
    if (activePage?.notebookId === id) setActivePage(null)
    await notesApi.deleteNotebook(id)
    setNbContextMenu(null)
  }

  // ── CRUD: Sections ──
  const createSection = async (notebookId: string) => {
    const res = await notesApi.createSection({ notebookId, name: 'New Section', color: notebooks.find(n => n.id === notebookId)?.color ?? '#6366f1' })
    setSections(prev => [...prev, res.section])
    setExpandedNbs(prev => new Set([...prev, notebookId]))
    setScope({ type: 'section', id: res.section.id, notebookId })
    setSecContextMenu(null)
  }

  const deleteSection = async (id: string) => {
    const sec = sections.find(s => s.id === id)
    setSections(prev => prev.filter(s => s.id !== id))
    setPages(prev => prev.filter(p => p.sectionId !== id))
    if (activePage?.sectionId === id) setActivePage(null)
    if (sec) setScope({ type: 'notebook', id: sec.notebookId })
    await notesApi.deleteSection(id)
    setSecContextMenu(null)
  }

  const renameSection = async (id: string, name: string) => {
    await notesApi.updateSection(id, { name })
    setSections(prev => prev.map(s => s.id === id ? { ...s, name } : s))
  }

  // ── CRUD: Pages ──
  const createPage = async () => {
    let sectionId  = activePage?.sectionId ?? sections[0]?.id
    let notebookId = activePage?.notebookId ?? sections.find(s => s.id === sectionId)?.notebookId ?? notebooks[0]?.id

    if (scope.type === 'section')  { sectionId = scope.id; notebookId = scope.notebookId }
    if (scope.type === 'notebook') { notebookId = scope.id; sectionId = sections.find(s => s.notebookId === notebookId)?.id ?? sectionId }

    if (!sectionId || !notebookId) return
    const res = await notesApi.createPage({ sectionId, notebookId, title: 'Untitled', content: '', tags: [] })
    setPages(prev => [res.page, ...prev])
    setActivePage(res.page)
    setPreviewMode(false)
    setTimeout(() => { setEditingTitle(true) }, 100)
  }

  const togglePin = async () => {
    if (!activePage) return
    const pinned = !activePage.pinned
    setActivePage(prev => prev ? { ...prev, pinned } : null)
    setPages(prev => prev.map(p => p.id === activePage.id ? { ...p, pinned } : p))
    await notesApi.updatePage(activePage.id, { pinned })
  }

  const updateTags = async (tags: string[]) => {
    if (!activePage) return
    setActivePage(prev => prev ? { ...prev, tags } : null)
    setPages(prev => prev.map(p => p.id === activePage.id ? { ...p, tags } : p))
    await notesApi.updatePage(activePage.id, { tags })
  }

  const deletePage = async (id: string) => {
    setPages(prev => prev.filter(p => p.id !== id))
    if (activePage?.id === id) {
      const next = filteredPages.find(p => p.id !== id)
      setActivePage(null)
      if (next) loadPage(next.id)
    }
    await notesApi.deletePage(id)
  }

  const secColor = (id: string) => sections.find(s => s.id === id)?.color ?? '#6366f1'

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden" onClick={() => { setNbContextMenu(null); setSecContextMenu(null) }}>

      {/* ── LEFT: Notebook tree (220px) ── */}
      <div className="flex flex-col w-[220px] min-w-[220px] border-r border-border bg-surface overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-3.5 pb-2 border-b border-border shrink-0">
          <div className="flex items-center gap-1.5">
            <NotebookPen size={13} className="text-text-muted" />
            <span className="text-xs font-semibold text-text-primary">Notebooks</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => loadAll()} disabled={loading}
              className="p-1 rounded hover:bg-card text-text-muted hover:text-text-secondary transition-colors">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => setShowNotebookModal(true)}
              className="p-1 rounded hover:bg-card text-text-muted hover:text-text-secondary transition-colors" title="New notebook">
              <Plus size={13} />
            </button>
          </div>
        </div>

        {/* "All Notes" item */}
        <div className="px-2 pt-1.5 shrink-0">
          <button
            onClick={() => { setScope({ type: 'all' }); setSearch('') }}
            className={clsx('w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left transition-all',
              scope.type === 'all' && !search ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-card/60')}
          >
            <BookOpen size={13} />
            <span className="text-xs font-medium">All Notes</span>
            <span className="ml-auto text-xxs opacity-50">{pages.length}</span>
          </button>
        </div>

        {/* Notebook tree */}
        <div className="flex-1 overflow-y-auto px-2 py-1.5 flex flex-col gap-0.5">
          {loading ? (
            <div className="flex flex-col gap-1 mt-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-7 rounded bg-base/60 animate-pulse" />)}
            </div>
          ) : notebooks.map(nb => {
            const nbSections = sections.filter(s => s.notebookId === nb.id)
            const expanded   = expandedNbs.has(nb.id)
            const isNbActive = scope.type === 'notebook' && scope.id === nb.id

            return (
              <div key={nb.id}>
                {/* Notebook row */}
                <div className="group relative">
                  <button
                    onClick={() => {
                      setScope({ type: 'notebook', id: nb.id })
                      setExpandedNbs(prev => {
                        const next = new Set(prev)
                        expanded ? next.delete(nb.id) : next.add(nb.id)
                        return next
                      })
                    }}
                    onContextMenu={e => { e.preventDefault(); setNbContextMenu({ id: nb.id, x: e.clientX, y: e.clientY }) }}
                    className={clsx('w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left transition-all',
                      isNbActive ? 'bg-card-hover text-text-primary' : 'text-text-secondary hover:bg-card/60 hover:text-text-primary')}
                  >
                    {expanded ? <ChevronDown size={12} className="shrink-0 text-text-muted" /> : <ChevronRight size={12} className="shrink-0 text-text-muted" />}
                    <span className="text-sm">{nb.icon}</span>
                    <span className="text-xs font-medium truncate flex-1">{nb.name}</span>
                    <span className="text-xxs opacity-40 tabular-nums">{sections.filter(s => s.notebookId === nb.id).length}</span>
                  </button>
                  {/* Add section button */}
                  <button
                    onClick={e => { e.stopPropagation(); createSection(nb.id) }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-card-hover text-text-muted transition-all"
                    title="Add section"
                  >
                    <Plus size={10} />
                  </button>
                </div>

                {/* Sections */}
                {expanded && nbSections.map(sec => (
                  <SectionRow
                    key={sec.id}
                    sec={sec}
                    isActive={scope.type === 'section' && scope.id === sec.id}
                    pageCount={pages.filter(p => p.sectionId === sec.id).length}
                    forceRename={renamingSecId === sec.id}
                    onSelect={() => setScope({ type: 'section', id: sec.id, notebookId: nb.id })}
                    onContextMenu={e => { e.preventDefault(); setSecContextMenu({ id: sec.id, x: e.clientX, y: e.clientY }) }}
                    onRename={name => renameSection(sec.id, name)}
                    onRenameEnd={() => setRenamingSecId(null)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── MIDDLE: Page list (220px) ── */}
      <div className="flex flex-col w-[240px] min-w-[240px] border-r border-border bg-surface/60 overflow-hidden">
        {/* Search */}
        <div className="px-3 pt-3 pb-2 border-b border-border shrink-0 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-border">
            <Search size={11} className="text-text-muted shrink-0" />
            <input
              type="text"
              placeholder="Search all notes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs text-text-primary placeholder-text-muted outline-none"
            />
            {search && <button onClick={() => setSearch('')}><X size={11} className="text-text-muted hover:text-text-secondary" /></button>}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xxs text-text-muted">
              {search ? `${filteredPages.length} result${filteredPages.length !== 1 ? 's' : ''}` : `${filteredPages.length} page${filteredPages.length !== 1 ? 's' : ''}`}
            </span>
            <button
              onClick={createPage}
              className="flex items-center gap-1 px-2 py-1 rounded bg-card hover:bg-card-hover border border-border text-xxs text-text-secondary hover:text-text-primary transition-colors"
            >
              <Plus size={10} />New
            </button>
          </div>
        </div>

        {/* Page list */}
        <div className="flex-1 overflow-y-auto py-1.5 flex flex-col gap-0.5 px-2">
          {loading ? (
            [...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-base/60 animate-pulse" />)
          ) : filteredPages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
              <AlignLeft size={20} className="text-text-muted/40" />
              <p className="text-xs text-text-muted text-center">{search ? 'No results' : 'No pages yet'}</p>
              {!search && (
                <button onClick={createPage}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-xxs text-text-secondary hover:bg-card transition-colors">
                  <Plus size={10} />Create page
                </button>
              )}
            </div>
          ) : filteredPages.map(page => {
            const isActive = activePage?.id === page.id
            return (
              <button
                key={page.id}
                onClick={() => loadPage(page.id)}
                className={clsx(
                  'group relative w-full text-left px-3 py-2.5 rounded-lg transition-all border',
                  isActive ? 'bg-card-hover border-border text-text-primary' : 'bg-transparent border-transparent hover:bg-card/60 text-text-secondary',
                )}
              >
                <div className="flex items-start justify-between gap-1 mb-0.5">
                  <span className={clsx('text-xs font-semibold leading-snug truncate flex-1', isActive ? 'text-text-primary' : 'text-text-secondary')}>
                    {page.pinned && <Pin size={8} className="inline text-amber-400 mr-1 -mt-0.5" />}
                    {page.title || 'Untitled'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xxs text-text-muted">{page.updatedAgo}</span>
                  {page.wordCount > 0 && <span className="text-xxs text-text-muted opacity-60">· {page.wordCount}w</span>}
                </div>
                {page.tags.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {page.tags.slice(0, 3).map(t => (
                      <span key={t} className="px-1 py-0.5 rounded bg-base text-xxs text-text-muted border border-border-subtle">{t}</span>
                    ))}
                  </div>
                )}
                {/* Color stripe for section */}
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r opacity-0 group-hover:opacity-60 transition-opacity"
                  style={{ backgroundColor: secColor(page.sectionId) }} />
              </button>
            )
          })}
        </div>
      </div>

      {/* ── RIGHT: Editor ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-base">
        {!activePage ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-16 h-16 rounded-xl bg-card border border-border flex items-center justify-center text-3xl">📝</div>
            <div>
              <p className="text-sm font-medium text-text-secondary">No page selected</p>
              <p className="text-xs text-text-muted mt-1">Pick a page from the list or create a new one</p>
            </div>
            <button onClick={createPage}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors">
              <Plus size={13} />New Page
            </button>
          </div>
        ) : (
          <>
            {/* Editor toolbar */}
            <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* Breadcrumb */}
                <div className="flex items-center gap-1 text-xxs text-text-muted shrink-0">
                  <span>{notebooks.find(n => n.id === activePage.notebookId)?.icon ?? '📓'}</span>
                  <span className="truncate max-w-[80px]">{notebooks.find(n => n.id === activePage.notebookId)?.name ?? '—'}</span>
                  <ChevronRight size={10} />
                  <span className="truncate max-w-[80px]">{sections.find(s => s.id === activePage.sectionId)?.name ?? '—'}</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {saving && <span className="flex items-center gap-1 text-xxs text-text-muted"><Loader2 size={10} className="animate-spin" />Saving…</span>}
                <span className="text-xxs text-text-muted">{activePage.wordCount ?? 0}w</span>

                <button onClick={togglePin} title={activePage.pinned ? 'Unpin' : 'Pin'}
                  className={clsx('p-1.5 rounded hover:bg-card transition-colors', activePage.pinned ? 'text-amber-400' : 'text-text-muted hover:text-text-secondary')}>
                  {activePage.pinned ? <Pin size={13} /> : <PinOff size={13} />}
                </button>

                <button onClick={() => setPreviewMode(v => !v)}
                  className={clsx('flex items-center gap-1 px-2.5 py-1 rounded border text-xxs font-medium transition-all',
                    previewMode ? 'border-border bg-card-hover text-text-primary' : 'border-border text-text-muted hover:text-text-secondary hover:bg-card')}>
                  {previewMode ? <Edit3 size={11} /> : <Eye size={11} />}
                  {previewMode ? 'Edit' : 'Preview'}
                </button>

                <button onClick={() => { if (activePage && window.confirm('Delete this page?')) deletePage(activePage.id) }}
                  className="p-1.5 rounded hover:bg-red-950/40 text-text-muted hover:text-red-400 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Title */}
            <div className="px-8 pt-6 pb-2 shrink-0" style={{ borderLeft: `3px solid ${secColor(activePage.sectionId)}` }}>
              {editingTitle ? (
                <input
                  autoFocus
                  value={activePage.title}
                  onChange={e => handleTitleChange(e.target.value)}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={e => { if (e.key === 'Enter') { setEditingTitle(false); editorRef.current?.focus() } if (e.key === 'Escape') setEditingTitle(false) }}
                  placeholder="Page title…"
                  className="w-full text-2xl font-semibold text-text-primary bg-transparent outline-none placeholder:text-text-muted"
                />
              ) : (
                <h1
                  onClick={() => setEditingTitle(true)}
                  className="text-2xl font-semibold text-text-primary cursor-text hover:opacity-80 transition-opacity leading-tight"
                >
                  {activePage.title || <span className="text-text-muted font-normal text-xl">Untitled</span>}
                </h1>
              )}
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xxs text-text-muted">Last edited {activePage.updatedAgo}</span>
                <TagInput tags={activePage.tags} onChange={updateTags} />
              </div>
            </div>

            {/* Editor / Preview */}
            <div className="flex-1 overflow-y-auto px-8 py-4">
              {previewMode ? (
                <div className="max-w-3xl prose-sm">
                  {activePage.content?.trim() ? renderMd(activePage.content) : (
                    <p className="text-text-muted text-sm italic">Nothing here yet — switch to Edit mode to start writing.</p>
                  )}
                </div>
              ) : (
                <textarea
                  ref={editorRef}
                  value={activePage.content ?? ''}
                  onChange={e => handleEditorChange(e.target.value)}
                  placeholder="Start writing… (Markdown supported)"
                  className="w-full h-full min-h-[400px] bg-transparent text-sm text-text-primary leading-relaxed outline-none resize-none placeholder:text-text-muted font-mono"
                  spellCheck
                  autoFocus
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Context menus ── */}
      {nbContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setNbContextMenu(null)} />
          <div className="fixed z-50 w-40 rounded-lg border border-border bg-card  overflow-hidden"
            style={{ left: nbContextMenu.x, top: nbContextMenu.y }}>
            <button onClick={() => createSection(nbContextMenu.id)}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:bg-card-hover transition-colors">
              <Plus size={11} />Add Section
            </button>
            <button onClick={() => deleteNotebook(nbContextMenu.id)}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-400 hover:bg-red-950/30 transition-colors">
              <Trash2 size={11} />Delete Notebook
            </button>
          </div>
        </>
      )}

      {secContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSecContextMenu(null)} />
          <div className="fixed z-50 w-44 rounded-lg border border-border bg-card  overflow-hidden"
            style={{ left: secContextMenu.x, top: secContextMenu.y }}>
            <button onClick={() => { setRenamingSecId(secContextMenu.id); setSecContextMenu(null) }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:bg-card-hover transition-colors">
              <Edit3 size={11} />Rename Section
            </button>
            <button onClick={() => deleteSection(secContextMenu.id)}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-400 hover:bg-red-950/30 transition-colors">
              <Trash2 size={11} />Delete Section
            </button>
          </div>
        </>
      )}

      {/* ── Notebook modal ── */}
      {showNotebookModal && (
        <NotebookModal onClose={() => setShowNotebookModal(false)} onSave={createNotebook} />
      )}
    </div>
  )
}
