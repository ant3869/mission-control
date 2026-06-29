import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, Loader, ShieldCheck } from 'lucide-react'
import { sessionApi } from '../lib/api'
import { authScreen, type SessionStatus } from './authState'

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [token, setToken] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => sessionApi.status()
    .then(setStatus)
    .catch(() => setError('Cannot reach the Mission Control API.'))

  useEffect(() => { void refresh() }, [])

  async function submit(event: FormEvent, mode: 'token' | 'pair') {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      if (mode === 'token') await sessionApi.login(token)
      else await sessionApi.pair(pairingCode)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authentication failed')
    } finally { setBusy(false) }
  }

  const screen = authScreen(status)
  if (screen === 'ready') return children
  if (screen === 'loading' && !error) {
    return <div className="h-full grid place-items-center bg-base text-text-muted"><Loader size={18} className="animate-spin" /></div>
  }

  return (
    <main className="h-full grid place-items-center bg-base p-6">
      <section className="w-full max-w-sm rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3 mb-5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-base text-accent-green"><ShieldCheck size={17} /></span>
          <div><h1 className="text-sm font-semibold text-text-primary">Mission Control</h1><p className="text-xs text-text-muted">Authenticate this device</p></div>
        </div>
        <form onSubmit={event => submit(event, 'token')} className="space-y-2">
          <label className="text-xxs uppercase tracking-wider text-text-muted">Dashboard token</label>
          <div className="flex gap-2">
            <input autoFocus type="password" autoComplete="current-password" value={token} onChange={event => setToken(event.target.value)}
              className="min-w-0 flex-1 rounded border border-border bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue" />
            <button disabled={busy || !token} className="rounded border border-accent-blue/40 bg-accent-blue/15 px-3 text-xs text-accent-blue disabled:opacity-40"><KeyRound size={13} /></button>
          </div>
        </form>
        <div className="my-4 flex items-center gap-2 text-xxs text-text-muted"><span className="h-px flex-1 bg-border" />or pair this device<span className="h-px flex-1 bg-border" /></div>
        <form onSubmit={event => submit(event, 'pair')} className="flex gap-2">
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={pairingCode}
            onChange={event => setPairingCode(event.target.value.replace(/\D/g, ''))}
            className="min-w-0 flex-1 rounded border border-border bg-base px-3 py-2 text-center font-mono text-sm tracking-[0.25em] text-text-primary outline-none focus:border-accent-blue" />
          <button disabled={busy || pairingCode.length !== 6} className="rounded border border-border bg-base px-3 text-xs text-text-secondary disabled:opacity-40">Pair</button>
        </form>
        {error && <p className="mt-3 text-xs text-accent-red">{error}</p>}
      </section>
    </main>
  )
}
