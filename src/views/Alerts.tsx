import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import {
  BellRing, RefreshCw, AlertCircle, Plus, Trash2, Edit2, Check, X,
  ShieldAlert, AlertTriangle, Info, Activity, ToggleLeft, ToggleRight, CheckCircle,
  BarChart3, ListChecks,
} from 'lucide-react'
import { MiniStat, SegmentBar, HBar, ChartCard } from '../components/charts'

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity  = 'info' | 'warning' | 'critical'
type Condition = 'error_rate' | 'loop_detected' | 'session_stalled' | 'token_spike' | 'no_activity'
type AlertSource = 'all' | 'openclaw' | 'hermes'

interface AlertRule {
  id:            string
  name:          string
  enabled:       boolean
  severity:      Severity
  condition:     Condition
  threshold:     number
  windowMinutes: number
  source:        AlertSource
  createdAt:     string
  updatedAt:     string
}

interface FiredAlert {
  ruleId:    string
  ruleName:  string
  severity:  Severity
  message:   string
  firedAt:   string
  source:    string
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchRules(): Promise<{ rules: AlertRule[] }> {
  const res = await fetch('/api/alerts/rules')
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function fetchActive(): Promise<{ alerts: FiredAlert[] }> {
  const res = await fetch('/api/alerts/active')
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function createRule(body: Partial<AlertRule>): Promise<{ rule: AlertRule }> {
  const res = await fetch('/api/alerts/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function updateRule(id: string, body: Partial<AlertRule>): Promise<{ rule: AlertRule }> {
  const res = await fetch(`/api/alerts/rules/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function deleteRule(id: string): Promise<void> {
  const res = await fetch(`/api/alerts/rules/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAgo(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  return `${Math.round(secs / 3600)}h ago`
}

function severityStyle(s: Severity): string {
  if (s === 'critical') return 'bg-red-500/10 border-red-500/30 text-red-400'
  if (s === 'warning')  return 'bg-amber-500/10 border-amber-500/30 text-amber-400'
  return 'bg-blue-500/10 border-blue-500/30 text-blue-400'
}

function severityIcon(s: Severity) {
  if (s === 'critical') return <ShieldAlert size={16} className="text-red-400 flex-shrink-0" />
  if (s === 'warning')  return <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
  return <Info size={16} className="text-blue-400 flex-shrink-0" />
}

const CONDITION_LABELS: Record<Condition, string> = {
  error_rate:      'Error rate exceeds threshold',
  loop_detected:   'Tool loop detected',
  session_stalled: 'Session stalled',
  token_spike:     'Token spike detected',
  no_activity:     'No activity in window',
}

// ─── New/Edit rule form ───────────────────────────────────────────────────────

const DEFAULT_RULE: Partial<AlertRule> = {
  name: '', condition: 'error_rate', severity: 'warning',
  threshold: 5, windowMinutes: 15, source: 'all', enabled: true,
}

function RuleForm({ initial, onSave, onCancel }: {
  initial?: Partial<AlertRule>
  onSave: (data: Partial<AlertRule>) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<Partial<AlertRule>>({ ...DEFAULT_RULE, ...initial })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  function field(key: keyof AlertRule, value: unknown) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setErr(null)
    try { await onSave(form) }
    catch (e: any) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="bg-bg-secondary border border-white/10 rounded-xl p-5 space-y-4">
      {err && <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">{err}</div>}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="text-xs text-text-muted mb-1 block">Rule name *</label>
          <input required value={form.name ?? ''} onChange={e => field('name', e.target.value)}
            className="w-full bg-bg-primary border border-white/10 rounded px-3 py-2 text-sm text-text-primary" placeholder="e.g. High error rate" />
        </div>
        <div>
          <label className="text-xs text-text-muted mb-1 block">Condition</label>
          <select value={form.condition} onChange={e => field('condition', e.target.value)}
            className="w-full bg-bg-primary border border-white/10 rounded px-3 py-2 text-sm text-text-primary">
            {(Object.entries(CONDITION_LABELS) as [Condition, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-muted mb-1 block">Severity</label>
          <select value={form.severity} onChange={e => field('severity', e.target.value)}
            className="w-full bg-bg-primary border border-white/10 rounded px-3 py-2 text-sm text-text-primary">
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-text-muted mb-1 block">Threshold</label>
          <input type="number" min={1} value={form.threshold} onChange={e => field('threshold', Number(e.target.value))}
            className="w-full bg-bg-primary border border-white/10 rounded px-3 py-2 text-sm text-text-primary" />
        </div>
        <div>
          <label className="text-xs text-text-muted mb-1 block">Window (minutes)</label>
          <input type="number" min={1} value={form.windowMinutes} onChange={e => field('windowMinutes', Number(e.target.value))}
            className="w-full bg-bg-primary border border-white/10 rounded px-3 py-2 text-sm text-text-primary" />
        </div>
        <div>
          <label className="text-xs text-text-muted mb-1 block">Source</label>
          <select value={form.source} onChange={e => field('source', e.target.value)}
            className="w-full bg-bg-primary border border-white/10 rounded px-3 py-2 text-sm text-text-primary">
            <option value="all">All</option>
            <option value="openclaw">OpenClaw</option>
            <option value="hermes">Hermes</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-text-muted">Enabled</label>
          <button type="button" onClick={() => field('enabled', !form.enabled)} className="text-text-muted hover:text-text-primary">
            {form.enabled ? <ToggleRight size={22} className="text-emerald-400" /> : <ToggleLeft size={22} />}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2">
        <button type="submit" disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded transition-colors disabled:opacity-50">
          <Check size={14} /> {saving ? 'Saving…' : 'Save rule'}
        </button>
        <button type="button" onClick={onCancel} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white/5 hover:bg-white/10 text-text-muted rounded transition-colors">
          <X size={14} /> Cancel
        </button>
      </div>
    </form>
  )
}

// ─── Overview (severity summary + rules breakdown) ─────────────────────────────

const SEVERITY_HEX: Record<Severity, string> = {
  critical: '#f87171',
  warning:  '#fbbf24',
  info:     '#60a5fa',
}

function AlertsOverview({ rules, active }: { rules: AlertRule[]; active: FiredAlert[] }) {
  const sev = (s: Severity) => active.filter(a => a.severity === s).length
  const enabledCount = rules.filter(r => r.enabled).length

  const conditionCounts = (Object.keys(CONDITION_LABELS) as Condition[])
    .map(cond => ({ cond, count: rules.filter(r => r.condition === cond).length }))
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count)
  const maxCond = Math.max(...conditionCounts.map(c => c.count), 1)

  return (
    <div className="space-y-4 mb-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Active alerts" value={String(active.length)} sub={active.length ? 'firing now' : 'all clear'} icon={<BellRing size={12} />} accent={active.length ? 'text-red-400' : 'text-emerald-400'} />
        <MiniStat label="Critical" value={String(sev('critical'))} sub="severity" icon={<ShieldAlert size={12} />} accent="text-red-400" />
        <MiniStat label="Warning" value={String(sev('warning'))} sub="severity" icon={<AlertTriangle size={12} />} accent="text-amber-400" />
        <MiniStat label="Rules" value={`${enabledCount}/${rules.length}`} sub="enabled" icon={<ListChecks size={12} />} accent="text-violet-300" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Active by severity" icon={<Activity size={13} className="text-amber-400" />}>
          {active.length > 0 ? (
            <div className="pt-1">
              <SegmentBar
                segments={(['critical', 'warning', 'info'] as Severity[])
                  .map(s => ({ value: sev(s), color: SEVERITY_HEX[s], label: s }))
                  .filter(s => s.value > 0)}
              />
            </div>
          ) : (
            <div className="h-16 flex items-center justify-center gap-2 text-xs text-emerald-400">
              <CheckCircle size={14} /> No active alerts
            </div>
          )}
        </ChartCard>

        <ChartCard title="Rules by condition" icon={<BarChart3 size={13} className="text-amber-400" />}>
          {conditionCounts.length > 0 ? (
            <div className="space-y-2.5 pt-1">
              {conditionCounts.map(({ cond, count }) => (
                <HBar key={cond} label={CONDITION_LABELS[cond]} value={count} max={maxCond} color="#fbbf24" />
              ))}
            </div>
          ) : (
            <div className="h-16 flex items-center justify-center text-xs text-text-muted">No rules configured</div>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function Alerts() {
  const [tab, setTab]                         = useState<'active' | 'rules'>('active')
  const [rules, setRules]                     = useState<AlertRule[]>([])
  const [active, setActive]                   = useState<FiredAlert[]>([])
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState<string | null>(null)
  const [editingId, setEditingId]             = useState<string | null>(null)
  const [showNewForm, setShowNewForm]         = useState(false)
  const pollRef                               = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [rulesR, activeR] = await Promise.all([fetchRules(), fetchActive()])
      setRules(rulesR.rules); setActive(activeR.alerts)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    pollRef.current = setInterval(load, 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [load])

  async function handleCreate(data: Partial<AlertRule>) {
    const r = await createRule(data)
    setRules(rs => [...rs, r.rule])
    setShowNewForm(false)
  }

  async function handleUpdate(id: string, data: Partial<AlertRule>) {
    const r = await updateRule(id, data)
    setRules(rs => rs.map(x => x.id === id ? r.rule : x))
    setEditingId(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this rule?')) return
    await deleteRule(id)
    setRules(rs => rs.filter(r => r.id !== id))
  }

  async function handleToggle(rule: AlertRule) {
    const r = await updateRule(rule.id, { enabled: !rule.enabled })
    setRules(rs => rs.map(x => x.id === rule.id ? r.rule : x))
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <BellRing size={20} className="text-amber-400" />
          <h1 className="text-lg font-semibold text-text-primary">Alerts</h1>
          {active.length > 0 && (
            <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded-full border border-red-500/30">
              {active.length} active
            </span>
          )}
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors">
          <RefreshCw size={12} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 pt-3 flex-shrink-0">
        {(['active', 'rules'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('px-3 py-1.5 text-xs rounded-md transition-colors capitalize',
              tab === t ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-text-muted hover:text-text-primary hover:bg-white/5')}>
            {t === 'active' ? 'Active alerts' : 'Alert rules'}
            {t === 'active' && active.length > 0 && (
              <span className="ml-1.5 bg-red-500/20 text-red-400 text-[10px] px-1.5 rounded-full">{active.length}</span>
            )}
            {t === 'rules' && (
              <span className="ml-1.5 bg-white/5 text-text-muted text-[10px] px-1.5 rounded-full">{rules.length}</span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-6 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-sm text-red-400 flex-shrink-0">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto mt-4">

        {(rules.length > 0 || active.length > 0) && (
          <div className="px-6"><AlertsOverview rules={rules} active={active} /></div>
        )}

        {/* Active alerts */}
        {tab === 'active' && (
          <div className="px-6 pb-6 space-y-3">
            {active.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3 bg-bg-secondary border border-white/10 rounded-xl">
                <CheckCircle size={40} className="opacity-30 text-emerald-400" />
                <p className="text-sm text-emerald-400">All clear</p>
                <p className="text-xs opacity-60">No active alerts at this time</p>
              </div>
            ) : (
              active.map((a, i) => (
                <div key={i} className={clsx('flex items-start gap-3 p-4 rounded-xl border', severityStyle(a.severity))}>
                  {severityIcon(a.severity)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{a.ruleName}</span>
                      {a.source !== 'all' && (
                        <span className="text-[10px] bg-white/5 text-text-muted px-1.5 rounded-full border border-white/10">{a.source}</span>
                      )}
                    </div>
                    <p className="text-xs opacity-80">{a.message}</p>
                    <p className="text-[10px] text-text-muted mt-1">{fmtAgo(a.firedAt)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Rules tab */}
        {tab === 'rules' && (
          <div className="px-6 pb-6 space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => { setShowNewForm(v => !v); setEditingId(null) }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded transition-colors"
              >
                <Plus size={12} /> New rule
              </button>
            </div>

            {showNewForm && (
              <RuleForm onSave={handleCreate} onCancel={() => setShowNewForm(false)} />
            )}

            {rules.length === 0 && !showNewForm ? (
              <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3 bg-bg-secondary border border-white/10 rounded-xl">
                <Activity size={40} className="opacity-30" />
                <p className="text-sm">No alert rules configured</p>
                <p className="text-xs opacity-60">Create a rule to start monitoring agent activity</p>
              </div>
            ) : (
              <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
                {rules.map((rule) => (
                  <div key={rule.id}>
                    {editingId === rule.id ? (
                      <div className="p-4 bg-bg-primary border-b border-white/5 last:border-0">
                        <RuleForm
                          initial={rule}
                          onSave={data => handleUpdate(rule.id, data)}
                          onCancel={() => setEditingId(null)}
                        />
                      </div>
                    ) : (
                      <div className={clsx('flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0', !rule.enabled && 'opacity-50')}>
                        <button onClick={() => handleToggle(rule)} className="text-text-muted hover:text-text-primary">
                          {rule.enabled ? <ToggleRight size={18} className="text-emerald-400" /> : <ToggleLeft size={18} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-text-primary">{rule.name}</span>
                            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full border', severityStyle(rule.severity))}>{rule.severity}</span>
                            {rule.source !== 'all' && (
                              <span className="text-[10px] bg-white/5 text-text-muted px-1.5 rounded-full border border-white/10">{rule.source}</span>
                            )}
                          </div>
                          <p className="text-xs text-text-muted mt-0.5">
                            {CONDITION_LABELS[rule.condition]} · threshold {rule.threshold} · {rule.windowMinutes}m window
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => { setEditingId(rule.id); setShowNewForm(false) }}
                            className="p-1.5 text-text-muted hover:text-text-primary rounded hover:bg-white/5">
                            <Edit2 size={13} />
                          </button>
                          <button onClick={() => handleDelete(rule.id)}
                            className="p-1.5 text-text-muted hover:text-red-400 rounded hover:bg-red-500/5">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
