// title: Flow graph (node-link traffic map)
// path: src/components/FlowGraph.tsx
// purpose: Dependency-free, deterministic node-link graph rendered with SVG edges
//          + foreignObject nodes. Layered left→right layout (triggers → agents →
//          capabilities → external). Edge thickness scales with traffic volume,
//          node color encodes type. Used by the Flow Map view.

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Hash, Clock, Bot, Cpu, Wrench, Brain, Globe } from 'lucide-react'
import type { FlowNode, FlowEdge, FlowNodeType, FlowEdgeKind } from '../types'
import { fmtNum } from './charts'

// ─── Type → visual encoding ──────────────────────────────────────────────────

const NODE_COLOR: Record<FlowNodeType, string> = {
  channel:  '#60a5fa',
  cron:     '#fbbf24',
  agent:    '#4ade80',
  runtime:  '#a78bfa',
  tool:     '#2dd4bf',
  memory:   '#f472b6',
  external: '#94a3b8',
}

export const EDGE_COLOR: Record<FlowEdgeKind, string> = {
  message:    '#60a5fa',
  invocation: '#fbbf24',
  token:      '#a78bfa',
  handoff:    '#f472b6',
}

export const EDGE_LABEL: Record<FlowEdgeKind, string> = {
  message:    'Messages',
  invocation: 'Invocations',
  token:      'Token flow',
  handoff:    'Task handoffs',
}

const NODE_ICON: Record<FlowNodeType, React.ReactNode> = {
  channel:  <Hash size={13} />,
  cron:     <Clock size={13} />,
  agent:    <Bot size={13} />,
  runtime:  <Cpu size={13} />,
  tool:     <Wrench size={13} />,
  memory:   <Brain size={13} />,
  external: <Globe size={13} />,
}

// Left→right column per type: triggers → agents → capabilities → external.
const COLUMN: Record<FlowNodeType, number> = {
  channel: 0, cron: 0,
  agent: 1,
  runtime: 2, tool: 2, memory: 2,
  external: 3,
}
const COLUMNS = 4

const NW = 158
const NH = 56
const PAD_X = NW / 2 + 24
const PAD_Y = NH / 2 + 24

// ─── Layout ──────────────────────────────────────────────────────────────────

interface Placed { node: FlowNode; x: number; y: number }

function layout(nodes: FlowNode[], w: number, h: number): Map<string, Placed> {
  const innerW = Math.max(w - PAD_X * 2, 1)
  const innerH = Math.max(h - PAD_Y * 2, 1)
  const colX = (c: number) => PAD_X + (innerW * c) / (COLUMNS - 1)

  const byCol = new Map<number, FlowNode[]>()
  for (const n of nodes) {
    const c = COLUMN[n.type]
    if (!byCol.has(c)) byCol.set(c, [])
    byCol.get(c)!.push(n)
  }

  const placed = new Map<string, Placed>()
  for (const [c, list] of byCol) {
    const n = list.length
    list.forEach((node, i) => {
      const y = PAD_Y + innerH * ((i + 0.5) / n)
      placed.set(node.id, { node, x: colX(c), y })
    })
  }
  return placed
}

function nodeMetric(n: FlowNode): string {
  const m = n.metrics
  if (m.tokens)      return `${fmtNum(m.tokens)} tok`
  if (m.messages)    return `${fmtNum(m.messages)} msg`
  if (m.invocations) return `${fmtNum(m.invocations)} calls`
  return '—'
}

// ─── Component ───────────────────────────────────────────────────────────────

interface FlowGraphProps {
  nodes: FlowNode[]
  edges: FlowEdge[]
  selectedNodeId: string | null
  selectedEdgeId: string | null
  onSelectNode: (id: string | null) => void
  onSelectEdge: (id: string | null) => void
}

export function FlowGraph({
  nodes, edges, selectedNodeId, selectedEdgeId, onSelectNode, onSelectEdge,
}: FlowGraphProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 960, h: 540 })
  const [hover, setHover] = useState<{ x: number; y: number; node?: FlowNode; edge?: FlowEdge } | null>(null)

  useLayoutEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: Math.max(el.clientHeight, 420) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const placed = useMemo(() => layout(nodes, size.w, size.h), [nodes, size.w, size.h])
  const maxVol = useMemo(() => Math.max(...edges.map(e => e.volume), 1), [edges])

  // What's emphasized given current selection.
  const focusNode = selectedNodeId
  const focusEdge = edges.find(e => e.id === selectedEdgeId) ?? null
  const activeEdgeIds = new Set<string>()
  const activeNodeIds = new Set<string>()
  if (focusNode) {
    for (const e of edges) {
      if (e.source === focusNode || e.target === focusNode) {
        activeEdgeIds.add(e.id); activeNodeIds.add(e.source); activeNodeIds.add(e.target)
      }
    }
  } else if (focusEdge) {
    activeEdgeIds.add(focusEdge.id)
    activeNodeIds.add(focusEdge.source); activeNodeIds.add(focusEdge.target)
  }
  const hasFocus = activeEdgeIds.size > 0

  const edgeWidth = (v: number) => 1.5 + Math.sqrt(v / maxVol) * 12

  const onMove = (e: React.MouseEvent) => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setHover(prev => prev ? { ...prev, x: e.clientX - r.left, y: e.clientY - r.top } : prev)
  }

  return (
    <div
      ref={ref}
      className="relative w-full h-full"
      onMouseMove={onMove}
      onClick={() => { onSelectNode(null); onSelectEdge(null) }}
    >
      <svg width={size.w} height={size.h} className="block">
        {/* Edges */}
        <g>
          {edges.map(e => {
            const s = placed.get(e.source); const t = placed.get(e.target)
            if (!s || !t) return null
            const x1 = s.x + NW / 2, y1 = s.y
            const x2 = t.x - NW / 2, y2 = t.y
            const dx = Math.max((x2 - x1) * 0.5, 30)
            const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
            const active = activeEdgeIds.has(e.id)
            const opacity = !hasFocus ? 0.55 : active ? 0.95 : 0.06
            return (
              <path
                key={e.id}
                d={d}
                fill="none"
                stroke={EDGE_COLOR[e.kind]}
                strokeWidth={edgeWidth(e.volume)}
                strokeLinecap="round"
                opacity={opacity}
                style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                onMouseEnter={() => setHover({ x: 0, y: 0, edge: e })}
                onMouseLeave={() => setHover(null)}
                onClick={ev => { ev.stopPropagation(); onSelectEdge(e.id); onSelectNode(null) }}
              />
            )
          })}
        </g>

        {/* Nodes */}
        <g>
          {nodes.map(n => {
            const p = placed.get(n.id)
            if (!p) return null
            const color = NODE_COLOR[n.type]
            const selected = selectedNodeId === n.id
            const dim = hasFocus && !activeNodeIds.has(n.id) && !selected
            return (
              <foreignObject
                key={n.id}
                x={p.x - NW / 2}
                y={p.y - NH / 2}
                width={NW}
                height={NH}
                style={{ overflow: 'visible' }}
              >
                <div
                  onMouseEnter={() => setHover({ x: 0, y: 0, node: n })}
                  onMouseLeave={() => setHover(null)}
                  onClick={ev => { ev.stopPropagation(); onSelectNode(selected ? null : n.id); onSelectEdge(null) }}
                  className={clsx(
                    'flex items-center gap-2 h-full px-2.5 rounded-lg border bg-card cursor-pointer select-none',
                    'transition-all duration-150',
                    selected ? 'ring-2' : 'hover:bg-card-hover',
                  )}
                  style={{
                    borderColor: selected ? color : 'rgba(255,255,255,0.10)',
                    boxShadow: selected ? `0 0 0 1px ${color}` : undefined,
                    opacity: dim ? 0.25 : 1,
                  }}
                >
                  <span
                    className="flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0"
                    style={{ backgroundColor: `${color}22`, color }}
                  >
                    {NODE_ICON[n.type]}
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-text-primary truncate leading-tight">{n.label}</span>
                    <span className="text-[10px] text-text-muted tabular-nums leading-tight">{nodeMetric(n)}</span>
                  </div>
                </div>
              </foreignObject>
            )
          })}
        </g>
      </svg>

      {/* Hover tooltip */}
      {hover && (hover.node || hover.edge) && (
        <Tooltip x={hover.x} y={hover.y} node={hover.node} edge={hover.edge} placed={placed} nodes={nodes} />
      )}
    </div>
  )
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function Tooltip({ x, y, node, edge, placed, nodes }: {
  x: number; y: number
  node?: FlowNode; edge?: FlowEdge
  placed: Map<string, Placed>; nodes: FlowNode[]
}) {
  // Edges hover doesn't get mouse coords (no per-path mousemove), so anchor edge
  // tooltips at the edge midpoint; node tooltips follow the cursor.
  let px = x, py = y
  if (edge) {
    const s = placed.get(edge.source); const t = placed.get(edge.target)
    if (s && t) { px = (s.x + t.x) / 2; py = (s.y + t.y) / 2 }
  }
  const label = (id: string) => nodes.find(n => n.id === id)?.label ?? id

  return (
    <div
      className="pointer-events-none absolute z-20 min-w-[150px] max-w-[240px] rounded-lg border border-border bg-surface/95  px-3 py-2 "
      style={{ left: Math.min(px + 12, 9999), top: py + 12 }}
    >
      {node && (
        <>
          <p className="text-xs font-semibold text-text-primary">{node.label}</p>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">{node.type}</p>
          <div className="space-y-0.5">
            {node.metrics.messages != null    && <Row k="Messages" v={fmtNum(node.metrics.messages)} />}
            {node.metrics.invocations != null && <Row k="Invocations" v={fmtNum(node.metrics.invocations)} />}
            {node.metrics.tokens != null      && <Row k="Tokens" v={fmtNum(node.metrics.tokens)} />}
            {node.metrics.sessions != null    && <Row k="Sessions" v={fmtNum(node.metrics.sessions)} />}
            {node.meta && Object.entries(node.meta).map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
          </div>
        </>
      )}
      {edge && (
        <>
          <p className="text-xs font-semibold text-text-primary">{label(edge.source)} → {label(edge.target)}</p>
          <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: EDGE_COLOR[edge.kind] }}>{EDGE_LABEL[edge.kind]}</p>
          <div className="space-y-0.5">
            <Row k="Volume" v={fmtNum(edge.volume)} />
            {edge.metrics.tokens != null      && <Row k="Tokens" v={fmtNum(edge.metrics.tokens)} />}
            {edge.metrics.messages != null    && <Row k="Messages" v={fmtNum(edge.metrics.messages)} />}
            {edge.metrics.invocations != null && <Row k="Invocations" v={fmtNum(edge.metrics.invocations)} />}
            {edge.metrics.handoffs != null    && <Row k="Handoffs" v={fmtNum(edge.metrics.handoffs)} />}
          </div>
          <p className="text-[10px] text-text-muted mt-1.5">Click to inspect events</p>
        </>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-text-muted capitalize">{k}</span>
      <span className="text-text-primary tabular-nums">{v}</span>
    </div>
  )
}
