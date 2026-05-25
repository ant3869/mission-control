// title: Shared chart primitives
// path: src/components/charts.tsx
// purpose: Dependency-free, theme-consistent chart building blocks shared across
//          the Flow / Brain / Alerts / Security observability views. Hand-rolled
//          SVG + div bars to match the rest of the app (no charting library).

import { clsx } from 'clsx'

// ─── Number formatting ──────────────────────────────────────────────────────────

export function fmtNum(n: number): string {
  if (!isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

// ─── Stat card ──────────────────────────────────────────────────────────────────

export function MiniStat({ label, value, sub, accent = 'text-text-primary', icon }: {
  label: string
  value: string
  sub?: string
  accent?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 bg-bg-secondary rounded-xl border border-white/10">
      <div className="flex items-center gap-1.5 text-text-muted">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className={clsx('text-2xl font-bold tabular-nums leading-none', accent)}>{value}</p>
      {sub && <p className="text-[10px] text-text-muted truncate">{sub}</p>}
    </div>
  )
}

// ─── Vertical bar histogram ───────────────────────────────────────────────────────

export interface Bar {
  value: number
  color?: string
  label?: string
}

export function Histogram({ bars, height = 56, gap = 'gap-px', rounded = true }: {
  bars: Bar[]
  height?: number
  gap?: string
  rounded?: boolean
}) {
  const max = Math.max(...bars.map(b => b.value), 1)
  return (
    <div className={clsx('flex items-end w-full', gap)} style={{ height }}>
      {bars.map((b, i) => {
        const pct = (b.value / max) * 100
        return (
          <div
            key={i}
            title={b.label ?? `${b.value}`}
            className={clsx('flex-1 min-w-0 transition-all hover:opacity-100', rounded && 'rounded-t-sm')}
            style={{
              height: `${b.value > 0 ? Math.max(pct, 3) : 0}%`,
              backgroundColor: b.color ?? '#a78bfa',
              opacity: b.value > 0 ? 0.85 : 0.15,
              minHeight: b.value > 0 ? 2 : 0,
            }}
          />
        )
      })}
    </div>
  )
}

// ─── Horizontal labeled bar row ──────────────────────────────────────────────────

export function HBar({ label, value, max, color, suffix = '' }: {
  label: React.ReactNode
  value: number
  max: number
  color: string
  suffix?: string
}) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-muted truncate w-28 flex-shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, value > 0 ? 4 : 0)}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-text-primary tabular-nums w-14 text-right flex-shrink-0">{fmtNum(value)}{suffix}</span>
    </div>
  )
}

// ─── Stacked segment bar (proportional) ──────────────────────────────────────────

export interface Segment {
  value: number
  color: string
  label: string
}

export function SegmentBar({ segments, showLegend = true, height = 10 }: {
  segments: Segment[]
  showLegend?: boolean
  height?: number
}) {
  const total = segments.reduce((n, s) => n + s.value, 0) || 1
  return (
    <div className="space-y-2.5">
      <div className="flex w-full rounded-full overflow-hidden bg-white/5" style={{ height }}>
        {segments.map((s, i) => (
          <div
            key={i}
            title={`${s.label}: ${s.value}`}
            style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      {showLegend && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {segments.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-text-muted">{s.label}</span>
              <span className="text-xs text-text-primary tabular-nums">{fmtNum(s.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── SVG donut ────────────────────────────────────────────────────────────────────

export function Donut({ segments, size = 92, thickness = 12, centerTop, centerBottom }: {
  segments: Segment[]
  size?: number
  thickness?: number
  centerTop?: string
  centerBottom?: string
}) {
  const total  = segments.reduce((n, s) => n + s.value, 0)
  const radius = (size - thickness) / 2
  const circ   = 2 * Math.PI * radius
  let offset   = 0

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={thickness} />
        {total > 0 && segments.map((s, i) => {
          const len = (s.value / total) * circ
          const dash = `${len} ${circ - len}`
          const el = (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={radius}
              fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={dash} strokeDashoffset={-offset}
              strokeLinecap="butt"
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          )
          offset += len
          return el
        })}
      </svg>
      {(centerTop || centerBottom) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {centerTop && <span className="text-base font-bold text-text-primary leading-none tabular-nums">{centerTop}</span>}
          {centerBottom && <span className="text-[10px] text-text-muted mt-0.5">{centerBottom}</span>}
        </div>
      )}
    </div>
  )
}

// ─── Semicircular gauge ──────────────────────────────────────────────────────────

export function Gauge({ value, label, size = 150, color }: {
  value: number          // 0..1
  label?: string
  size?: number
  color?: string
}) {
  const v        = Math.max(0, Math.min(1, value))
  const stroke   = 13
  const r        = (size - stroke) / 2
  const cy       = size / 2
  const circ     = Math.PI * r            // semicircle length
  const dash     = `${v * circ} ${circ}`
  const auto     = v >= 0.8 ? '#4ade80' : v >= 0.5 ? '#fbbf24' : '#f87171'
  const stroke2  = color ?? auto
  const height   = size / 2 + 8

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`}>
        {/* track */}
        <path
          d={`M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${cy}`}
          fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} strokeLinecap="round"
        />
        {/* value */}
        <path
          d={`M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${cy}`}
          fill="none" stroke={stroke2} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={dash}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="-mt-7 flex flex-col items-center">
        <span className="text-3xl font-bold tabular-nums" style={{ color: stroke2 }}>{Math.round(v * 100)}</span>
        {label && <span className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">{label}</span>}
      </div>
    </div>
  )
}

// ─── Scatter plot ──────────────────────────────────────────────────────────────────
// Dependency-free SVG scatter. Linear axes with a handful of gridlines + ticks.
// Each point carries its own color/radius/tooltip. Hover lifts opacity + shows title.

export interface ScatterPoint {
  x:       number
  y:       number
  r?:      number
  color?:  string
  label?:  string
}

export function Scatter({
  points, height = 240, xLabel, yLabel,
  xFormat = (n) => String(Math.round(n)),
  yFormat = (n) => String(Math.round(n)),
}: {
  points:   ScatterPoint[]
  height?:  number
  xLabel?:  string
  yLabel?:  string
  xFormat?: (n: number) => string
  yFormat?: (n: number) => string
}) {
  const padL = 44, padR = 12, padT = 12, padB = 30
  const W = 600 // viewBox width; svg scales to container via width=100%

  if (points.length === 0) {
    return <div className="flex items-center justify-center text-xs text-text-muted" style={{ height }}>No data points</div>
  }

  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  const xMax = Math.max(...xs, 1), xMin = Math.min(...xs, 0)
  const yMax = Math.max(...ys, 1), yMin = Math.min(...ys, 0)
  const xLo = xMin, xHi = xMax === xMin ? xMax + 1 : xMax
  const yLo = 0,    yHi = yMax === yMin ? yMax + 1 : yMax

  const plotW = W - padL - padR
  const plotH = height - padT - padB
  const sx = (x: number) => padL + ((x - xLo) / (xHi - xLo)) * plotW
  const sy = (y: number) => padT + plotH - ((y - yLo) / (yHi - yLo)) * plotH

  const ticks = 4
  const xTicks = Array.from({ length: ticks + 1 }, (_, i) => xLo + ((xHi - xLo) * i) / ticks)
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yLo + ((yHi - yLo) * i) / ticks)

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} className="overflow-visible">
      {/* gridlines */}
      {yTicks.map((t, i) => (
        <g key={`y${i}`}>
          <line x1={padL} y1={sy(t)} x2={W - padR} y2={sy(t)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          <text x={padL - 6} y={sy(t) + 3} textAnchor="end" fontSize={9} fill="var(--color-text-muted)">{yFormat(t)}</text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <g key={`x${i}`}>
          <line x1={sx(t)} y1={padT} x2={sx(t)} y2={padT + plotH} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
          <text x={sx(t)} y={height - padB + 14} textAnchor="middle" fontSize={9} fill="var(--color-text-muted)">{xFormat(t)}</text>
        </g>
      ))}
      {/* axis labels */}
      {xLabel && <text x={padL + plotW / 2} y={height - 2} textAnchor="middle" fontSize={9} fill="var(--color-text-muted)">{xLabel}</text>}
      {yLabel && <text x={12} y={padT + plotH / 2} textAnchor="middle" fontSize={9} fill="var(--color-text-muted)" transform={`rotate(-90 12 ${padT + plotH / 2})`}>{yLabel}</text>}
      {/* points */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={sx(p.x)} cy={sy(p.y)} r={p.r ?? 4}
          fill={p.color ?? '#a78bfa'} fillOpacity={0.65}
          stroke={p.color ?? '#a78bfa'} strokeOpacity={0.9} strokeWidth={1}
          className="transition-all hover:fill-opacity-100"
        >
          {p.label && <title>{p.label}</title>}
        </circle>
      ))}
    </svg>
  )
}

// ─── Card wrapper ────────────────────────────────────────────────────────────────

export function ChartCard({ title, icon, right, children, className }: {
  title: string
  icon?: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={clsx('bg-bg-secondary border border-white/10 rounded-xl p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </div>
  )
}
