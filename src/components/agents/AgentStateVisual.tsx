import type { AgentState } from '../../types'

// Pure SVG + CSS animation visuals — one per agent state
// All animations are defined in index.css

interface Props {
  state: AgentState
  size?: number
}

export function AgentStateVisual({ state, size = 96 }: Props) {
  const s = size

  switch (state) {
    // ── Thinking: pulsing neural net ──────────────────────────────────────────
    case 'thinking':
      return (
        <svg width={s} height={s} viewBox="0 0 96 96" fill="none">
          {/* connecting lines */}
          {[
            [48, 20, 72, 38], [48, 20, 24, 38], [72, 38, 72, 62],
            [24, 38, 24, 62], [72, 62, 48, 76], [24, 62, 48, 76],
            [48, 20, 48, 48], [72, 38, 24, 62], [24, 38, 72, 62],
          ].map(([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="#a78bfa" strokeWidth="1" strokeDasharray="40"
              style={{ animation: `line-draw 2.4s ease-in-out ${i * 0.18}s infinite` }} />
          ))}
          {/* nodes */}
          {[
            [48, 20, '0s'], [72, 38, '0.4s'], [24, 38, '0.8s'],
            [72, 62, '1.2s'], [24, 62, '1.6s'], [48, 76, '2.0s'], [48, 48, '0.6s'],
          ].map(([cx, cy, delay], i) => (
            <circle key={i} cx={cx as number} cy={cy as number} r="3"
              fill="#a78bfa"
              style={{ animation: `node-pulse 2.4s ease-in-out ${delay} infinite` }} />
          ))}
        </svg>
      )

    // ── Coding: scrolling terminal ────────────────────────────────────────────
    case 'coding':
      return (
        <svg width={s} height={s} viewBox="0 0 96 96" fill="none">
          {/* terminal frame */}
          <rect x="8" y="12" width="80" height="72" rx="4" fill="#0d1117" stroke="#4ade80" strokeWidth="0.75" strokeOpacity="0.4" />
          {/* top bar dots */}
          <circle cx="20" cy="22" r="3" fill="#f87171" fillOpacity="0.7" />
          <circle cx="30" cy="22" r="3" fill="#fbbf24" fillOpacity="0.7" />
          <circle cx="40" cy="22" r="3" fill="#4ade80" fillOpacity="0.7" />
          {/* scrolling code lines */}
          <g style={{ animation: 'code-scroll 3s linear infinite', clipPath: 'inset(30px 0 12px 0)' }}>
            {[
              { y: 36, w: 52, color: '#60a5fa' },
              { y: 44, w: 38, color: '#4ade80' },
              { y: 52, w: 64, color: '#e4e4e8' },
              { y: 60, w: 44, color: '#a78bfa' },
              { y: 68, w: 56, color: '#e4e4e8' },
              { y: 76, w: 32, color: '#4ade80' },
              { y: 84, w: 48, color: '#60a5fa' },
              { y: 92, w: 40, color: '#fbbf24' },
            ].map((l, i) => (
              <rect key={i} x="16" y={l.y} width={l.w} height="4" rx="2"
                fill={l.color} fillOpacity="0.7" />
            ))}
          </g>
          {/* cursor */}
          <rect x="16" y="68" width="6" height="8" rx="1" fill="#4ade80"
            style={{ animation: 'type-cursor 0.9s step-end infinite' }} />
        </svg>
      )

    // ── Writing: document + typing cursor ────────────────────────────────────
    case 'writing':
      return (
        <svg width={s} height={s} viewBox="0 0 96 96" fill="none">
          {/* page */}
          <rect x="18" y="8" width="60" height="80" rx="3" fill="#141417" stroke="#60a5fa" strokeWidth="0.75" strokeOpacity="0.4" />
          {/* text lines */}
          {[
            { y: 22, w: 44, delay: '0s' },
            { y: 30, w: 50, delay: '0.3s' },
            { y: 38, w: 36, delay: '0.6s' },
            { y: 50, w: 48, delay: '0.9s' },
            { y: 58, w: 42, delay: '1.2s' },
          ].map((l, i) => (
            <rect key={i} x="26" y={l.y} width={l.w} height="4" rx="2"
              fill="#60a5fa" fillOpacity="0.5"
              style={{ animation: `line-appear 1.8s ease-out ${l.delay} both` }} />
          ))}
          {/* new line appearing */}
          <rect x="26" y="70" width="28" height="4" rx="2"
            fill="#60a5fa" fillOpacity="0.35"
            style={{ animation: 'line-appear 1.2s ease-out 1.8s infinite' }} />
          {/* cursor */}
          <rect x="56" y="70" width="4" height="8" rx="1" fill="#60a5fa"
            style={{ animation: 'type-cursor 0.8s step-end infinite' }} />
        </svg>
      )

    // ── Searching: radar sweep ────────────────────────────────────────────────
    case 'searching':
      return (
        <svg width={s} height={s} viewBox="0 0 96 96" fill="none">
          {/* scope rings */}
          {[38, 28, 18].map((r, i) => (
            <circle key={i} cx="48" cy="48" r={r} stroke="#2dd4bf"
              strokeWidth="0.75" strokeOpacity={0.2 + i * 0.1} fill="none" />
          ))}
          {/* cross hairs */}
          <line x1="48" y1="10" x2="48" y2="86" stroke="#2dd4bf" strokeWidth="0.5" strokeOpacity="0.2" />
          <line x1="10" y1="48" x2="86" y2="48" stroke="#2dd4bf" strokeWidth="0.5" strokeOpacity="0.2" />
          {/* sweep */}
          <g style={{ transformOrigin: '48px 48px', animation: 'radar-sweep 2.5s linear infinite' }}>
            <path d="M48 48 L48 10 A38 38 0 0 1 78 31 Z"
              fill="url(#sweep-grad)" opacity="0.6" />
            <defs>
              <radialGradient id="sweep-grad" cx="0%" cy="0%" r="100%">
                <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
              </radialGradient>
            </defs>
          </g>
          {/* ping blips */}
          {[
            [68, 32, '0.4s'], [34, 62, '1.1s'], [72, 58, '1.8s'],
          ].map(([cx, cy, delay], i) => (
            <circle key={i} cx={cx as number} cy={cy as number} r="2"
              fill="#2dd4bf"
              style={{ animation: `radar-ping 2.5s ease-out ${delay} infinite` }} />
          ))}
          {/* center dot */}
          <circle cx="48" cy="48" r="3" fill="#2dd4bf" fillOpacity="0.9" />
        </svg>
      )

    // ── Planning: flowchart nodes ─────────────────────────────────────────────
    case 'planning':
      return (
        <svg width={s} height={s} viewBox="0 0 96 96" fill="none">
          {/* connector lines */}
          <line x1="48" y1="28" x2="26" y2="56" stroke="#fbbf24" strokeWidth="1" strokeOpacity="0.35"
            style={{ animation: 'line-draw 2.8s ease-in-out 0.6s infinite' }} />
          <line x1="48" y1="28" x2="70" y2="56" stroke="#fbbf24" strokeWidth="1" strokeOpacity="0.35"
            style={{ animation: 'line-draw 2.8s ease-in-out 0.9s infinite' }} />
          <line x1="48" y1="8" x2="48" y2="20" stroke="#fbbf24" strokeWidth="1" strokeOpacity="0.35"
            style={{ animation: 'line-draw 2.8s ease-in-out 0.1s infinite' }} />
          {/* top node */}
          <rect x="34" y="20" width="28" height="16" rx="3" fill="#1c1500" stroke="#fbbf24" strokeWidth="1"
            style={{ animation: 'plan-node 2.8s ease-in-out 0s infinite' }} />
          <rect x="39" y="25" width="18" height="3" rx="1.5" fill="#fbbf24" fillOpacity="0.7" />
          <rect x="39" y="30" width="12" height="3" rx="1.5" fill="#fbbf24" fillOpacity="0.4" />
          {/* left node */}
          <rect x="12" y="56" width="28" height="16" rx="3" fill="#1c1500" stroke="#fbbf24" strokeWidth="1"
            style={{ animation: 'plan-node 2.8s ease-in-out 0.6s infinite' }} />
          <rect x="17" y="61" width="18" height="3" rx="1.5" fill="#fbbf24" fillOpacity="0.7" />
          <rect x="17" y="66" width="12" height="3" rx="1.5" fill="#fbbf24" fillOpacity="0.4" />
          {/* right node */}
          <rect x="56" y="56" width="28" height="16" rx="3" fill="#1c1500" stroke="#fbbf24" strokeWidth="1"
            style={{ animation: 'plan-node 2.8s ease-in-out 0.9s infinite' }} />
          <rect x="61" y="61" width="18" height="3" rx="1.5" fill="#fbbf24" fillOpacity="0.7" />
          <rect x="61" y="66" width="10" height="3" rx="1.5" fill="#fbbf24" fillOpacity="0.4" />
          {/* diamond decision */}
          <path d="M48 78 L56 86 L48 94 L40 86 Z" fill="#1c1500" stroke="#fbbf24" strokeWidth="1"
            style={{ animation: 'plan-node 2.8s ease-in-out 1.4s infinite' }} />
        </svg>
      )

    // ── Reading: highlight scanner ────────────────────────────────────────────
    case 'reading':
      return (
        <svg width={s} height={s} viewBox="0 0 96 96" fill="none">
          {/* page bg */}
          <rect x="14" y="10" width="68" height="76" rx="3" fill="#0f0f14" stroke="#6366f1" strokeWidth="0.75" strokeOpacity="0.4" />
          {/* text lines */}
          {[20, 28, 36, 44, 52, 60, 68, 76].map((y, i) => (
            <rect key={i} x="22" y={y} width={i % 3 === 2 ? 40 : 56} height="4" rx="2"
              fill="#6366f1" fillOpacity="0.25" />
          ))}
          {/* scanning highlight bar */}
          <rect x="14" width="68" height="10" rx="0" fill="#6366f1" fillOpacity="0.15"
            style={{ position: 'relative', animation: 'highlight-scan 2.8s ease-in-out infinite' }} />
        </svg>
      )

    // ── Sleeping: floating ZZZ ────────────────────────────────────────────────
    case 'sleeping':
      return (
        <svg width={s} height={s} viewBox="0 0 96 96" fill="none">
          {/* dim circle */}
          <circle cx="48" cy="56" r="28" fill="#111116"
            style={{ animation: 'breathe 3s ease-in-out infinite' }} />
          <circle cx="48" cy="56" r="28" stroke="#4a4a58" strokeWidth="1" fill="none" />
          {/* moon */}
          <path d="M48 38 A18 18 0 1 0 66 56 A12 12 0 1 1 48 38 Z"
            fill="#4a4a58" fillOpacity="0.6" />
          {/* ZZZ */}
          {[
            { x: 58, y: 44, size: 10, delay: '0s' },
            { x: 64, y: 32, size: 13, delay: '0.8s' },
            { x: 72, y: 18, size: 16, delay: '1.6s' },
          ].map((z, i) => (
            <text key={i} x={z.x} y={z.y} fontSize={z.size} fill="#6b6b80" fontFamily="monospace" fontWeight="700"
              style={{ animation: `float-zzz 2.4s ease-out ${z.delay} infinite` }}>
              Z
            </text>
          ))}
        </svg>
      )

    // ── Idle: heartbeat line ──────────────────────────────────────────────────
    case 'idle':
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 96 96" fill="none">
          <path
            d="M8 48 H32 L36 36 L40 60 L44 48 H52 L56 40 L60 56 L64 48 H88"
            stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            strokeOpacity="0.5"
            style={{ animation: 'ekg-idle 4s ease-in-out infinite' }}
          />
          <circle cx="48" cy="48" r="3" fill="#4ade80" fillOpacity="0.4"
            style={{ animation: 'node-pulse 4s ease-in-out infinite' }} />
        </svg>
      )

    // ── Error ─────────────────────────────────────────────────────────────────
    case 'error':
      return (
        <svg width={s} height={s} viewBox="0 0 96 96" fill="none">
          <circle cx="48" cy="48" r="34" stroke="#f87171" strokeWidth="1" fill="#1a0808"
            style={{ animation: 'node-pulse 1.4s ease-in-out infinite' }} />
          <line x1="36" y1="36" x2="60" y2="60" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="60" y1="36" x2="36" y2="60" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      )
  }
}
