import { useEffect, useState } from 'react'
import { Bell, Check, Loader2, RefreshCw, Sun } from 'lucide-react'
import { briefingApi, type BriefingPreferences, type DailyBriefing } from '../lib/api'

export function BriefingCard() {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null)
  const [prefs, setPrefs] = useState<BriefingPreferences | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { briefingApi.get().then((data) => { setBriefing(data.briefing); setPrefs(data.preferences); notify(data.briefing, data.preferences) }).catch(() => undefined) }, [])
  const notify = (value: DailyBriefing, preferences: BriefingPreferences) => {
    if (!preferences.browser || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const key = `mc:briefing-notified:${value.date}`; if (localStorage.getItem(key)) return
    new Notification('Daily operations briefing', { body: value.summary }); localStorage.setItem(key, '1')
  }
  const regenerate = async () => { setBusy(true); try { setBriefing((await briefingApi.generate()).briefing) } finally { setBusy(false) } }
  const save = async () => { if (!prefs) return; setBusy(true); setSaved(false); try { const data = await briefingApi.preferences(prefs); setPrefs(data.preferences); setSaved(true); setTimeout(() => setSaved(false), 1200) } finally { setBusy(false) } }
  const toggleBrowser = async () => {
    if (!prefs) return
    let enabled = !prefs.browser
    if (enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') enabled = (await Notification.requestPermission()) === 'granted'
    setPrefs({ ...prefs, browser: enabled })
  }

  if (!briefing || !prefs) return null
  return <section className="mx-auto mt-5 max-w-[1400px] px-5 lg:px-8">
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300"><Sun size={14} />Daily briefing</p><p className="mt-1 text-sm text-text-primary">{briefing.summary}</p></div><button onClick={() => void regenerate()} disabled={busy} className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-card-hover disabled:opacity-40"><RefreshCw size={13} className={busy ? 'animate-spin' : ''} />Refresh</button></div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">{briefing.attention.map((item) => <div key={item} className="rounded border border-border bg-base px-3 py-2 text-xs text-text-secondary">{item}</div>)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-text-secondary">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.enabled} onChange={(event) => setPrefs({ ...prefs, enabled: event.target.checked })} />Daily delivery</label>
        <input type="time" value={prefs.time} onChange={(event) => setPrefs({ ...prefs, time: event.target.value })} className="rounded border border-border bg-base px-2 py-1 text-xs text-text-primary" aria-label="Briefing delivery time" />
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.discord} onChange={(event) => setPrefs({ ...prefs, discord: event.target.checked })} />Discord</label>
        <button onClick={() => void toggleBrowser()} className="flex items-center gap-1.5"><Bell size={12} />Browser {prefs.browser ? 'on' : 'off'}</button>
        <button onClick={() => void save()} disabled={busy} className="ml-auto flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 hover:bg-card-hover disabled:opacity-40">{busy ? <Loader2 size={12} className="animate-spin" /> : saved ? <Check size={12} /> : null}{saved ? 'Saved' : 'Save preferences'}</button>
      </div>
    </div>
  </section>
}
