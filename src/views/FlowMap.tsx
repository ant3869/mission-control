import { useState, useEffect, useCallback, useMemo } from 'react'
import { isRefreshPaused } from '../lib/refreshBus'
import { LiveBadge } from '../components/LiveBadge'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { clsx } from 'clsx'
import {
  Workflow, RefreshCw, AlertCircle, X, ArrowRight,
  Network, GitCommitHorizontal, Activity, Coins,
} from 'lucide-react'
import { FlowGraph, EDGE_COLOR, EDGE_LABEL } from '../components/FlowGraph'
import { MiniStat, fmtNum } from '../components/charts'
import type { FlowGraph as FlowGraphData, FlowNode, FlowEdge, FlowRange, FlowEdgeKind, FlowNodeType } from '../types'

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchGraph(range: FlowRange): Promise<FlowGraphData> {
  const res = await fetch(`/api/flowmap/graph?range=${range}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Legend ─────────────────────────────────────────────────────────────────

const NODE_TYPE_COLOR: Record<FlowNodeType, string> = {
  channel: '#60a5fa', cron: '#fbbf24', agent: '#4ade80', runtime: '#a78bfa',
  tool: '#2dd4bf', memory: '#f472b6', external: '#94a3b8',
}
const NODE_TYPE_LABEL: Record<FlowNodeType, string> = {
  channel: 'Channel', cron: 'Cron', agent: 'Agent', runtime: 'Runtime',
  tool: 'Tools', memory: 'Memory', external: 'External',
}

function Legend() {
  const kinds = Object.keys(EDGE_COLOR) as FlowEdgeKind[]
  const types = Object.keys(NODE_TYPE_COLOR) as FlowNodeType[]
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-6 py-2.5 border-t border-border bg-surface/40 flex-shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">Edges</span>
      {kinds.map(k => (
        <span key={k} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <span className="w-4 h-[3px] rounded-full" style={{ backgroundColor: EDGE_COLOR[k] }} />
          {EDGE_LABEL[k]}
        </span>
      ))}
      <span className="text-[10px] uppercase tracking-wider text-text-muted ml-2">Nodes</span>
      {types.map(t => (
        <span key={t} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_TYPE_COLOR[t] }} />
          {NODE_TYPE_LABEL[t]}
        </span>
      ))}
    </div>
  )
}

// ─── Inspect panel ────────────────────────────────────────────────────────────

function NodeInspect({ node, edges, nodes, onSelectEdge, onClose }: {
  node: FlowNode; edges: FlowEdge[]; nodes: FlowNode[]
  onSelectEdge: (id: string) => void; onClose: () => void
}) {
  const related = edges.filter(e => e.source === node.id || e.target === node.id)
  const label = (id: string) => nodes.find(n => n.id === id)?.label ?? id

  return (
    <InspectShell title={node.label} subtitle={node.type} onClose={onClose}>
      <Section title="Metrics">
        {node.metrics.messages != null    && <KV k="Messages" v={fmtNum(node.metrics.messages)} />}
        {node.metrics.invocations != null && <KV k="Invocations" v={fmtNum(node.metrics.invocations)} />}
        {node.metrics.tokens != null      && <KV k="Tokens" v={fmtNum(node.metrics.tokens)} />}
        {node.metrics.sessions != null    && <KV k="Sessions" v={fmtNum(node.metrics.sessions)} />}
        {node.meta && Object.entries(node.meta).map(([k, v]) => <KV key={k} k={k} v={String(v)} />)}
      </Section>
      <Section title={`Connected edges (${related.length})`}>
        {related.length === 0 && <p className="text-xs text-text-muted">No traffic in this range.</p>}
        {related.map(e => {
          const other = e.source === node.id ? e.target : e.source
          const dir   = e.source === node.id ? '→' : '←'
          return (
            <button
              key={e.id}
              onClick={() => onSelectEdge(e.id)}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-border hover:bg-card-hover text-left transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: EDGE_COLOR[e.kind] }} />
                <span className="text-xs text-text-primary truncate">{dir} {label(other)}</span>
              </span>
              <span className="text-[11px] text-text-muted tabular-nums flex-shrink-0">{fmtNum(e.volume)}</span>
            </button>
          )
        })}
      </Section>
    </InspectShell>
  )
}

function EdgeInspect({ edge, nodes, onClose }: {
  edge: FlowEdge; nodes: FlowNode[]; onClose: () => void
}) {
  const label = (id: string) => nodes.find(n => n.id === id)?.label ?? id
  return (
    <InspectShell
      title={`${label(edge.source)} → ${label(edge.target)}`}
      subtitle={EDGE_LABEL[edge.kind]}
      subtitleColor={EDGE_COLOR[edge.kind]}
      onClose={onClose}
    >
      <Section title="Metrics">
        <KV k="Volume" v={fmtNum(edge.volume)} />
        {edge.metrics.tokens != null      && <KV k="Tokens" v={fmtNum(edge.metrics.tokens)} />}
        {edge.metrics.messages != null    && <KV k="Messages" v={fmtNum(edge.metrics.messages)} />}
        {edge.metrics.invocations != null && <KV k="Invocations" v={fmtNum(edge.metrics.invocations)} />}
        {edge.metrics.handoffs != null    && <KV k="Handoffs" v={fmtNum(edge.metrics.handoffs)} />}
      </Section>
      <Section title={`Example events (${edge.samples?.length ?? 0})`}>
        {(!edge.samples || edge.samples.length === 0) && (
          <p className="text-xs text-text-muted">No sample events captured for this edge.</p>
        )}
        {edge.samples?.map((s, i) => (
          <div key={i} className="px-2.5 py-2 rounded-lg border border-border bg-card">
            <p className="text-xs text-text-primary break-words">{s.label}</p>
            <div className="flex items-center gap-2 mt-1">
              {s.detail && <span className="text-[10px] text-text-muted">{s.detail}</span>}
              {s.ts && <span className="text-[10px] text-text-muted ml-auto">{new Date(s.ts).toLocaleString()}</span>}
            </div>
          </div>
        ))}
      </Section>
    </InspectShell>
  )
}

function InspectShell({ title, subtitle, subtitleColor, onClose, children }: {
  title: string; subtitle: string; subtitleColor?: string
  onClose: () => void; children: React.ReactNode
}) {
  useEscapeKey(onClose)
  return (
    <div className="w-[320px] flex-shrink-0 flex flex-col border-l border-border bg-bg-primary min-h-0">
      <div className="flex items-start justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary break-words">{title}</p>
          <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: subtitleColor ?? '#7a7a8a' }}>{subtitle}</p>
        </div>
        <button onClick={onClose} className="ml-2 p-1 rounded hover:bg-card-hover text-text-muted hover:text-text-primary flex-shrink-0">
          <X size={15} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{title}</p>
      {children}
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs py-0.5">
      <span className="text-text-muted capitalize">{k}</span>
      <span className="text-text-primary tabular-nums">{v}</span>
    </div>
  )
}

// ─── Main view ──────────────────────────────────────────────────────────────

const RANGES: { id: FlowRange; label: string }[] = [
  { id: '1h', label: '1h' }, { id: '24h', label: '24h' }, { id: '7d', label: '7d' }, { id: 'all', label: 'All' },
]

export function FlowMap() {
  const [range, setRange]               = useState<FlowRange>('24h')
  const [data, setData]                 = useState<FlowGraphData | null>(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [selNode, setSelNode]           = useState<string | null>(null)
  const [selEdge, setSelEdge]           = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try { setData(await fetchGraph(range)) }
    catch (e: any) { setError(e?.message ?? 'Failed to load flow map') }
    finally { if (!silent) setLoading(false) }
  }, [range])

  useEffect(() => { load() }, [load])

  // Keep the traffic graph live: silent auto-refresh every 20s (honours global Pause).
  useEffect(() => {
    const t = setInterval(() => { if (!isRefreshPaused()) load(true) }, 20_000)
    return () => clearInterval(t)
  }, [load])

  const selectedNode = useMemo(() => data?.nodes.find(n => n.id === selNode) ?? null, [data, selNode])
  const selectedEdge = useMemo(() => data?.edges.find(e => e.id === selEdge) ?? null, [data, selEdge])

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <Workflow size={20} className="text-accent-teal" />
          <h1 className="text-lg font-semibold text-text-primary">Flow Map</h1>
          {data && (
            <span className={clsx(
              'text-[10px] px-2 py-0.5 rounded-full border',
              data.live
                ? 'bg-accent-green/10 text-accent-green border-accent-green/20'
                : 'bg-accent-amber/10 text-accent-amber border-accent-amber/20',
            )}>
              {data.live ? 'live telemetry' : 'sample data'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge className="mr-1" />
          <div className="flex items-center rounded border border-border overflow-hidden">
            {RANGES.map(r => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={clsx(
                  'px-2.5 py-1.5 text-xs transition-colors',
                  range === r.id ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:bg-card',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={() => load()} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-card hover:bg-card-hover border border-border rounded transition-colors">
            <RefreshCw size={12} className={clsx(loading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-6 py-3 border-b border-border flex-shrink-0">
          <MiniStat label="Nodes" value={String(data.stats.nodeCount)} icon={<Network size={12} />} />
          <MiniStat label="Edges" value={String(data.stats.edgeCount)} icon={<GitCommitHorizontal size={12} />} />
          <MiniStat label="Messages" value={fmtNum(data.stats.totalMessages)} accent="text-accent-blue" icon={<ArrowRight size={12} />} />
          <MiniStat label="Invocations" value={fmtNum(data.stats.totalInvocations)} accent="text-accent-amber" icon={<Activity size={12} />} />
          <MiniStat label="Token flow" value={fmtNum(data.stats.totalTokens)} accent="text-accent-purple" icon={<Coins size={12} />} />
        </div>
      )}

      {error && (
        <div className="mx-6 mt-3 p-3 rounded-lg bg-accent-red/10 border border-accent-red/20 flex items-center gap-2 text-sm text-accent-red flex-shrink-0">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Graph + inspect */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 min-h-0 p-4">
          {data && data.nodes.length > 0 ? (
            <div className="w-full h-full rounded-xl border border-border bg-bg-secondary overflow-hidden">
              <FlowGraph
                nodes={data.nodes}
                edges={data.edges}
                selectedNodeId={selNode}
                selectedEdgeId={selEdge}
                onSelectNode={setSelNode}
                onSelectEdge={setSelEdge}
              />
            </div>
          ) : (
            <div className="w-full h-full rounded-xl border border-border bg-bg-secondary flex flex-col items-center justify-center text-text-muted gap-3">
              <Workflow size={40} className="opacity-30" />
              <p className="text-sm">{loading ? 'Loading flow map…' : 'No traffic to display'}</p>
            </div>
          )}
        </div>

        {selectedNode && (
          <NodeInspect
            node={selectedNode}
            edges={data!.edges}
            nodes={data!.nodes}
            onSelectEdge={(id) => { setSelEdge(id); setSelNode(null) }}
            onClose={() => setSelNode(null)}
          />
        )}
        {!selectedNode && selectedEdge && (
          <EdgeInspect edge={selectedEdge} nodes={data!.nodes} onClose={() => setSelEdge(null)} />
        )}
      </div>

      <Legend />
    </div>
  )
}
