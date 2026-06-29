import { useState } from 'react'
import {
  ArrowUpRight, Bot, BrainCircuit, Code2, Cpu, Flame, GitBranch, GitFork, Globe,
  MessageSquare, Shell, Sparkles, Star, TrendingUp, type LucideIcon,
} from 'lucide-react'
import type { BuzzItem, GithubRepo, NewsArticle, NewsCategory } from '../../lib/api'

/**
 * HeroShowcase — the editorial "top story" hero for the News page.
 *
 * Design contract (user-approved exception to the locked minimal theme):
 *   • huge rounded image block, massive headline overlaid bottom-left
 *   • glassmorphism stat widgets layered top-right over the image
 *   • theme (gradient, accent, glow, pattern) driven by the story's kind:
 *       repo → dark terminal/cyberpunk · buzz → high-energy ember ·
 *       article → its category's accent world
 *   • asymmetric wavy divider melting the image into the page background
 *   • blockquote with a bolded focal phrase + action buttons beneath
 */

// ─── Shared category tokens (imported by the News view too) ──────────────────

export const CATEGORY_ACCENT: Record<NewsCategory, string> = {
  ai: '#a78bfa', computing: '#60a5fa', code: '#2dd4bf', robotics: '#fbbf24',
}
export const CATEGORY_LABEL: Record<NewsCategory, string> = {
  ai: 'AI', computing: 'Computing', code: 'Code', robotics: 'Robotics',
}

export function Favicon({ src, color, size = 16 }: { src: string; color: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return <span className="grid shrink-0 place-items-center rounded-sm" style={{ width: size, height: size, background: `${color}22` }}>
      <Globe size={size * 0.62} style={{ color }} />
    </span>
  }
  return <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)}
    className="shrink-0 rounded-sm object-cover" style={{ width: size, height: size }} />
}

// ─── Story union ──────────────────────────────────────────────────────────────

export type HeroStory =
  | { kind: 'article'; article: NewsArticle; categoryCounts: Record<NewsCategory, number> }
  | { kind: 'repo';    repo: GithubRepo;     peers: GithubRepo[] }
  | { kind: 'buzz';    item: BuzzItem;       peers: BuzzItem[] }

interface HeroTheme {
  accent:   string
  kicker:   string
  gradient: string  // fallback background when the story has no image
  tint:     string  // overlay tint laid over a real image
  glow:     string  // outer box-shadow halo
  pattern?: string  // optional texture (terminal scanlines, etc.)
}

const CATEGORY_GRADIENT: Record<NewsCategory, string> = {
  ai:        'linear-gradient(135deg, #0d081f 0%, #241247 48%, #0e0922 100%)',
  computing: 'linear-gradient(135deg, #060f1f 0%, #0d2547 48%, #071322 100%)',
  code:      'linear-gradient(135deg, #03100c 0%, #072b22 48%, #031410 100%)',
  robotics:  'linear-gradient(135deg, #1c1303 0%, #3a2a08 48%, #1c1404 100%)',
}

function themeFor(story: HeroStory): HeroTheme {
  if (story.kind === 'repo') {
    return {
      accent: '#2dd4bf',
      kicker: 'Top repo',
      gradient: 'linear-gradient(135deg, #03100c 0%, #062b22 45%, #031410 100%)',
      tint: 'linear-gradient(100deg, rgba(2,12,10,0.92) 0%, rgba(2,12,10,0.6) 45%, rgba(4,30,24,0.35) 100%)',
      glow: '0 0 90px -28px rgba(45,212,191,0.5)',
      pattern: 'repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(45,212,191,0.05) 2px, rgba(45,212,191,0.05) 3px)',
    }
  }
  if (story.kind === 'buzz') {
    return {
      accent: '#fb923c',
      kicker: `Hottest now · ${story.item.origin}`,
      gradient: 'linear-gradient(135deg, #190902 0%, #41160a 48%, #1c0903 100%)',
      tint: 'linear-gradient(100deg, rgba(16,5,1,0.92) 0%, rgba(16,5,1,0.6) 45%, rgba(48,16,5,0.35) 100%)',
      glow: '0 0 90px -28px rgba(251,146,60,0.55)',
    }
  }
  const accent = CATEGORY_ACCENT[story.article.category]
  return {
    accent,
    kicker: `Top story · ${CATEGORY_LABEL[story.article.category]}`,
    gradient: CATEGORY_GRADIENT[story.article.category],
    tint: 'linear-gradient(100deg, rgba(5,5,8,0.92) 0%, rgba(5,5,8,0.55) 45%, rgba(10,10,16,0.3) 100%)',
    glow: `0 0 90px -28px ${accent}66`,
  }
}

function imageFor(story: HeroStory): string {
  // GitHub's OG card bakes in its own giant title + stat row, which collides with
  // our overlays — so repos use the themed gradient + a crisp avatar instead.
  if (story.kind === 'repo') return ''
  if (story.kind === 'buzz') return story.item.image
  return story.article.image
}

function avatarFor(story: HeroStory): string {
  return story.kind === 'repo' ? story.repo.avatar : ''
}

// Reusable thumbnail with a graceful fallback chain so there are never blank gaps
// (ADHD-friendly visual anchors):
//   real image  →  the page's own logo (favicon/avatar) on a themed tile  →  icon glyph.
export function Thumb({ image, logo, color, icon, className = '' }: { image?: string; logo?: string; color: string; icon: React.ReactNode; className?: string }) {
  const [imgFailed, setImgFailed] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  if (image && !imgFailed) {
    return <img src={image} alt="" loading="lazy" onError={() => setImgFailed(true)} className={`object-cover ${className}`} />
  }
  return (
    <div className={`relative grid place-items-center overflow-hidden ${className}`}
      style={{ background: `linear-gradient(135deg, ${color}33, ${color}0d 60%, transparent)` }}>
      {/* dotted texture so the tile feels designed, not empty */}
      <div className="absolute inset-0 opacity-60" style={{ backgroundImage: `radial-gradient(${color}26 1px, transparent 1px)`, backgroundSize: '10px 10px' }} />
      {logo && !logoFailed
        ? <img src={logo} alt="" loading="lazy" onError={() => setLogoFailed(true)}
            className="relative h-[46%] w-[46%] max-h-[46px] max-w-[46px] rounded-md object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)]" />
        : <span className="relative" style={{ color }}>{icon}</span>}
    </div>
  )
}

// ─── Glass widgets ────────────────────────────────────────────────────────────

const glass = 'rounded-xl border border-white/10 bg-white/[0.07] p-3.5  '

function StatWidget({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className={glass}>
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">{icon}{label}</p>
      <p className="text-2xl font-semibold tabular-nums leading-none text-white">{value}</p>
      <p className="mt-1.5 text-xxs text-white/60">{sub}</p>
    </div>
  )
}

function BarsWidget({ title, bars, accent }: { title: string; bars: Array<{ label: string; value: number; hot?: boolean }>; accent: string }) {
  const max = Math.max(...bars.map(b => b.value), 1)
  return (
    <div className={glass}>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">{title}</p>
      <div className="flex h-14 items-end gap-1.5">
        {bars.map((bar, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
            <div className="w-full rounded-t-sm transition-all"
              style={{ height: `${Math.max(8, (bar.value / max) * 82)}%`, background: bar.hot ? accent : 'rgba(255,255,255,0.22)' }} />
            <span className="w-full truncate text-center text-[8px] leading-none text-white/45">{bar.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SourceWidget({ favicon, name, accent, sub }: { favicon: string; name: string; accent: string; sub: string }) {
  return (
    <div className={glass}>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">Source</p>
      <div className="flex items-center gap-2">
        <Favicon src={favicon} color={accent} size={20} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-white">{name}</p>
          <p className="text-xxs text-white/60">{sub}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Quote helper — bold the focal opening phrase ─────────────────────────────

function splitFocal(text: string): [string, string] {
  const words = text.split(/\s+/).filter(Boolean)
  const n = Math.min(words.length, 9)
  return [words.slice(0, n).join(' '), words.slice(n).join(' ')]
}

// ─── Branded fallback (no image, or image failed to load) ─────────────────────
// Instead of a blank tile, lean into the source's identity: the page's logo plus
// a giant accent wordmark + glyph, all tinted to the story's theme. Cool, on-brand,
// and never empty.

const CATEGORY_GLYPH: Record<NewsCategory, LucideIcon> = {
  ai: BrainCircuit, computing: Cpu, code: Code2, robotics: Bot,
}

function brandIdentity(story: HeroStory): { wordmark: string; Glyph: LucideIcon } {
  if (story.kind === 'repo') return { wordmark: 'GitHub', Glyph: GitBranch }
  if (story.kind === 'buzz') {
    const s = story.item.source
    if (s === 'reddit')   return { wordmark: 'Reddit',   Glyph: MessageSquare }
    if (s === 'lobsters') return { wordmark: 'Lobsters', Glyph: Shell }
    return { wordmark: 'Hacker News', Glyph: Flame }
  }
  return { wordmark: story.article.source, Glyph: CATEGORY_GLYPH[story.article.category] }
}

function BrandedBackground({ wordmark, Glyph, theme }: { wordmark: string; Glyph: LucideIcon; theme: HeroTheme }) {
  return (
    <>
      <div className="absolute inset-0" style={{ background: theme.gradient }} />
      {/* dotted grid texture */}
      <div className="absolute inset-0 opacity-60" style={{ backgroundImage: `radial-gradient(${theme.accent}1f 1px, transparent 1px)`, backgroundSize: '22px 22px' }} />
      {theme.pattern && <div className="absolute inset-0 opacity-70" style={{ background: theme.pattern }} />}
      {/* accent glow */}
      <div className="pointer-events-none absolute -left-24 top-1/3 h-80 w-80 rounded-full blur-3xl" style={{ background: `${theme.accent}26` }} />
      {/* giant glyph + wordmark watermark (clipped by the rounded container) */}
      <Glyph aria-hidden className="pointer-events-none absolute -right-10 -top-12" size={300} style={{ color: theme.accent, opacity: 0.08 }} />
      <span aria-hidden className="pointer-events-none absolute bottom-0 right-4 select-none text-[6rem] font-semibold leading-[0.75] tracking-tighter sm:text-[9rem]"
        style={{ color: theme.accent, opacity: 0.09 }}>{wordmark}</span>
    </>
  )
}

// ─── Main hero ────────────────────────────────────────────────────────────────

export function HeroShowcase({ story, sample }: { story: HeroStory; sample?: boolean }) {
  const theme = themeFor(story)
  const image = imageFor(story)
  const avatar = avatarFor(story)
  const brand = brandIdentity(story)
  const [imgFailed, setImgFailed] = useState(false)
  const showImage = Boolean(image) && !imgFailed

  // Per-kind content
  let titleNode: React.ReactNode
  let timeAgo = ''
  let quote = ''
  let primary: { label: string; href: string }
  let secondary: { label: string; href: string } | null = null
  let widgets: React.ReactNode = null

  if (story.kind === 'repo') {
    const { repo, peers } = story
    titleNode = <><span className="text-white/55">{repo.owner}/</span>{repo.name}</>
    timeAgo = `new ${repo.createdAgo}`
    quote = repo.description || `A new ${repo.language ?? ''} project climbing GitHub's trending charts.`.replace('  ', ' ')
    primary = { label: 'View repository', href: repo.url }
    secondary = { label: `@${repo.owner}`, href: `https://github.com/${repo.owner}` }
    widgets = (
      <>
        <StatWidget icon={<Star size={11} />} label="Stars" value={compact(repo.stars)}
          sub={`${compact(repo.forks)} forks${repo.language ? ` · ${repo.language}` : ''}`} />
        <BarsWidget title="Stars vs trending" accent={theme.accent}
          bars={[repo, ...peers.slice(0, 4)].map((r, i) => ({ label: r.name.slice(0, 7), value: r.stars, hot: i === 0 }))} />
      </>
    )
  } else if (story.kind === 'buzz') {
    const { item, peers } = story
    titleNode = item.title
    timeAgo = item.postedAgo
    quote = `Lighting up ${item.origin} with ${item.score.toLocaleString()} points and ${item.comments.toLocaleString()} comments${item.domain ? ` — via ${item.domain}` : ''}.`
    primary = { label: 'Open article', href: item.url }
    secondary = { label: 'View discussion', href: item.commentsUrl }
    const heat = (b: BuzzItem) => b.score + b.comments * 2
    widgets = (
      <>
        <StatWidget icon={<TrendingUp size={11} />} label="Points" value={compact(item.score)}
          sub={`${compact(item.comments)} comments · ${item.postedAgo}`} />
        <BarsWidget title="Heat vs top threads" accent={theme.accent}
          bars={[item, ...peers.slice(0, 4)].map((b, i) => ({ label: b.domain.slice(0, 7) || b.origin.slice(0, 7), value: heat(b), hot: i === 0 }))} />
      </>
    )
  } else {
    const { article, categoryCounts } = story
    titleNode = article.title
    timeAgo = article.publishedAgo
    quote = article.summary
    primary = { label: 'Read full story', href: article.url }
    secondary = article.domain ? { label: `Visit ${article.source}`, href: `https://${article.domain}` } : null
    widgets = (
      <>
        <SourceWidget favicon={article.favicon} name={article.source} accent={theme.accent}
          sub={`${CATEGORY_LABEL[article.category]} · ${article.publishedAgo}`} />
        <BarsWidget title="Today's mix" accent={theme.accent}
          bars={(Object.keys(CATEGORY_LABEL) as NewsCategory[]).map(cat => ({
            label: CATEGORY_LABEL[cat], value: categoryCounts[cat] ?? 0, hot: cat === article.category,
          }))} />
      </>
    )
  }

  const [focal, rest] = splitFocal(quote)

  return (
    <section className="mb-2">
      {/* ── Image block — bleeds and dissolves into the page (no card/puck chrome) ── */}
      <div className="relative h-[340px] overflow-hidden rounded-xl md:h-[400px]">
        {/* background: real image or themed gradient */}
        {showImage
          ? <img src={image} alt="" loading="eager" onError={() => setImgFailed(true)}
              className="absolute inset-0 h-full w-full object-cover" />
          : <BrandedBackground wordmark={brand.wordmark} Glyph={brand.Glyph} theme={theme} />}
        {/* theme tint for legibility over real images */}
        {showImage && <div className="absolute inset-0" style={{ background: theme.tint }} />}
        {/* directional scrim keeps the headline readable */}
        <div className="absolute inset-0 bg-black/55" />
        {/* dissolve the bottom into the page background — no hard edge, no wave */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-base/80" />

        {/* kicker — top-left */}
        <div className="absolute left-6 top-5 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 ">
            {story.kind === 'buzz' ? <Flame size={12} style={{ color: theme.accent }} /> : <Sparkles size={12} style={{ color: theme.accent }} />}
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white">{theme.kicker}</span>
          </span>
          {timeAgo && <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] font-semibold text-white/70 ">{timeAgo}</span>}
          {sample && <span className="rounded-full border border-amber-400/40 bg-amber-500/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300 ">Sample data</span>}
        </div>

        {/* glass widgets — layered right */}
        <div className="absolute right-5 top-5 hidden w-[230px] flex-col gap-2.5 md:flex">
          {widgets}
        </div>

        {/* massive headline — bottom-left, above the wave */}
        <a href={primary.href} target="_blank" rel="noopener noreferrer"
          className="group absolute bottom-7 left-6 right-6 block md:right-[270px]">
          {avatar && <img src={avatar} alt="" className="mb-3 h-12 w-12 rounded-xl border border-white/25 object-cover " />}
          <h2 className="text-[1.7rem] font-semibold leading-[1.08] tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)] transition-colors group-hover:text-white/85 sm:text-[2.4rem]"
            style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {titleNode}
          </h2>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.14em] opacity-90" style={{ color: theme.accent }}>
            {primary.label} <ArrowUpRight size={13} />
          </span>
        </a>

      </div>

      {/* ── Below-image hero content ── */}
      {quote && (
        <blockquote className="mt-5 border-l-4 pl-4" style={{ borderColor: theme.accent }}>
          <p className="max-w-2xl text-[15px] leading-relaxed text-text-secondary">
            <strong className="font-semibold text-text-primary">{focal}</strong>{rest ? ` ${rest}` : ''}
          </p>
        </blockquote>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <a href={primary.href} target="_blank" rel="noopener noreferrer"
          className="rounded-lg px-4 py-2 text-xs font-semibold text-[#0b0b0d] transition-opacity hover:opacity-85"
          style={{ background: theme.accent }}>
          {primary.label}
        </a>
        {secondary && (
          <a href={secondary.href} target="_blank" rel="noopener noreferrer"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-text-primary  transition-colors hover:bg-white/10">
            {secondary.label}
          </a>
        )}
        {story.kind === 'buzz' && (
          <a href={story.item.commentsUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1.5 text-xxs text-text-muted transition-colors hover:text-text-secondary">
            <MessageSquare size={12} />{compact(story.item.comments)} comments
          </a>
        )}
        {story.kind === 'repo' && (
          <span className="ml-auto flex items-center gap-3 text-xxs text-text-muted">
            <span className="flex items-center gap-1"><Star size={12} className="text-accent-amber" />{compact(story.repo.stars)}</span>
            <span className="flex items-center gap-1"><GitFork size={12} />{compact(story.repo.forks)}</span>
          </span>
        )}
      </div>
    </section>
  )
}

function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

// ─── Sample fallback stories (rendered with a "Sample data" badge when a feed is empty) ──

export const SAMPLE_STORIES: Record<'feed' | 'github' | 'buzz', HeroStory> = {
  feed: {
    kind: 'article',
    categoryCounts: { ai: 6, computing: 3, code: 4, robotics: 1 },
    article: {
      id: 'sample-article', title: 'Frontier lab ships an open-weights model that tops the coding leaderboards',
      url: 'https://example.com', summary: 'A surprise open-weights release just rewrote the cost-performance curve for code generation, landing within two points of closed frontier models on SWE-bench while running on a single consumer GPU.',
      source: 'Sample Wire', category: 'ai', domain: 'example.com', favicon: '', image: '',
      publishedAt: new Date().toISOString(), publishedAgo: 'just now',
    },
  },
  github: {
    kind: 'repo',
    peers: [
      { id: 's2', name: 'vector-forge', owner: 'acme', fullName: 'acme/vector-forge', url: 'https://example.com', description: '', language: 'Rust', stars: 2100, forks: 90, topics: [], avatar: '', createdAgo: '3d ago', pushedAgo: '1h ago', image: '' } as unknown as GithubRepo,
      { id: 's3', name: 'agentd', owner: 'acme', fullName: 'acme/agentd', url: 'https://example.com', description: '', language: 'Go', stars: 1400, forks: 60, topics: [], avatar: '', createdAgo: '5d ago', pushedAgo: '2h ago', image: '' } as unknown as GithubRepo,
    ],
    repo: {
      id: 'sample-repo', name: 'terminal-pilot', owner: 'sample', fullName: 'sample/terminal-pilot',
      url: 'https://example.com', description: 'An autonomous terminal copilot that plans, executes, and self-corrects multi-step shell workflows — fully local, fully auditable.',
      language: 'TypeScript', stars: 4800, forks: 210, topics: ['ai-agents', 'cli', 'automation'],
      avatar: '', createdAgo: '2d ago', pushedAgo: '10m ago',
    } as unknown as GithubRepo,
  },
  buzz: {
    kind: 'buzz',
    peers: [],
    item: {
      id: 'sample-buzz', title: 'Show HN: I rebuilt our entire CI pipeline as a single state machine',
      url: 'https://example.com', source: 'hackernews', origin: 'Hacker News',
      score: 870, comments: 412, commentsUrl: 'https://example.com', domain: 'example.com', image: '',
      postedAt: new Date().toISOString(), postedAgo: '3h ago',
    },
  },
}
