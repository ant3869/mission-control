import { Router } from 'express'

export const newsRouter = Router()

/**
 * News aggregation — three real-time, key-free sources:
 *   • /feed   — curated RSS/Atom feeds (AI, computing, code, robotics)
 *   • /github — trending new repositories via the GitHub search API
 *   • /buzz   — what's stirring on Hacker News + Reddit (the open social pulse)
 *
 * Everything is fetched live and cached in-memory for a short TTL so the UI is
 * snappy and we stay polite to upstream services. On upstream failure we serve
 * the last good payload (stale-while-error) instead of blanking the view.
 */

// ─── Categories + feed catalog ──────────────────────────────────────────────

export type NewsCategory = 'ai' | 'computing' | 'code' | 'robotics'

interface FeedSource {
  name:     string
  url:      string
  category: NewsCategory
}

const FEEDS: FeedSource[] = [
  // ── AI ──
  { name: 'Hugging Face',      url: 'https://huggingface.co/blog/feed.xml',                       category: 'ai' },
  { name: 'OpenAI',            url: 'https://openai.com/news/rss.xml',                            category: 'ai' },
  { name: 'Google AI Blog',    url: 'https://blog.google/technology/ai/rss/',                     category: 'ai' },
  { name: 'BAIR (Berkeley)',   url: 'https://bair.berkeley.edu/blog/feed.xml',                    category: 'ai' },
  { name: 'MIT Tech Review AI',url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', category: 'ai' },
  { name: 'VentureBeat AI',    url: 'https://venturebeat.com/category/ai/feed/',                  category: 'ai' },
  // ── Computing / tech ──
  { name: 'Ars Technica',      url: 'https://feeds.arstechnica.com/arstechnica/index',            category: 'computing' },
  { name: 'The Verge',         url: 'https://www.theverge.com/rss/index.xml',                     category: 'computing' },
  { name: 'TechCrunch',        url: 'https://techcrunch.com/feed/',                               category: 'computing' },
  { name: 'Wired',             url: 'https://www.wired.com/feed/rss',                             category: 'computing' },
  // ── Code / dev ──
  { name: 'The GitHub Blog',   url: 'https://github.blog/feed/',                                  category: 'code' },
  { name: 'Stack Overflow',    url: 'https://stackoverflow.blog/feed/',                           category: 'code' },
  { name: 'DEV Community',     url: 'https://dev.to/feed',                                        category: 'code' },
  { name: 'Hacker News',       url: 'https://hnrss.org/frontpage',                                category: 'code' },
  // ── Robotics ──
  { name: 'IEEE Spectrum',     url: 'https://spectrum.ieee.org/feeds/topic/robotics.rss',         category: 'robotics' },
  { name: 'The Robot Report',  url: 'https://www.therobotreport.com/feed/',                       category: 'robotics' },
  { name: 'TechCrunch Robotics',url: 'https://techcrunch.com/tag/robotics/feed/',                 category: 'robotics' },
]

const REDDIT_SUBS = ['MachineLearning', 'LocalLLaMA', 'artificial', 'programming', 'robotics', 'technology']

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NewsArticle {
  id:        string
  title:     string
  url:       string
  summary:   string
  source:    string
  category:  NewsCategory
  domain:    string
  favicon:   string
  image:     string
  publishedAt: string
  publishedAgo: string
}

export interface GithubRepo {
  id:          string
  name:        string
  owner:       string
  fullName:    string
  url:         string
  description: string
  language:    string | null
  stars:       number
  forks:       number
  topics:      string[]
  avatar:      string
  createdAgo:  string
  pushedAgo:   string
}

export type BuzzSource = 'hackernews' | 'reddit' | 'lobsters'

export interface BuzzItem {
  id:          string
  title:       string
  url:         string
  source:      BuzzSource
  origin:      string        // "Hacker News" | "r/MachineLearning" | "Lobsters"
  score:       number
  comments:    number
  commentsUrl: string
  domain:      string
  image:       string
  postedAt:    string
  postedAgo:   string
}

// ─── Small utilities ─────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const mins = Math.floor((Date.now() - t) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function faviconFor(url: string): string {
  const domain = domainOf(url)
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : ''
}

async function fetchText(url: string, timeoutMs = 8_000, headers: Record<string, string> = {}): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MissionControl/1.0 (+news-aggregator)', Accept: '*/*', ...headers },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson<T>(url: string, timeoutMs = 8_000, headers: Record<string, string> = {}): Promise<T> {
  const text = await fetchText(url, timeoutMs, { Accept: 'application/json', ...headers })
  return JSON.parse(text) as T
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
}

function stripHtml(input: string): string {
  // Decode first so entity-encoded markup (e.g. DEV.to's &lt;p&gt;) becomes real
  // tags, then strip all tags, then decode again for any plain entities (&amp;).
  const decoded = decodeEntities(input)
  const noTags = decoded.replace(/<[^>]*>/g, ' ')
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim()
}

function clip(text: string, max = 240): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`
}

// ─── RSS / Atom parsing (dependency-free) ─────────────────────────────────────

function unwrapCdata(raw: string): string {
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  return cdata ? cdata[1] : raw
}

function tagContent(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  return match ? unwrapCdata(match[1]).trim() : ''
}

function validImageUrl(raw: string): string {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function extractImage(block: string): string {
  // 1. media RSS extensions (The Verge, Wired, TechCrunch, …)
  const media = block.match(/<media:(?:content|thumbnail)[^>]*url=["']([^"']+)["']/i)
  if (media) return validImageUrl(media[1])
  // 2. image enclosures
  const enclosure = block.match(/<enclosure[^>]*type=["']image\/[^"']*["'][^>]*url=["']([^"']+)["']/i)
    ?? block.match(/<enclosure[^>]*url=["']([^"']+\.(?:jpe?g|png|webp|gif)[^"']*)["']/i)
  if (enclosure) return validImageUrl(enclosure[1])
  // 3. first <img> inside the (possibly entity-encoded) body
  const body = tagContent(block, 'content:encoded') || tagContent(block, 'description') || tagContent(block, 'content')
  const img = decodeEntities(body).match(/<img[^>]*src=["']([^"']+)["']/i)
  if (img) return validImageUrl(img[1])
  return ''
}

function extractLink(block: string): string {
  // RSS: <link>https://…</link>  — Atom: <link rel="alternate" href="https://…"/>
  const rss = block.match(/<link>([\s\S]*?)<\/link>/i)
  if (rss && rss[1].trim()) return unwrapCdata(rss[1]).trim()
  const alternate = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
  if (alternate) return alternate[1]
  const anyHref = block.match(/<link[^>]*href=["']([^"']+)["']/i)
  return anyHref ? anyHref[1] : ''
}

function parseFeed(xml: string, feed: FeedSource): NewsArticle[] {
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) ?? []
  const articles: NewsArticle[] = []
  for (const block of blocks) {
    const title = stripHtml(tagContent(block, 'title'))
    const url = extractLink(block).trim()
    if (!title || !url) continue
    const rawDate =
      tagContent(block, 'pubDate') ||
      tagContent(block, 'published') ||
      tagContent(block, 'updated') ||
      tagContent(block, 'dc:date')
    const parsed = rawDate ? new Date(rawDate) : null
    const publishedAt = parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : ''
    const summaryRaw =
      tagContent(block, 'description') ||
      tagContent(block, 'summary') ||
      tagContent(block, 'content:encoded') ||
      tagContent(block, 'content')
    articles.push({
      id: url,
      title,
      url,
      summary: clip(stripHtml(summaryRaw)),
      source: feed.name,
      category: feed.category,
      domain: domainOf(url),
      favicon: faviconFor(url),
      image: extractImage(block),
      publishedAt,
      publishedAgo: publishedAt ? timeAgo(publishedAt) : '',
    })
  }
  return articles
}

// ─── In-memory cache (stale-while-error) ──────────────────────────────────────

interface CacheEntry<T> { data: T; expires: number }
const cache = new Map<string, CacheEntry<unknown>>()

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<{ data: T; cached: boolean }> {
  const hit = cache.get(key) as CacheEntry<T> | undefined
  if (hit && hit.expires > Date.now()) return { data: hit.data, cached: true }
  try {
    const data = await loader()
    cache.set(key, { data, expires: Date.now() + ttlMs })
    return { data, cached: false }
  } catch (err) {
    if (hit) return { data: hit.data, cached: true } // serve stale rather than fail
    throw err
  }
}

// ─── /feed — curated RSS aggregation ───────────────────────────────────────────

async function loadFeed(): Promise<{ articles: NewsArticle[]; sources: Array<{ name: string; ok: boolean; count: number }> }> {
  const results = await Promise.allSettled(
    FEEDS.map(async feed => ({ feed, xml: await fetchText(feed.url) })),
  )

  const articles: NewsArticle[] = []
  const sources: Array<{ name: string; ok: boolean; count: number }> = []
  results.forEach((result, i) => {
    const feed = FEEDS[i]
    if (result.status === 'fulfilled') {
      const parsed = parseFeed(result.value.xml, feed)
      sources.push({ name: feed.name, ok: parsed.length > 0, count: parsed.length })
      articles.push(...parsed)
    } else {
      sources.push({ name: feed.name, ok: false, count: 0 })
    }
  })

  // De-dupe by URL, then sort newest first (undated items sink to the bottom).
  const seen = new Set<string>()
  const deduped = articles.filter(a => {
    const key = a.url.replace(/[#?].*$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  deduped.sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
    return tb - ta
  })

  return { articles: deduped.slice(0, 120), sources }
}

newsRouter.get('/feed', async (_req, res) => {
  try {
    const { data, cached: fromCache } = await cached('feed', 5 * 60_000, loadFeed)
    res.json({ ...data, fetchedAt: new Date().toISOString(), cached: fromCache })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load news feed', articles: [], sources: [] })
  }
})

// ─── /github — trending new repositories ───────────────────────────────────────

interface GithubSearchResponse {
  items: Array<{
    id:               number
    name:             string
    full_name:        string
    html_url:         string
    description:      string | null
    language:         string | null
    stargazers_count: number
    forks_count:      number
    topics?:          string[]
    created_at:       string
    pushed_at:        string
    owner:            { login: string; avatar_url: string }
  }>
}

async function loadGithub(since: 'daily' | 'weekly' | 'monthly', language: string): Promise<GithubRepo[]> {
  const windowDays = since === 'daily' ? 2 : since === 'weekly' ? 7 : 30
  const sinceDate = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10)
  let q = `created:>${sinceDate}`
  if (language) q += ` language:${language}`
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`

  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

  const data = await fetchJson<GithubSearchResponse>(url, 8_000, headers)
  return (data.items ?? []).map(repo => ({
    id: String(repo.id),
    name: repo.name,
    owner: repo.owner.login,
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description ?? '',
    language: repo.language,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    topics: (repo.topics ?? []).slice(0, 6),
    avatar: repo.owner.avatar_url,
    createdAgo: timeAgo(repo.created_at),
    pushedAgo: timeAgo(repo.pushed_at),
  }))
}

newsRouter.get('/github', async (req, res) => {
  const since = (['daily', 'weekly', 'monthly'].includes(String(req.query.since)) ? req.query.since : 'weekly') as 'daily' | 'weekly' | 'monthly'
  const language = String(req.query.lang ?? '').trim().toLowerCase().replace(/[^a-z0-9+#.-]/g, '')
  try {
    const { data, cached: fromCache } = await cached(`github:${since}:${language}`, 10 * 60_000, () => loadGithub(since, language))
    res.json({ repos: data, since, language, fetchedAt: new Date().toISOString(), cached: fromCache })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load GitHub trending', repos: [] })
  }
})

// ─── /buzz — Hacker News + Reddit social pulse ─────────────────────────────────

interface HnSearchResponse {
  hits: Array<{
    objectID:     string
    title:        string | null
    url:          string | null
    points:       number | null
    num_comments: number | null
    created_at:   string
  }>
}

interface RedditListing {
  data: {
    children: Array<{
      data: {
        id:           string
        title:        string
        url:          string
        permalink:    string
        score:        number
        num_comments: number
        created_utc:  number
        subreddit:    string
        stickied:     boolean
        over_18:      boolean
        thumbnail?:   string
        preview?:     { images?: Array<{ source?: { url?: string } }> }
      }
    }>
  }
}

async function loadHackerNews(): Promise<BuzzItem[]> {
  const data = await fetchJson<HnSearchResponse>('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30')
  return (data.hits ?? [])
    .filter(hit => hit.title)
    .map(hit => {
      const commentsUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`
      const url = hit.url || commentsUrl
      return {
        id: `hn:${hit.objectID}`,
        title: hit.title as string,
        url,
        source: 'hackernews' as const,
        origin: 'Hacker News',
        score: hit.points ?? 0,
        comments: hit.num_comments ?? 0,
        commentsUrl,
        domain: domainOf(url),
        image: '',
        postedAt: hit.created_at,
        postedAgo: timeAgo(hit.created_at),
      }
    })
}

async function loadReddit(): Promise<BuzzItem[]> {
  const results = await Promise.allSettled(
    REDDIT_SUBS.map(sub => fetchJson<RedditListing>(`https://www.reddit.com/r/${sub}/hot.json?limit=8&raw_json=1`)),
  )
  const items: BuzzItem[] = []
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const child of result.value.data?.children ?? []) {
      const p = child.data
      if (p.stickied || p.over_18) continue
      const commentsUrl = `https://www.reddit.com${p.permalink}`
      const url = p.url || commentsUrl
      const postedAt = new Date(p.created_utc * 1000).toISOString()
      const preview = p.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&') ?? ''
      const thumb = p.thumbnail && /^https?:\/\//.test(p.thumbnail) ? p.thumbnail : ''
      items.push({
        id: `reddit:${p.id}`,
        title: p.title,
        url,
        source: 'reddit',
        origin: `r/${p.subreddit}`,
        score: p.score,
        comments: p.num_comments,
        commentsUrl,
        domain: domainOf(url),
        image: validImageUrl(preview || thumb),
        postedAt,
        postedAgo: timeAgo(postedAt),
      })
    }
  }
  return items
}

interface LobstersStory {
  short_id:      string
  title:         string
  url:           string
  score:         number
  comment_count: number
  comments_url:  string
  created_at:    string
  tags?:         string[]
}

async function loadLobsters(): Promise<BuzzItem[]> {
  const data = await fetchJson<LobstersStory[]>('https://lobste.rs/hottest.json')
  return (Array.isArray(data) ? data : [])
    .filter(s => s.title)
    .map(s => {
      const url = s.url || s.comments_url
      const postedAt = new Date(s.created_at).toISOString()
      return {
        id: `lobsters:${s.short_id}`,
        title: s.title,
        url,
        source: 'lobsters' as const,
        origin: 'Lobsters',
        score: s.score ?? 0,
        comments: s.comment_count ?? 0,
        commentsUrl: s.comments_url,
        domain: domainOf(url),
        image: '',
        postedAt,
        postedAgo: timeAgo(postedAt),
      }
    })
}

async function loadBuzz(): Promise<{ items: BuzzItem[]; sources: Array<{ name: string; ok: boolean; count: number }> }> {
  const [hn, reddit, lobsters] = await Promise.allSettled([loadHackerNews(), loadReddit(), loadLobsters()])
  const items: BuzzItem[] = []
  const sources: Array<{ name: string; ok: boolean; count: number }> = []

  if (hn.status === 'fulfilled') { items.push(...hn.value); sources.push({ name: 'Hacker News', ok: true, count: hn.value.length }) }
  else sources.push({ name: 'Hacker News', ok: false, count: 0 })

  if (reddit.status === 'fulfilled') { items.push(...reddit.value); sources.push({ name: 'Reddit', ok: true, count: reddit.value.length }) }
  else sources.push({ name: 'Reddit', ok: false, count: 0 })

  if (lobsters.status === 'fulfilled') { items.push(...lobsters.value); sources.push({ name: 'Lobsters', ok: true, count: lobsters.value.length }) }
  else sources.push({ name: 'Lobsters', ok: false, count: 0 })

  // Rank by a light "heat" score: engagement, decayed by age so fresh stays on top.
  const now = Date.now()
  items.sort((a, b) => {
    const heat = (it: BuzzItem) => {
      const ageH = Math.max(1, (now - new Date(it.postedAt).getTime()) / 3_600_000)
      return (it.score + it.comments * 2) / Math.pow(ageH, 0.7)
    }
    return heat(b) - heat(a)
  })

  return { items: items.slice(0, 60), sources }
}

newsRouter.get('/buzz', async (_req, res) => {
  try {
    const { data, cached: fromCache } = await cached('buzz', 5 * 60_000, loadBuzz)
    res.json({ ...data, fetchedAt: new Date().toISOString(), cached: fromCache })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load buzz', items: [], sources: [] })
  }
})
