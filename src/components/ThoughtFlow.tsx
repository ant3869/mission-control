// title: Thought Flow — live agent reasoning pipeline
// path: src/components/ThoughtFlow.tsx
// purpose: Visualize an active session's internal reasoning loop as an animated
//          CI/CD-style pipeline. Subscribes to the gateway live event stream
//          (/api/<source>/stream) and advances through the canonical states:
//          User Prompt → Thinking → Tool Call → Tool Result → Final message.
//          The active node pulses; completed nodes turn solid.

import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  MessageSquare, BrainCircuit, Terminal, FileOutput, Send,
  Radio, WifiOff, Pause, ArrowRight, Zap,
} from 'lucide-react'
import { usePaused } from '../lib/refreshBus'

type Source = 'openclaw' | 'hermes'

// One node per reasoning state. Index order == pipeline order.
const STAGES = [
  { key: 'prompt',  label: 'User Prompt',     icon: <MessageSquare size={15} />, color: '#60a5fa' },
  { key: 'think',   label: 'Thinking',        icon: <BrainCircuit  size={15} />, color: '#a78bfa' },
  { key: 'tool',    label: 'Tool Call',       icon: <Terminal      size={15} />, color: '#fbbf24' },
  { key: 'result',  label: 'Tool Result',     icon: <FileOutput    size={15} />, color: '#2dd4bf' },
  { key: 'final',   label: 'Final Message',   icon: <Send          size={15} />, color: '#34d399' },
] as const

interface LiveEvent {
  seq: number
  ts: string
  event: string
  kind: string
  title: string
  sub: string
  sessionKey?: string
  meta?: { tool?: string; toolInput?: string; channel?: string; direction?: 'in' | 'out' }
}

interface FlowStep {
  seq:   number
  stage: number
  label: string
  detail: string
  ts:    string
}

// Map a live gateway event onto a pipeline stage (or null if not part of the loop).
function stageOf(e: LiveEvent): number | null {
  if (e.kind === 'message' && e.meta?.direction === 'in') return 0
  if (e.event === 'session.thinking' || (e.kind === 'session' && /think/i.test(e.sub))) return 1
  if (e.kind === 'tool') return 2
  if (e.kind === 'message' && e.meta?.direction === 'out') return 4
  return null
}

function fmtClock(ts: string): string {
  const d = new Date(ts)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false })
}

export function ThoughtFlow() {
  const [source, setSource]     = useState<Source>('openclaw')
  const [connected, setConnected] = useState(false)
  const [stage, setStage]       = useState<number>(-1)
  const [steps, setSteps]       = useState<FlowStep[]>([])
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  const [lastAt, setLastAt]     = useState<number>(0)
  const paused = usePaused()
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seen = useRef<Set<number>>(new Set())

  // Idle clock — recompute "live vs idle" without needing new events.
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (paused) { setConnected(false); return }
    // Reset cycle state when switching source.
    setStage(-1); setSteps([]); setSessionKey(null); seen.current = new Set()
    const es = new EventSource(`/api/${source}/stream`)
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = ev => {
      let e: LiveEvent
      try { e = JSON.parse(ev.data) } catch { return }
      if (typeof e?.seq !== 'number' || seen.current.has(e.seq)) return
      seen.current.add(e.seq)
      const s = stageOf(e)
      if (s === null) return

      setLastAt(Date.now())
      if (e.sessionKey) setSessionKey(e.sessionKey)

      // A new user prompt starts a fresh reasoning cycle.
      if (s === 0) { setSteps([]); seen.current = new Set([e.seq]) }

      const detail = e.kind === 'tool'
        ? `${e.meta?.tool ?? e.sub}${e.meta?.toolInput ? `: ${e.meta.toolInput.slice(0, 80)}` : ''}`
        : (e.sub || e.title)

      setStage(s)
      setSteps(prev => [{ seq: e.seq, stage: s, label: STAGES[s].label, detail, ts: e.ts }, ...prev].slice(0, 14))

      // A tool call implies a result is coming — pulse Tool Result shortly after.
      if (resultTimer.current) clearTimeout(resultTimer.current)
      if (s === 2) {
        resultTimer.current = setTimeout(() => {
          setStage(cur => (cur === 2 ? 3 : cur))
          setSteps(prev => [{ seq: e.seq + 0.5, stage: 3, label: STAGES[3].label, detail: 'result returned to model', ts: new Date().toISOString() }, ...prev].slice(0, 14))
        }, 1100)
      }
    }
    return () => { es.close(); if (resultTimer.current) clearTimeout(resultTimer.current) }
  }, [source, paused])

  const idleMs = lastAt ? Date.now() - lastAt : Infinity
  const isActive = connected && idleMs < 20_000 && stage >= 0
  // Highlight the final node as "complete" (not pulsing) once a reply is sent.
  const settled = stage === 4 && idleMs > 1500

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <style>{`
        @keyframes tf-pulse { 0%,100% { box-shadow: 0 0 0 0 var(--tf-c) } 50% { box-shadow: 0 0 0 6px transparent } }
        @keyframes tf-dash  { to { stroke-dashoffset: -12 } }
      `}</style>

      {/* Controls */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <Zap size={15} className="text-amber-400" />
          <h2 className="text-sm font-semibold text-text-primary">Thought Flow</h2>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-card border border-border p-0.5">
          {(['openclaw', 'hermes'] as Source[]).map(s => (
            <button key={s} onClick={() => setSource(s)}
              className={clsx('px-2.5 py-1 rounded text-xxs font-medium capitalize transition-colors',
                source === s ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              {s}
            </button>
          ))}
        </div>
        {sessionKey && (
          <span className="text-xxs text-text-muted font-mono truncate max-w-[240px]">{sessionKey}</span>
        )}
        <span className={clsx('ml-auto flex items-center gap-1 text-xxs font-medium',
          paused ? 'text-amber-400' : connected ? (isActive ? 'text-green-400' : 'text-text-muted') : 'text-red-400')}>
          {paused ? <><Pause size={11} /> paused</>
            : connected ? (isActive ? <><Radio size={11} className="animate-pulse" /> reasoning</> : <><Radio size={11} /> idle</>)
            : <><WifiOff size={11} /> offline</>}
        </span>
      </div>

      {/* Pipeline */}
      <div className="px-6 py-6 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-1 max-w-3xl mx-auto">
          {STAGES.map((st, i) => {
            const active = isActive && i === stage && !(i === 4 && settled)
            const done   = (stage > i) || (i === 4 && settled)
            return (
              <div key={st.key} className="flex items-center flex-1 last:flex-initial">
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  <div
                    className={clsx('flex items-center justify-center w-11 h-11 rounded-xl border transition-all duration-300',
                      active ? 'border-transparent text-white' : done ? 'border-transparent text-white' : 'border-border bg-card text-text-muted')}
                    style={{
                      backgroundColor: active || done ? st.color : undefined,
                      ['--tf-c' as any]: `${st.color}99`,
                      animation: active ? 'tf-pulse 1.2s ease-in-out infinite' : undefined,
                      opacity: done && !active ? 0.92 : 1,
                    }}
                  >
                    {st.icon}
                  </div>
                  <span className={clsx('text-[10px] font-medium text-center whitespace-nowrap',
                    active ? 'text-text-primary' : done ? 'text-text-secondary' : 'text-text-muted')}>
                    {st.label}
                  </span>
                </div>
                {i < STAGES.length - 1 && (
                  <div className="flex-1 h-px mx-1.5 relative -mt-5">
                    <div className="absolute inset-0 bg-border-subtle" />
                    <div
                      className="absolute inset-y-0 left-0 transition-all duration-500"
                      style={{ width: stage > i ? '100%' : '0%', backgroundColor: st.color }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Step log */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {steps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <BrainCircuit size={22} className="text-text-muted mb-2" />
            <p className="text-sm text-text-muted">Waiting for agent activity</p>
            <p className="text-xxs text-text-muted mt-1 max-w-sm">
              When a session runs, its reasoning loop streams here in real time — prompt, thinking, tool calls, results, and the final reply.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 max-w-3xl mx-auto">
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">Reasoning steps</p>
            {steps.map(step => {
              const st = STAGES[step.stage]
              return (
                <div key={`${step.seq}-${step.stage}`} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border-subtle bg-card">
                  <span className="shrink-0" style={{ color: st.color }}>{st.icon}</span>
                  <span className="text-xs font-medium shrink-0" style={{ color: st.color }}>{step.label}</span>
                  <ArrowRight size={11} className="text-text-muted shrink-0" />
                  <span className="text-xs text-text-secondary truncate flex-1">{step.detail}</span>
                  <span className="text-xxs text-text-muted tabular-nums shrink-0">{fmtClock(step.ts)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default ThoughtFlow
