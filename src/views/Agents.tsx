import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { X, Activity, Cpu, DollarSign, Clock, ChevronRight, RefreshCw, AlertCircle, Terminal, FolderOpen } from 'lucide-react'
import { agents as agentsApi, type LiveAgent, type AgentState } from '../lib/api'
import { AgentStateVisual } from '../components/agents/AgentStateVisual'

// ─── Config ────────────────────────────────────────────────────────────────────

const STATE_CFG: Record<AgentState, { label: string; color: string; dot: string }> = {
  thinking:  { label: 'Thinking',  color: 'text-violet-400', dot: 'bg-violet-400' },
  coding:    { label: 'Coding',    color: 'text-green-400',  dot: 'bg-green-400'  },
  writing:   { label: 'Writing',   color: 'text-blue-400',   dot: 'bg-blue-400'   },
  searching: { label: 'Searching', color: 'text-teal-400',   dot: 'bg-teal-400'   },
  planning:  { label: 'Planning',  color: 'text-amber-400',  dot: 'bg-amber-400'  },
  reading:   { label: 'Reading',   color: 'text-indigo-400', dot: 'bg-indigo-400' },
  sleeping:  { label: 'Sleeping',  color: 'text-slate-400',  dot: 'bg-slate-500'  },
  idle:      { label: 'Idle',      color: 'text-green-500',  dot: 'bg-green-600'  },
  error:     { label: 'Error',     color: 'text-red-400',    dot: 'bg-red-500'    },
}

const GLOW_CLASS: Partial<Record<AgentState, string>> = {
  thinking:  'bg-violet-500',
  coding:    'bg-green-500',
  writing:   'bg-blue-500',
  searching: 'bg-teal-500',
  planning:  'bg-amber-500',
  reading:   'bg-indigo-500',
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000)      return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function shortModel(m: string): string {
  if (m.includes('opus'))   return 'Opus'
  if (m.includes('sonnet')) return 'Sonnet'
  if (m.includes('haiku'))  return 'Haiku'
  return m.split('-').slice(-2).join('-')
}

function shortCwd(cwd: string): string {
  if (!cwd) return ''
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}

// ─── Agent card ────────────────────────────────────────────────────────────────

function AgentCard({ agent, onClick }: { agent: LiveAgent; onClick: () => void }) {
  const s      = STATE_CFG[agent.state]
  const isActive = !['idle', 'sleeping', 'error'].includes(agent.state)
  const isClaw = agent.source === 'openclaw'

  return (
    <div
      onClick={onClick}
      className="group relative flex flex-col bg-card border border-border rounded-xl overflow-hidden cursor-pointer hover:border-border hover:bg-card-hover transition-all duration-150"
    >
      {/* State visual */}
      <div className="flex items-center justify-center h-[100px] bg-base border-b border-border relative overflow-hidden">
        {GLOW_CLASS[agent.state] && (
          <div className={clsx('absolute inset-0 opacity-5', GLOW_CLASS[agent.state])} />
        )}
        <AgentStateVisual state={agent.state} size={88} />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-3 p-4">
        {/* Name + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', s.dot, isActive && 'animate-pulse')} />
              <h3 className="text-sm font-semibold text-text-primary truncate">{agent.name}</h3>
              {isClaw && (
                <span className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-900/40 text-amber-300 text-xxs shrink-0">
                  Claw
                </span>
              )}
            </div>
            <p className="text-xxs text-text-muted truncate">{shortCwd(agent.cwd)}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className={clsx('text-xxs font-semibold', s.color)}>{s.label}</span>
            <ChevronRight size={11} className="text-text-muted group-hover:text-text-secondary transition-colors" />
          </div>
        </div>

        {/* Last task */}
        <div className="px-2.5 py-2 rounded bg-base border border-border-subtle min-h-[44px]">
          {agent.currentTask
            ? <p className="text-xxs text-text-secondary line-clamp-2 leading-relaxed">{agent.currentTask}</p>
            : <p className="text-xxs text-text-muted italic">No recorded task</p>
          }
          {agent.lastActiveAgo && (
            <div className="flex items-center gap-1 mt-1">
              <Clock size={9} className="text-text-muted" />
              <span className="text-xxs text-text-muted">{agent.lastActiveAgo}</span>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border-subtle">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-text-muted">
              <Activity size={9} />
              <span className="text-xxs">Tokens</span>
            </div>
            <span className="text-xs font-semibold text-text-primary tabular-nums">{fmtTokens(agent.totalTokens)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-text-muted">
              <DollarSign size={9} />
              <span className="text-xxs">Cost</span>
            </div>
            <span className="text-xs font-semibold text-text-primary tabular-nums">${agent.cost.toFixed(2)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-text-muted">
              <Cpu size={9} />
              <span className="text-xxs">Sessions</span>
            </div>
            <span className="text-xs font-semibold text-text-primary tabular-nums">{agent.sessionCount}</span>
          </div>
        </div>

        {/* Model */}
        <div className="flex items-center justify-between">
          <span className="px-1.5 py-0.5 rounded bg-base border border-border text-xxs font-mono text-text-muted">
            {shortModel(agent.model)}
          </span>
          {agent.lastTool && (
            <span className="text-xxs text-text-muted flex items-center gap-1">
              <Terminal size={9} />{agent.lastTool}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Detail drawer ─────────────────────────────────────────────────────────────

function AgentDrawer({ agent, onClose }: { agent: LiveAgent; onClose: () => void }) {
  const s = STATE_CFG[agent.state]

  return (
    <div className="flex flex-col h-full w-[360px] min-w-[360px] border-l border-border bg-surface overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <AgentStateVisual state={agent.state} size={32} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-text-primary truncate">{agent.name}</p>
              {agent.source === 'openclaw' && (
                <span className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-900/40 text-amber-300 text-xxs shrink-0">
                  Claw
                </span>
              )}
            </div>
            <p className="text-xxs text-text-muted truncate">{shortCwd(agent.cwd)}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-card text-text-muted hover:text-text-secondary transition-colors">
          <X size={15} />
        </button>
      </div>

      <div className="flex flex-col gap-5 p-5">
        {/* Status row */}
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-base border border-border">
          <div className="flex items-center gap-2">
            <span className={clsx('w-2 h-2 rounded-full', s.dot)} />
            <span className={clsx('text-xs font-semibold', s.color)}>{s.label}</span>
          </div>
          <div className="flex items-center gap-3 text-xxs text-text-muted">
            <span>{agent.lastActiveAgo}</span>
            <span>{agent.sessionCount} sessions</span>
          </div>
        </div>

        {/* Last task */}
        {agent.currentTask && (
          <div>
            <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted mb-2">Last Task</p>
            <div className="px-3 py-2.5 rounded-lg bg-base border border-border">
              <p className="text-xs text-text-secondary leading-relaxed">{agent.currentTask}</p>
            </div>
          </div>
        )}

        {/* Last tool */}
        {agent.lastTool && (
          <div>
            <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted mb-2">Last Tool Used</p>
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-base border border-border">
              <Terminal size={12} className="text-text-muted mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-mono text-accent-blue">{agent.lastTool}</p>
                {agent.lastToolInput && (
                  <p className="text-xxs text-text-muted mt-0.5 font-mono break-all">{agent.lastToolInput}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Usage stats */}
        <div>
          <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted mb-2">Total Usage</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Input',    value: fmtTokens(agent.inputTokens),  icon: <Activity size={11} /> },
              { label: 'Output',   value: fmtTokens(agent.outputTokens), icon: <Activity size={11} /> },
              { label: 'Cost',     value: `$${agent.cost.toFixed(3)}`,   icon: <DollarSign size={11} /> },
            ].map(stat => (
              <div key={stat.label} className="flex flex-col gap-1 px-3 py-2.5 rounded-lg bg-base border border-border">
                <div className="flex items-center gap-1 text-text-muted">{stat.icon}<span className="text-xxs">{stat.label}</span></div>
                <span className="text-sm font-semibold text-text-primary tabular-nums">{stat.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* System prompt */}
        {agent.systemPrompt && (
          <div>
            <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted mb-2">System Prompt</p>
            <div className="px-3 py-2.5 rounded-lg bg-base border border-border">
              <p className="text-xxs text-text-secondary leading-relaxed font-mono line-clamp-6">
                {agent.systemPrompt}
              </p>
            </div>
          </div>
        )}

        {/* CWD */}
        <div>
          <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted mb-2">Working Directory</p>
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-base border border-border">
            <FolderOpen size={12} className="text-text-muted mt-0.5 shrink-0" />
            <p className="text-xxs text-text-secondary font-mono break-all">{agent.cwd || agent.id}</p>
          </div>
        </div>

        {/* Model */}
        <div>
          <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted mb-2">Model</p>
          <div className="px-3 py-2 rounded-lg bg-base border border-border">
            <span className="text-xs font-mono text-text-secondary">{agent.model || 'unknown'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main view ─────────────────────────────────────────────────────────────────

export function Agents() {
  const [agentList,   setAgentList]   = useState<LiveAgent[]>([])
  const [selected,    setSelected]    = useState<LiveAgent | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [fetchedAt,   setFetchedAt]   = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await agentsApi.projects()
      setAgentList(data.agents)
      setFetchedAt(data.fetchedAt)
      if (data.error) setError(data.error)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const activeCount = agentList.filter(a => !['idle', 'sleeping', 'error'].includes(a.state)).length
  const totalCost   = agentList.reduce((s, a) => s + a.cost, 0)
  const totalTokens = agentList.reduce((s, a) => s + a.totalTokens, 0)
  const clawCount   = agentList.filter(a => a.source === 'openclaw').length
  const claudeCount = agentList.length - clawCount

  const fetchedLabel = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
          <div>
            <h1 className="text-base font-semibold text-text-primary">Agents</h1>
            {!loading && (
              <p className="text-xs text-text-muted mt-0.5">
                <span className="text-green-400">{activeCount} active</span>
                &nbsp;·&nbsp;
                <span className="text-text-secondary">{claudeCount} Claude</span>
                &nbsp;·&nbsp;
                <span className="text-amber-400">{clawCount} Claw</span>
                &nbsp;·&nbsp;
                <span className="text-text-secondary">{fmtTokens(totalTokens)} tokens</span>
                &nbsp;·&nbsp;
                <span className="text-text-secondary">${totalCost.toFixed(2)} total</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {fetchedLabel && <span className="text-xxs text-text-muted">as of {fetchedLabel}</span>}
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 mx-6 mt-4 px-4 py-3 rounded-lg border border-amber-900/40 bg-amber-950/20 text-amber-300">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <p className="text-xs leading-snug">{error}</p>
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[260px] rounded-xl bg-card border border-border animate-pulse" />
              ))}
            </div>
          ) : agentList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <Cpu size={20} className="text-text-muted" />
              <p className="text-sm text-text-muted">No Claude projects found</p>
              <p className="text-xs text-text-muted opacity-60">Start a Claude Code session to see it here</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {agentList.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onClick={() => setSelected(selected?.id === agent.id ? null : agent)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Drawer */}
      {selected && <AgentDrawer agent={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
