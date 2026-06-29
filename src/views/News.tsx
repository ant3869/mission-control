import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  ArrowUpRight, Bot, BrainCircuit, Cpu, Code2, Flame, GitFork, MessageSquare,
  Newspaper, RefreshCw, Rss, Search, Shell, Star, TrendingUp,
} from 'lucide-react'
import {
  news,
  type BuzzItem, type GithubRepo, type GithubSince, type NewsArticle, type NewsCategory, type NewsSourceStatus,
} from '../lib/api'
import { friendlyError } from '../lib/friendlyError'
import {
  CATEGORY_ACCENT, CATEGORY_LABEL, Favicon, HeroShowcase, SAMPLE_STORIES, Thumb, type HeroStory,
} from '../components/news/HeroShowcase'

type Tab = 'feed' | 'github' | 'buzz'

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode; blurb: string }> = [
  { id: 'feed',   label: 'Feed',   icon: <Rss size={13} />,   blurb: 'Live RSS across AI, computing, code & robotics' },
  { id: 'github', label: 'GitHub', icon: <Star size={13} />,  blurb: 'Trending new repositories by stars' },
  { id: 'buzz',   label: 'Buzz',   icon: <Flame size={13} />, blurb: "What's stirring on Hacker News & Reddit" },
]

const CATEGORY_ICON: Record<NewsCategory, React.ReactNode> = {
  ai: <BrainCircuit size={18} />, computing: <Cpu size={18} />, code: <Code2 size={18} />, robotics: <Bot size={18} />,
}

const CATEGORIES: Array<{ id: NewsCategory | 'all'; label: string; icon: React.ReactNode; color: string }> = [
  { id: 'all',       label: 'All',       icon: <Newspaper size={12} />, color: '#60a5fa' },
  { id: 'ai',        label: 'AI',        icon: <BrainCircuit size={12} />, color: '#a78bfa' },
  { id: 'computing', label: 'Computing', icon: <Cpu size={12} />,       color: '#60a5fa' },
  { id: 'code',      label: 'Code',      icon: <Code2 size={12} />,     color: '#2dd4bf' },
  { id: 'robotics',  label: 'Robotics',  icon: <Bot size={12} />,       color: '#fbbf24' },
]

const LANE_ORDER: NewsCategory[] = ['ai', 'computing', 'code', 'robotics']

const BUZZ_COLOR: Record<BuzzItem['source'], string> = { hackernews: '#fb923c', reddit: '#ff4500', lobsters: '#c2683a' }
const BUZZ_LABEL: Record<BuzzItem['source'], string> = { hackernews: 'Hacker News', reddit: 'Reddit', lobsters: 'Lobsters' }
const BUZZ_ORDER: BuzzItem['source'][] = ['hackernews', 'reddit', 'lobsters']
// Each platform's own logo (favicon) — used as the branded thumbnail fallback.
const BUZZ_FAVICON: Record<BuzzItem['source'], string> = {
  hackernews: 'https://www.google.com/s2/favicons?domain=news.ycombinator.com&sz=128',
  reddit:     'https://www.google.com/s2/favicons?domain=reddit.com&sz=128',
  lobsters:   'https://www.google.com/s2/favicons?domain=lobste.rs&sz=128',
}
const BUZZ_SOURCES: Array<{ id: BuzzItem['source'] | 'all'; label: string; icon: React.ReactNode; color: string }> = [
  { id: 'all',        label: 'All',         icon: <Flame size={12} />,         color: '#fb923c' },
  { id: 'hackernews', label: 'Hacker News', icon: <Flame size={12} />,         color: BUZZ_COLOR.hackernews },
  { id: 'reddit',     label: 'Reddit',      icon: <MessageSquare size={12} />, color: BUZZ_COLOR.reddit },
  { id: 'lobsters',   label: 'Lobsters',    icon: <Shell size={12} />,         color: BUZZ_COLOR.lobsters },
]

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Rust: '#dea584',
  Go: '#00ADD8', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600', Java: '#b07219',
  Ruby: '#701516', Swift: '#F05138', Kotlin: '#A97BFF', PHP: '#4F5D95', Shell: '#89e051',
  HTML: '#e34c26', CSS: '#563d7c', Vue: '#41b883', Dart: '#00B4AB', Lua: '#000080',
  'Jupyter Notebook': '#DA5B0B', Zig: '#ec915c', Elixir: '#6e4a7e', Scala: '#c22d40',
}
function langColor(language: string | null): string {
  return language ? (LANG_COLORS[language] ?? '#6b7280') : '#6b7280'
}

const SINCE_OPTIONS: Array<{ id: GithubSince; label: string }> = [
  { id: 'daily',   label: 'Today' },
  { id: 'weekly',  label: 'This week' },
  { id: 'monthly', label: 'This month' },
]

function compactNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

// ─── Cross-source "Top right now" strip ────────────────────────────────────────

interface TopPick {
  id: string
  title: string
  image: string
  logo: string
  badge: string
  color: string
  metric: string
  url: string
  icon: React.ReactNode
}

function TopStrip({ picks }: { picks: TopPick[] }) {
  if (picks.length === 0) return null
  return (
    <div className="mb-6">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-green opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-green" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">Top right now</span>
        <span className="text-xxs text-text-muted">· across all sources</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {picks.map(pick => (
          <a key={pick.id} href={pick.url} target="_blank" rel="noopener noreferrer"
            className="group relative flex h-[150px] w-[210px] shrink-0 flex-col justify-end overflow-hidden rounded-xl border border-border bg-card transition-transform hover:-translate-y-0.5">
            <Thumb image={pick.image} logo={pick.logo} color={pick.color} icon={pick.icon} className="absolute inset-0 h-full w-full" />
            <div className="absolute inset-0 bg-black/65" />
            <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide "
              style={{ color: pick.color, background: `${pick.color}26` }}>
              {pick.badge}
            </span>
            <div className="relative p-3">
              <h4 className="line-clamp-2 text-[13px] font-semibold leading-snug text-white">{pick.title}</h4>
              <p className="mt-1 text-[10px] font-medium" style={{ color: pick.color }}>{pick.metric}</p>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

// ─── Section header ────────────────────────────────────────────────────────────

function LaneHeader({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 -mx-1 mb-2 mt-8 flex items-center gap-2 bg-base/95 px-1 py-1.5 ">
      <span className="h-3.5 w-1 rounded-full" style={{ background: color }} />
      <span className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color }}>{label}</span>
      <span className="rounded-full bg-card px-1.5 text-xxs tabular-nums text-text-muted">{count}</span>
      <span className="ml-1 h-px flex-1 bg-border" />
    </div>
  )
}

// ─── Subsequent stories — image-anchored, larger text ──────────────────────────

function ArticleRow({ article }: { article: NewsArticle }) {
  const accent = CATEGORY_ACCENT[article.category]
  return (
    <a href={article.url} target="_blank" rel="noopener noreferrer"
      className="group -mx-2 flex gap-4 rounded-xl border-b border-border/40 px-2 py-3.5 transition-colors hover:bg-card-hover/40">
      <Thumb image={article.image} logo={article.favicon} color={accent} icon={CATEGORY_ICON[article.category]}
        className="h-[68px] w-[104px] shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-xxs text-text-muted">
          <Favicon src={article.favicon} color={accent} size={13} />
          <span className="font-medium text-text-secondary">{article.source}</span>
          <span>·</span>
          <span>{article.publishedAgo}</span>
          <span className="rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide"
            style={{ color: accent, background: `${accent}1a` }}>{CATEGORY_LABEL[article.category]}</span>
        </div>
        <h4 className="line-clamp-2 text-base font-semibold leading-snug text-text-primary transition-colors group-hover:text-accent-blue">
          {article.title}
        </h4>
        {article.summary && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-text-secondary">{article.summary}</p>}
      </div>
      <ArrowUpRight size={14} className="mt-1 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  )
}

function RepoRow({ repo }: { repo: GithubRepo }) {
  const accent = langColor(repo.language)
  return (
    <a href={repo.url} target="_blank" rel="noopener noreferrer"
      className="group -mx-2 flex gap-4 rounded-xl border-b border-border/40 px-2 py-3.5 transition-colors hover:bg-card-hover/40">
      <img src={repo.avatar} alt="" width={64} height={64} loading="lazy"
        className="h-16 w-16 shrink-0 rounded-xl border border-border object-cover" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2.5 text-xxs text-text-muted">
          {repo.language && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />{repo.language}</span>}
          <span className="flex items-center gap-1"><Star size={11} className="text-accent-amber" />{compactNumber(repo.stars)}</span>
          <span className="flex items-center gap-1"><GitFork size={11} />{compactNumber(repo.forks)}</span>
          <span>new {repo.createdAgo}</span>
        </div>
        <h4 className="truncate text-base font-semibold leading-snug text-text-primary transition-colors group-hover:text-accent-blue">
          <span className="text-text-muted">{repo.owner}/</span>{repo.name}
        </h4>
        {repo.description && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-text-secondary">{repo.description}</p>}
        {repo.topics.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {repo.topics.slice(0, 5).map(t => <span key={t} className="rounded-full border border-border-subtle bg-card px-2 py-0.5 text-[10px] text-accent-blue/70">{t}</span>)}
          </div>
        )}
      </div>
    </a>
  )
}

function BuzzRow({ item }: { item: BuzzItem }) {
  const accent = BUZZ_COLOR[item.source]
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer"
      className="group -mx-2 flex gap-4 rounded-xl border-b border-border/40 px-2 py-3.5 transition-colors hover:bg-card-hover/40">
      {item.image
        ? <div className="relative h-[68px] w-[104px] shrink-0">
            <Thumb image={item.image} color={accent} icon={<Flame size={18} />} className="h-full w-full rounded-lg" />
            <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">▲ {compactNumber(item.score)}</span>
          </div>
        : <div className="grid h-[68px] w-[104px] shrink-0 place-items-center rounded-lg" style={{ background: `linear-gradient(135deg, ${accent}2e, ${accent}0a)` }}>
            <div className="text-center">
              <p className="text-xl font-semibold leading-none tabular-nums" style={{ color: accent }}>{compactNumber(item.score)}</p>
              <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted">points</p>
            </div>
          </div>}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-xxs">
          <span className="font-semibold" style={{ color: accent }}>{item.origin}</span>
          {item.domain && <span className="truncate text-text-muted">· {item.domain}</span>}
          <span className="text-text-muted">· {item.postedAgo}</span>
        </div>
        <h4 className="line-clamp-2 text-base font-semibold leading-snug text-text-primary transition-colors group-hover:text-accent-blue">
          {item.title}
        </h4>
        <div className="mt-1.5 flex items-center gap-3 text-xxs text-text-muted">
          <span className="flex items-center gap-1"><TrendingUp size={11} className="text-accent-green" />{compactNumber(item.score)} points</span>
          <span className="flex items-center gap-1"><MessageSquare size={11} />{compactNumber(item.comments)} comments</span>
        </div>
      </div>
    </a>
  )
}

// ─── Skeletons / status ─────────────────────────────────────────────────────────

function ListSkeletons() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[150px] w-[210px] shrink-0 rounded-xl bg-card animate-pulse" />)}</div>
      <div className="h-[400px] rounded-[2rem] bg-card animate-pulse" />
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-card/60 animate-pulse" />)}
    </div>
  )
}

function SourceBar({ sources }: { sources: NewsSourceStatus[] }) {
  if (sources.length === 0) return null
  const live = sources.filter(s => s.ok).length
  const down = sources.filter(s => !s.ok)
  return (
    <div className="flex flex-wrap items-center gap-2 text-xxs text-text-muted">
      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent-green" />{live}/{sources.length} sources live</span>
      {down.map(s => (
        <span key={s.name} className="flex items-center gap-1 rounded border border-red-900/40 bg-red-950/20 px-1.5 py-0.5 text-red-300/70">
          <span className="h-1 w-1 rounded-full bg-accent-red" />{s.name} down
        </span>
      ))}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function News() {
  const [tab, setTab] = useState<Tab>('feed')
  const [query, setQuery] = useState('')

  const [articles, setArticles]       = useState<NewsArticle[]>([])
  const [feedSources, setFeedSources] = useState<NewsSourceStatus[]>([])
  const [repos, setRepos]             = useState<GithubRepo[]>([])
  const [buzz, setBuzz]               = useState<BuzzItem[]>([])
  const [buzzSources, setBuzzSources] = useState<NewsSourceStatus[]>([])

  const [loading, setLoading]     = useState<Record<Tab, boolean>>({ feed: false, github: false, buzz: false })
  const [loaded, setLoaded]       = useState<Record<Tab, boolean>>({ feed: false, github: false, buzz: false })
  const [error, setError]         = useState<Record<Tab, string | null>>({ feed: null, github: null, buzz: null })
  const [updatedAt, setUpdatedAt] = useState<Record<Tab, string>>({ feed: '', github: '', buzz: '' })

  const [since, setSince] = useState<GithubSince>('weekly')
  const [lang, setLang]   = useState('')
  const [category, setCategory] = useState<NewsCategory | 'all'>('all')
  const [buzzSource, setBuzzSource] = useState<BuzzItem['source'] | 'all'>('all')

  const setTabLoading = (t: Tab, v: boolean) => setLoading(prev => ({ ...prev, [t]: v }))

  const loadFeed = useCallback(async () => {
    setTabLoading('feed', true); setError(prev => ({ ...prev, feed: null }))
    try {
      const res = await news.feed()
      setArticles(res.articles); setFeedSources(res.sources)
      setUpdatedAt(prev => ({ ...prev, feed: res.fetchedAt }))
      setLoaded(prev => ({ ...prev, feed: true }))
    } catch (err: any) {
      setError(prev => ({ ...prev, feed: err?.message ?? 'Failed to load feed' }))
    } finally { setTabLoading('feed', false) }
  }, [])

  const loadGithub = useCallback(async () => {
    setTabLoading('github', true); setError(prev => ({ ...prev, github: null }))
    try {
      const res = await news.github(since, lang)
      setRepos(res.repos)
      setUpdatedAt(prev => ({ ...prev, github: res.fetchedAt }))
      setLoaded(prev => ({ ...prev, github: true }))
    } catch (err: any) {
      setError(prev => ({ ...prev, github: err?.message ?? 'Failed to load trending' }))
    } finally { setTabLoading('github', false) }
  }, [since, lang])

  const loadBuzz = useCallback(async () => {
    setTabLoading('buzz', true); setError(prev => ({ ...prev, buzz: null }))
    try {
      const res = await news.buzz()
      setBuzz(res.items); setBuzzSources(res.sources)
      setUpdatedAt(prev => ({ ...prev, buzz: res.fetchedAt }))
      setLoaded(prev => ({ ...prev, buzz: true }))
    } catch (err: any) {
      setError(prev => ({ ...prev, buzz: err?.message ?? 'Failed to load buzz' }))
    } finally { setTabLoading('buzz', false) }
  }, [])

  const loaders: Record<Tab, () => Promise<void>> = useMemo(
    () => ({ feed: loadFeed, github: loadGithub, buzz: loadBuzz }),
    [loadFeed, loadGithub, loadBuzz],
  )

  // Load every source up front so the cross-source "Top right now" strip is
  // populated without the user needing to visit each tab.
  useEffect(() => { loadFeed(); loadGithub(); loadBuzz() /* eslint-disable-next-line */ }, [])
  useEffect(() => { if (loaded.github) loadGithub() /* eslint-disable-next-line */ }, [since, lang])

  const tabRef = useRef(tab); tabRef.current = tab
  useEffect(() => {
    const timer = setInterval(() => { loaders[tabRef.current]() }, 5 * 60_000)
    return () => clearInterval(timer)
  }, [loaders])

  const filteredArticles = useMemo(() => {
    const q = query.trim().toLowerCase()
    return articles
      .filter(a => category === 'all' || a.category === category)
      .filter(a => !q || a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q) || a.source.toLowerCase().includes(q))
  }, [articles, category, query])

  const filteredRepos = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return repos
    return repos.filter(r => r.fullName.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.topics.some(t => t.includes(q)))
  }, [repos, query])

  const filteredBuzz = useMemo(() => {
    const q = query.trim().toLowerCase()
    return buzz
      .filter(b => buzzSource === 'all' || b.source === buzzSource)
      .filter(b => !q || b.title.toLowerCase().includes(q) || b.origin.toLowerCase().includes(q) || b.domain.includes(q))
  }, [buzz, buzzSource, query])

  const buzzCounts = useMemo(() => {
    const base: Record<BuzzItem['source'] | 'all', number> = { all: buzz.length, hackernews: 0, reddit: 0, lobsters: 0 }
    for (const b of buzz) base[b.source] += 1
    return base
  }, [buzz])

  const counts: Record<NewsCategory | 'all', number> = useMemo(() => {
    const base: Record<NewsCategory | 'all', number> = { all: articles.length, ai: 0, computing: 0, code: 0, robotics: 0 }
    for (const a of articles) base[a.category] += 1
    return base
  }, [articles])

  // Cross-source quick-view picks (interleaved, image-forward).
  const topPicks: TopPick[] = useMemo(() => {
    const withImg = articles.filter(a => a.image)
    const artPool = (withImg.length >= 3 ? withImg : articles).slice(0, 3)
    const repoPool = repos.slice(0, 3)
    const buzzPool = buzz.slice(0, 3)
    const out: TopPick[] = []
    for (let i = 0; i < 3; i++) {
      const a = artPool[i]
      if (a) out.push({
        id: `a-${a.id}`, title: a.title, image: a.image, logo: a.favicon, badge: CATEGORY_LABEL[a.category],
        color: CATEGORY_ACCENT[a.category], metric: `${a.source} · ${a.publishedAgo}`, url: a.url, icon: CATEGORY_ICON[a.category],
      })
      const r = repoPool[i]
      if (r) out.push({
        id: `r-${r.id}`, title: `${r.owner}/${r.name}`, image: r.avatar, logo: r.avatar, badge: 'GitHub',
        color: '#2dd4bf', metric: `★ ${compactNumber(r.stars)} · new ${r.createdAgo}`, url: r.url, icon: <Star size={18} />,
      })
      const b = buzzPool[i]
      if (b) out.push({
        id: `b-${b.id}`, title: b.title, image: b.image, logo: BUZZ_FAVICON[b.source], badge: b.origin,
        color: BUZZ_COLOR[b.source], metric: `▲ ${compactNumber(b.score)} points · ${b.postedAgo}`, url: b.url, icon: <Flame size={18} />,
      })
    }
    return out
  }, [articles, repos, buzz])

  // ── Hero story per tab ──
  const heroStory: HeroStory | null = useMemo(() => {
    if (tab === 'feed') {
      if (filteredArticles.length === 0) return loaded.feed ? SAMPLE_STORIES.feed : null
      const withImage = filteredArticles.slice(0, 10).find(a => a.image)
      const pick = withImage ?? filteredArticles[0]
      const categoryCounts = { ai: counts.ai, computing: counts.computing, code: counts.code, robotics: counts.robotics }
      return { kind: 'article', article: pick, categoryCounts }
    }
    if (tab === 'github') {
      if (filteredRepos.length === 0) return loaded.github ? SAMPLE_STORIES.github : null
      return { kind: 'repo', repo: filteredRepos[0], peers: filteredRepos.slice(1) }
    }
    if (buzz.length === 0) return loaded.buzz ? SAMPLE_STORIES.buzz : null
    if (filteredBuzz.length === 0) return null
    return { kind: 'buzz', item: filteredBuzz[0], peers: filteredBuzz.slice(1) }
  }, [tab, filteredArticles, filteredRepos, filteredBuzz, buzz, counts, loaded])

  const heroIsSample =
    (tab === 'feed' && filteredArticles.length === 0)
    || (tab === 'github' && filteredRepos.length === 0)
    || (tab === 'buzz' && buzz.length === 0)

  const heroArticleId = heroStory?.kind === 'article' ? heroStory.article.id : null
  const feedLanes = useMemo(() => {
    const rest = filteredArticles.filter(a => a.id !== heroArticleId)
    return LANE_ORDER.map(cat => ({ cat, items: rest.filter(a => a.category === cat) })).filter(l => l.items.length > 0)
  }, [filteredArticles, heroArticleId])

  const repoRest = filteredRepos.slice(1)
  const buzzLanes = useMemo(() => {
    const rest = filteredBuzz.slice(1)
    return BUZZ_ORDER.map(src => ({ src, items: rest.filter(b => b.source === src) })).filter(l => l.items.length > 0)
  }, [filteredBuzz])

  const isLoading = loading[tab]
  const tabError = error[tab]
  const stamp = updatedAt[tab] ? new Date(updatedAt[tab]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

  const subtitle = (() => {
    if (tab === 'feed')   return isLoading && !loaded.feed ? 'Loading feed…' : `${filteredArticles.length} stories${stamp ? ` · updated ${stamp}` : ''}`
    if (tab === 'github') return isLoading && !loaded.github ? 'Loading repositories…' : `${filteredRepos.length} trending repos${stamp ? ` · updated ${stamp}` : ''}`
    return isLoading && !loaded.buzz ? 'Loading buzz…' : `${filteredBuzz.length} hot threads${stamp ? ` · updated ${stamp}` : ''}`
  })()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 pt-5 pb-4 shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">News</h1>
          <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>
        </div>
        <button onClick={() => loaders[tab]()} disabled={isLoading}
          className="flex items-center gap-1.5 rounded border border-border bg-card px-3 py-1.5 text-xs text-text-secondary hover:bg-card-hover hover:text-text-primary disabled:opacity-50">
          <RefreshCw size={12} className={clsx(isLoading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border px-6 pt-3 shrink-0">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} title={t.blurb}
            className={clsx(
              'flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-xs font-medium transition-colors',
              tab === t.id ? 'border-accent-blue text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary',
            )}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3 shrink-0">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${tab === 'github' ? 'repos' : tab === 'buzz' ? 'threads' : 'stories'}…`}
            className="w-full rounded border border-border bg-card py-1.5 pl-7 pr-3 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border" />
        </div>

        {tab === 'feed' && (
          <div className="flex flex-wrap items-center gap-1">
            {CATEGORIES.map(c => (
              <button key={c.id} onClick={() => setCategory(c.id)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xxs font-medium transition-colors',
                  category === c.id ? 'border-transparent text-text-primary' : 'border-border text-text-muted hover:text-text-secondary',
                )}
                style={category === c.id ? { background: `${c.color}22`, color: c.color } : undefined}>
                {c.icon}{c.label}
                <span className="tabular-nums opacity-70">{counts[c.id]}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'github' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
              {SINCE_OPTIONS.map(s => (
                <button key={s.id} onClick={() => setSince(s.id)}
                  className={clsx('rounded px-2.5 py-1 text-xxs font-medium transition-colors', since === s.id ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                  {s.label}
                </button>
              ))}
            </div>
            <input value={lang} onChange={e => setLang(e.target.value)} placeholder="Any language"
              className="w-32 rounded border border-border bg-card px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border" />
          </div>
        )}

        {tab === 'buzz' && (
          <div className="flex flex-wrap items-center gap-1">
            {BUZZ_SOURCES.map(s => (
              <button key={s.id} onClick={() => setBuzzSource(s.id)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xxs font-medium transition-colors',
                  buzzSource === s.id ? 'border-transparent text-text-primary' : 'border-border text-text-muted hover:text-text-secondary',
                )}
                style={buzzSource === s.id ? { background: `${s.color}22`, color: s.color } : undefined}>
                {s.icon}{s.label}
                <span className="tabular-nums opacity-70">{buzzCounts[s.id]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tabError && (
          <div className="mx-auto mb-3 max-w-4xl rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {friendlyError(tabError, 'the news service')}
          </div>
        )}

        {isLoading && !loaded[tab] ? <ListSkeletons /> : (
          <div className="mx-auto max-w-4xl">
            <TopStrip picks={topPicks} />

            {(tab === 'feed' && feedSources.length > 0) && <div className="mb-4"><SourceBar sources={feedSources} /></div>}
            {(tab === 'buzz' && buzzSources.length > 0) && <div className="mb-4"><SourceBar sources={buzzSources} /></div>}

            {heroStory && <HeroShowcase story={heroStory} sample={heroIsSample} />}

            {/* FEED lanes */}
            {tab === 'feed' && feedLanes.map(lane => (
              <section key={lane.cat}>
                <LaneHeader color={CATEGORY_ACCENT[lane.cat]} label={CATEGORY_LABEL[lane.cat]} count={lane.items.length} />
                {lane.items.map(a => <ArticleRow key={a.id} article={a} />)}
              </section>
            ))}

            {/* GITHUB list */}
            {tab === 'github' && repoRest.length > 0 && (
              <section>
                <LaneHeader color="#2dd4bf" label="Trending" count={repoRest.length} />
                {repoRest.map(r => <RepoRow key={r.id} repo={r} />)}
              </section>
            )}

            {/* BUZZ lanes */}
            {tab === 'buzz' && buzzLanes.map(lane => (
              <section key={lane.src}>
                <LaneHeader color={BUZZ_COLOR[lane.src]} label={BUZZ_LABEL[lane.src]} count={lane.items.length} />
                {lane.items.map(b => <BuzzRow key={b.id} item={b} />)}
              </section>
            ))}
            {tab === 'buzz' && loaded.buzz && buzz.length > 0 && filteredBuzz.length === 0 && (
              <div className="py-16 text-center text-sm text-text-secondary">
                No threads from {buzzSource === 'all' ? 'any source' : BUZZ_LABEL[buzzSource]} right now.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
