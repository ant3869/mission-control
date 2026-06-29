import { useState } from 'react'
import { clsx } from 'clsx'
import {
  Brain, CheckCircle2, Edit2, Save, Loader, X, FileText,
} from 'lucide-react'
import { memoryFile as memoryFileApi, type MetricMemoryFile, type ConnectorId } from '../../lib/api'
import { fmtTokens } from './formatters'

const CONTEXT_LIMITS = [
  { label: 'Claude 200K',  limit: 200_000 },
  { label: 'GPT-4 128K',   limit: 128_000 },
  { label: 'Gemini 1M',    limit: 1_000_000 },
]

const _PIE_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#a3e635']

function _polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * Math.PI / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function _donutSlice(cx: number, cy: number, ro: number, ri: number, a0: number, a1: number) {
  if (a1 - a0 >= 359.999) { a1 = a0 + 359.999 }
  const os = _polar(cx, cy, ro, a0), oe = _polar(cx, cy, ro, a1)
  const is_ = _polar(cx, cy, ri, a0), ie = _polar(cx, cy, ri, a1)
  const lg = a1 - a0 > 180 ? 1 : 0
  return [
    `M ${os.x.toFixed(1)} ${os.y.toFixed(1)}`,
    `A ${ro} ${ro} 0 ${lg} 1 ${oe.x.toFixed(1)} ${oe.y.toFixed(1)}`,
    `L ${ie.x.toFixed(1)} ${ie.y.toFixed(1)}`,
    `A ${ri} ${ri} 0 ${lg} 0 ${is_.x.toFixed(1)} ${is_.y.toFixed(1)}`,
    'Z',
  ].join(' ')
}

export function MemoryAnalyticsBoard({ files, source }: { files: MetricMemoryFile[]; source: ConnectorId }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent,  setFileContent]  = useState<string>('')
  const [filePath,     setFilePath]     = useState<string>('')
  const [isEditing,    setIsEditing]    = useState(false)
  const [editBuffer,   setEditBuffer]   = useState('')
  const [loadingFile,  setLoadingFile]  = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [saveError,    setSaveError]    = useState<string | null>(null)

  const fresh = (iso: string | null) => iso ? (Date.now() - new Date(iso).getTime()) < 86_400_000 : false
  const totalBytes  = files.reduce((s, f) => s + (f.missing ? 0 : f.size), 0)
  const totalTokens = Math.round(totalBytes / 4)
  const hasFiles    = files.length > 0

  async function openFile(name: string) {
    if (selectedFile === name && !isEditing) return
    setSelectedFile(name)
    setIsEditing(false)
    setSaveError(null)
    setLoadingFile(true)
    try {
      const r = await memoryFileApi.read(source, name)
      setFileContent(r.content)
      setFilePath(r.path)
    } catch (e: any) {
      setFileContent(`(error loading file: ${e.message})`)
      setFilePath('')
    } finally {
      setLoadingFile(false)
    }
  }

  function startEdit() {
    setEditBuffer(fileContent)
    setIsEditing(true)
    setSaveError(null)
  }

  async function saveEdit() {
    if (!selectedFile) return
    setSaving(true)
    setSaveError(null)
    try {
      await memoryFileApi.write(source, selectedFile, editBuffer)
      setFileContent(editBuffer)
      setIsEditing(false)
    } catch (e: any) {
      setSaveError(e.message ?? 'save failed')
    } finally {
      setSaving(false)
    }
  }

  function cancelEdit() {
    setIsEditing(false)
    setEditBuffer('')
    setSaveError(null)
  }

  if (!hasFiles) return <p className="text-xs text-text-muted">No tracked memory files</p>

  const sorted   = [...files].sort((a, b) => b.size - a.size)
  const maxBytes = sorted[0]?.size ?? 1

  const pieFiles = sorted.slice(0, 8).filter(f => f.size > 0)
  let pieAngle = 0
  const pieSlices = pieFiles.map((f, i) => {
    const start = pieAngle
    const sweep = (f.size / totalBytes) * 360
    pieAngle += sweep
    return { f, color: _PIE_COLORS[i % _PIE_COLORS.length], start, end: pieAngle }
  })

  return (
    <div className="flex flex-col gap-5">

      {/* ══════════════════════ SECTION 1: Memory Analytics ══════════════════════ */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Brain size={16} className="text-accent shrink-0" />
          <span className="text-base font-semibold text-text-primary">Memory Analytics</span>
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-green-950/40 border-green-800/50 text-green-300">
            <CheckCircle2 size={11} /> Healthy
          </span>
          <div className="ml-auto flex items-center gap-3 text-sm text-text-muted">
            <span className="font-medium text-text-secondary">{files.length} file{files.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{(totalBytes / 1024).toFixed(1)} KB total</span>
            <span>·</span>
            <span>≈{fmtTokens(totalTokens)} tokens</span>
          </div>
        </div>

        {/* Context usage cards */}
        <div className="grid grid-cols-3 gap-3">
          {CONTEXT_LIMITS.map(({ label, limit }) => {
            const pct = Math.min(100, (totalTokens / limit) * 100)
            const warn = pct > 80
            return (
              <div key={label} className="flex flex-col gap-2 rounded-lg border border-border bg-surface/50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">{label} context used</span>
                  <span className={clsx('text-xs font-semibold tabular-nums', warn ? 'text-amber-300' : 'text-accent')}>
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-base overflow-hidden">
                  <div
                    className={clsx('h-full rounded-full transition-all', warn ? 'bg-amber-400' : 'bg-accent')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-text-muted tabular-nums">
                  {fmtTokens(totalTokens)} / {fmtTokens(limit)}
                </span>
              </div>
            )
          })}
        </div>

        {/* Bar chart (left) + Donut chart (right) */}
        <div className="flex gap-8 items-start">

          {/* Largest files horizontal bars */}
          <div className="flex-1 flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Largest files</span>
            {sorted.slice(0, 6).map((f, i) => (
              <div key={f.name} className="flex items-center gap-3">
                <span className="text-xs font-mono text-text-secondary w-32 shrink-0 truncate">{f.name}</span>
                <div className="flex-1 h-2.5 rounded-full bg-surface overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.max(2, (f.size / maxBytes) * 100)}%`, backgroundColor: _PIE_COLORS[i % _PIE_COLORS.length] + 'bb' }}
                  />
                </div>
                <span className="text-xs text-text-muted tabular-nums w-14 text-right shrink-0">
                  {f.size >= 1024 ? `${(f.size / 1024).toFixed(1)}K` : `${f.size}B`}
                </span>
              </div>
            ))}
          </div>

          {/* Donut chart + legend */}
          <div className="flex flex-col items-center gap-3 w-48 shrink-0">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider self-start">Distribution</span>
            <svg viewBox="0 0 100 100" className="w-32 h-32">
              {pieSlices.length === 1 ? (
                <circle cx="50" cy="50" r="34" fill="none" stroke={pieSlices[0].color} strokeWidth="18" />
              ) : (
                pieSlices.map((s, i) => (
                  <path key={i} d={_donutSlice(50, 50, 44, 27, s.start, s.end)} fill={s.color} opacity={0.9} />
                ))
              )}
              <text x="50" y="46" textAnchor="middle" style={{ fontSize: 13, fontWeight: 700, fill: 'white' }}>{files.length}</text>
              <text x="50" y="58" textAnchor="middle" style={{ fontSize: 7.5, fill: '#9ca3af' }}>files</text>
            </svg>
            <div className="flex flex-col gap-1.5 w-full">
              {pieSlices.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-xs font-mono text-text-secondary truncate flex-1">{s.f.name}</span>
                  <span className="text-xs text-text-muted tabular-nums">{Math.round((s.f.size / totalBytes) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* ══════════════════════ SECTION 2: File Explorer ══════════════════════════ */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex gap-5 min-h-0">

          {/* File list */}
          <div className="flex flex-col gap-0.5 w-56 shrink-0">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Explorer</span>
            {sorted.map(f => (
              <button
                key={f.name}
                onClick={() => openFile(f.name)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-1.5 rounded text-left transition-colors text-xs w-full',
                  selectedFile === f.name
                    ? 'bg-accent/20 text-accent border border-accent/30'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary border border-transparent',
                  f.missing && 'opacity-40'
                )}
              >
                <FileText size={12} className="shrink-0" />
                <span className={clsx('font-mono truncate flex-1', f.missing && 'line-through')}>{f.name}</span>
                <span className="text-[11px] text-text-muted tabular-nums shrink-0">
                  {f.size >= 1024 ? `${(f.size / 1024).toFixed(1)}K` : `${f.size}B`}
                </span>
                {fresh(f.updatedAt) && <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />}
              </button>
            ))}
          </div>

          {/* Preview / editor */}
          <div className="flex flex-col flex-1 min-w-0 gap-2">
            {selectedFile ? (
              <>
                <div className="flex items-center gap-2 min-h-[28px]">
                  <span className="text-xs font-mono text-text-secondary truncate flex-1">{filePath || selectedFile}</span>
                  {!loadingFile && !isEditing && (
                    <button
                      onClick={startEdit}
                      className="flex items-center gap-1.5 px-2 py-1 rounded border border-border text-xs text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
                    >
                      <Edit2 size={11} /> Edit
                    </button>
                  )}
                  {isEditing && (
                    <>
                      <button
                        onClick={saveEdit}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-2 py-1 rounded border border-green-700/60 text-xs text-green-300 hover:border-green-500 transition-colors disabled:opacity-50"
                      >
                        {saving ? <Loader size={11} className="animate-spin" /> : <Save size={11} />} Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex items-center gap-1.5 px-2 py-1 rounded border border-border text-xs text-text-muted hover:text-text-primary transition-colors"
                      >
                        <X size={11} /> Cancel
                      </button>
                    </>
                  )}
                </div>
                {saveError && <p className="text-xs text-red-400">{saveError}</p>}
                {loadingFile ? (
                  <div className="flex items-center gap-2 text-sm text-text-muted py-8">
                    <Loader size={14} className="animate-spin" /> Loading…
                  </div>
                ) : isEditing ? (
                  <textarea
                    value={editBuffer}
                    onChange={e => setEditBuffer(e.target.value)}
                    className="flex-1 w-full min-h-[220px] rounded border border-border bg-base font-mono text-xs text-text-primary p-3 resize-y focus:outline-none focus:border-accent/50 transition-colors"
                    spellCheck={false}
                  />
                ) : (
                  <pre className="flex-1 overflow-auto rounded border border-border bg-base font-mono text-xs text-text-secondary p-3 max-h-80 whitespace-pre-wrap break-words">
                    {fileContent || <span className="text-text-muted italic">empty file</span>}
                  </pre>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 rounded border border-border border-dashed gap-3">
                <span className="text-5xl">📁</span>
                <span className="text-sm text-text-muted">Select a file to view</span>
              </div>
            )}
          </div>

        </div>
      </div>

    </div>
  )
}
