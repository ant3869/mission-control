import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  Settings as SettingsIcon, RefreshCw, AlertCircle, CheckCircle2, XCircle,
  Loader, Plug, KeyRound, Save, Zap,
} from 'lucide-react'
import {
  settings as settingsApi, auth as authApi,
  type ConnectorInfo, type ConnectorId, type AuthStatus,
} from '../lib/api'

// ─── Status pill ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  connected:  { label: 'Connected',  cls: 'bg-green-950/50 border-green-900/50 text-green-400', icon: <CheckCircle2 size={11} /> },
  error:      { label: 'Error',      cls: 'bg-red-950/50 border-red-900/50 text-red-400',       icon: <XCircle size={11} /> },
  incomplete: { label: 'Incomplete', cls: 'bg-amber-950/50 border-amber-900/50 text-amber-300', icon: <AlertCircle size={11} /> },
  disabled:   { label: 'Disabled',   cls: 'bg-card border-border text-text-muted',              icon: <Plug size={11} /> },
}

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.disabled
  return (
    <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs font-semibold', cfg.cls)}>
      {cfg.icon}{cfg.label}
    </span>
  )
}

// ─── Connector card ─────────────────────────────────────────────────────────

const CONNECTOR_META: Record<ConnectorId, { icon: string; blurb: string; urlHint: string }> = {
  openclaw: {
    icon: '🐾',
    blurb: 'Pull sessions, agents and cron jobs from your OpenClaw gateway over WebSocket. Use the gateway token (config: gateway.auth.token).',
    urlHint: 'ws://127.0.0.1:18789',
  },
  hermes: {
    icon: '☤',
    blurb: 'Pull sessions, agents, cron jobs and analytics from your Hermes gateway.',
    urlHint: 'http://127.0.0.1:9119',
  },
}

function ConnectorCard({ info, onSaved }: { info: ConnectorInfo; onSaved: () => void }) {
  const meta = CONNECTOR_META[info.id]
  const [baseUrl, setBaseUrl] = useState(info.baseUrl)
  const [token, setToken]     = useState('')
  const [enabled, setEnabled] = useState(info.enabled)
  // Hermes-only: separate API server URL + Bearer key. Other connectors leave
  // these unused.
  const [apiBaseUrl, setApiBaseUrl] = useState(info.apiBaseUrl ?? '')
  const [apiToken, setApiToken]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null)
  const [apiProbe, setApiProbe] = useState<{ ok: boolean; reachable: boolean; latencyMs: number; modelCount: number | null; error: string | null; baseUrl: string; models?: string[] } | null>(null)

  // Keep local form synced when parent reloads (but don't clobber an in-progress edit of token)
  useEffect(() => {
    setBaseUrl(info.baseUrl)
    setEnabled(info.enabled)
    setApiBaseUrl(info.apiBaseUrl ?? '')
  }, [info.baseUrl, info.enabled, info.apiBaseUrl])

  const isHermes = info.id === 'hermes'
  const dirty = baseUrl !== info.baseUrl || enabled !== info.enabled || token.trim() !== ''
    || (isHermes && (apiBaseUrl !== (info.apiBaseUrl ?? '') || apiToken.trim() !== ''))

  const persist = async () => {
    const body: { baseUrl: string; enabled: boolean; token?: string; apiBaseUrl?: string; apiToken?: string } = { baseUrl, enabled }
    if (token.trim()) body.token = token.trim()
    if (isHermes) {
      if (apiBaseUrl !== (info.apiBaseUrl ?? '')) body.apiBaseUrl = apiBaseUrl
      if (apiToken.trim()) body.apiToken = apiToken.trim()
    }
    await settingsApi.update(info.id, body)
    setToken(''); setApiToken('')
  }

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      await persist()
      setMsg({ ok: true, text: 'Saved' })
      onSaved()
    } catch (err: any) {
      setMsg({ ok: false, text: err.message ?? 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setMsg(null)
    setApiProbe(null)
    try {
      // Test the *current* form values — save any unsaved edits first so the
      // server probes what you actually typed, not the stored config.
      if (dirty) await persist()
      const r = await settingsApi.test(info.id)
      // Surface the API-server probe separately so the user sees that the
      // dashboard *and* the chat API server both work (or which one doesn't).
      if (r.apiServer) {
        setApiProbe({
          ok: r.apiServer.ok,
          reachable: r.apiServer.reachable,
          latencyMs: r.apiServer.latencyMs,
          modelCount: r.apiServer.modelCount,
          error: r.apiServer.error,
          baseUrl: r.apiServer.baseUrl,
          models: r.apiServer.models,
        })
      }
      const dashLine = r.reachable
        ? `Dashboard reachable · ${r.version ?? 'gateway'}${r.activeSessions != null ? ` · ${r.activeSessions} active sessions` : ''} · ${r.latencyMs}ms`
        : `Dashboard unreachable — ${r.error ?? 'no response'}`
      setMsg({ ok: r.ok, text: dashLine })
      onSaved()
    } catch (err: any) {
      setMsg({ ok: false, text: err.message ?? 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-2xl leading-none">{meta.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">{info.label}</h3>
              <StatusPill status={info.status} />
            </div>
            <p className="text-xxs text-text-muted mt-1 leading-relaxed max-w-md">{meta.blurb}</p>
          </div>
        </div>
        <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none">
          <span className="text-xxs text-text-muted">{enabled ? 'Enabled' : 'Disabled'}</span>
          <button
            type="button"
            onClick={() => setEnabled(e => !e)}
            className={clsx('relative w-9 h-5 rounded-full transition-colors', enabled ? 'bg-accent-blue' : 'bg-border')}
          >
            <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', enabled ? 'left-[18px]' : 'left-0.5')} />
          </button>
        </label>
      </div>

      {/* Live status detail */}
      {info.status === 'connected' && (
        <div className="flex items-center gap-3 flex-wrap text-xxs text-green-300 px-3 py-2 rounded-lg bg-green-950/20 border border-green-900/30">
          <span className="flex items-center gap-1"><Zap size={10} /> {info.version ?? 'gateway'}</span>
          {info.activeSessions != null && <span>{info.activeSessions} active sessions</span>}
          {(info.platforms?.length ?? 0) > 0 && (
            <span className="truncate">platforms: {info.platforms!.map(p => p.name).join(', ')}</span>
          )}
          <span className="ml-auto opacity-70">{info.latencyMs}ms</span>
        </div>
      )}
      {info.status === 'error' && info.error && (
        <div className="flex items-center gap-2 text-xxs text-red-300 px-3 py-2 rounded-lg bg-red-950/20 border border-red-900/30">
          <AlertCircle size={11} className="shrink-0" /> {info.error}
        </div>
      )}

      {/* Form */}
      <div className="grid grid-cols-1 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xxs font-medium text-text-muted">
            {isHermes ? 'Dashboard base URL' : 'Gateway base URL'}
            {isHermes && <span className="ml-1 opacity-60">(status / sessions / logs — NOT chat)</span>}
          </span>
          <input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder={meta.urlHint}
            spellCheck={false}
            className="w-full px-3 py-2 rounded-lg bg-base border border-border text-xs font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xxs font-medium text-text-muted flex items-center gap-1">
            <KeyRound size={10} /> {isHermes ? 'Dashboard session token' : 'Session / gateway token'}
            {info.hasToken && <span className="text-text-muted opacity-60">· stored {info.tokenHint}</span>}
          </span>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={info.hasToken ? 'Leave blank to keep current token' : 'Paste token to pull data'}
            spellCheck={false}
            autoComplete="off"
            className="w-full px-3 py-2 rounded-lg bg-base border border-border text-xs font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50"
          />
        </label>

        {isHermes && (
          <>
            <div className="mt-1 px-3 py-2 rounded-md bg-amber-950/15 border border-amber-900/20 text-xxs text-amber-300/90 leading-snug">
              Hermes runs its operator dashboard on one port and a separate
              <span className="font-mono"> OpenAI-compat API server </span>
              on another. The dashboard URL above is for status / sessions / logs only — chat dispatch (POST /v1/chat/completions) must hit the API server below.
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xxs font-medium text-text-muted">API server base URL <span className="opacity-60">(POST /v1/chat/completions, GET /v1/models)</span></span>
              <input
                value={apiBaseUrl}
                onChange={e => setApiBaseUrl(e.target.value)}
                placeholder="http://127.0.0.1:8642/v1"
                spellCheck={false}
                className="w-full px-3 py-2 rounded-lg bg-base border border-border text-xs font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xxs font-medium text-text-muted flex items-center gap-1">
                <KeyRound size={10} /> API server key (Bearer)
                {info.hasApiToken && <span className="text-text-muted opacity-60">· stored {info.apiTokenHint}</span>}
              </span>
              <input
                type="password"
                value={apiToken}
                onChange={e => setApiToken(e.target.value)}
                placeholder={info.hasApiToken ? 'Leave blank to keep current key' : 'Paste HERMES_API_KEY'}
                spellCheck={false}
                autoComplete="off"
                className="w-full px-3 py-2 rounded-lg bg-base border border-border text-xs font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50"
              />
            </label>

            {apiProbe && (
              <div className={clsx(
                'flex items-start gap-2 text-xxs px-3 py-2 rounded-lg border',
                apiProbe.ok
                  ? 'bg-green-950/20 border-green-900/30 text-green-300'
                  : 'bg-red-950/20 border-red-900/30 text-red-300',
              )}>
                {apiProbe.ok
                  ? <CheckCircle2 size={11} className="shrink-0 mt-0.5" />
                  : <AlertCircle size={11} className="shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p className="font-mono truncate">{apiProbe.baseUrl}/models</p>
                  <p className="opacity-80">
                    {apiProbe.ok
                      ? `API server reachable · ${apiProbe.modelCount ?? '?'} model${apiProbe.modelCount === 1 ? '' : 's'} · ${apiProbe.latencyMs}ms`
                      : `${apiProbe.error ?? (apiProbe.reachable ? 'auth failed' : 'unreachable')} · ${apiProbe.latencyMs}ms`}
                  </p>
                  {apiProbe.models && apiProbe.models.length > 0 && (
                    <p className="opacity-70 font-mono truncate mt-0.5">{apiProbe.models.slice(0, 4).join(', ')}{apiProbe.models.length > 4 ? '…' : ''}</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
            dirty
              ? 'border-accent-blue/40 bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25'
              : 'border-border bg-card text-text-muted cursor-not-allowed',
          )}
        >
          {saving ? <Loader size={12} className="animate-spin" /> : <Save size={12} />} Save
        </button>
        <button
          onClick={test}
          disabled={testing || !baseUrl.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs disabled:opacity-50"
        >
          {testing ? <Loader size={12} className="animate-spin" /> : <Plug size={12} />} Test connection
        </button>
        {msg && (
          <span className={clsx('text-xxs ml-1', msg.ok ? 'text-green-400' : 'text-red-400')}>{msg.text}</span>
        )}
      </div>
    </div>
  )
}

// ─── Read-only env credential row ───────────────────────────────────────────

function EnvRow({ name, ok, detail }: { name: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-card">
      <span className="shrink-0">
        {ok ? <CheckCircle2 size={13} className="text-green-400" /> : <XCircle size={13} className="text-text-muted" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-text-primary">{name}</p>
        <p className="text-xxs text-text-muted">{detail}</p>
      </div>
      <span className={clsx('text-xxs', ok ? 'text-green-400' : 'text-text-muted')}>
        {ok ? 'Configured' : 'Not set'}
      </span>
    </div>
  )
}

// ─── Main view ───────────────────────────────────────────────────────────────

export function Settings() {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([])
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [fetchedAt, setFetchedAt]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [c, a] = await Promise.allSettled([settingsApi.connectors(), authApi.status()])
      if (c.status === 'fulfilled') {
        setConnectors(c.value.connectors)
        setFetchedAt(c.value.fetchedAt)
      } else {
        setError(c.reason?.message ?? 'Failed to load connectors')
      }
      if (a.status === 'fulfilled') setAuthStatus(a.value)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const fetchedLabel = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary flex items-center gap-2">
            <SettingsIcon size={16} className="text-text-muted" /> Settings
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            Connect your agent platforms — paste a gateway token to pull sessions, agents, cron jobs and analytics.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {fetchedLabel && <span className="text-xxs text-text-muted">as of {fetchedLabel}</span>}
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 mx-6 mt-4 px-4 py-3 rounded-lg border border-amber-900/40 bg-amber-950/20 text-amber-300">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <p className="text-xs leading-snug">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Agent connectors */}
        <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted mb-3 flex items-center gap-1.5">
          <Plug size={11} /> Agent platforms
        </p>
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[1, 2].map(i => <div key={i} className="h-[300px] rounded-xl bg-card border border-border animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {connectors.map(info => <ConnectorCard key={info.id} info={info} onSaved={load} />)}
          </div>
        )}

        {/* Read-only env credentials */}
        <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted mt-8 mb-3 flex items-center gap-1.5">
          <KeyRound size={11} /> Environment credentials
          <span className="font-normal normal-case tracking-normal opacity-60">· edit in .env, then restart the server</span>
        </p>
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden max-w-2xl">
          <EnvRow
            name="Google OAuth"
            ok={!!authStatus?.google.tokenConfigured}
            detail={authStatus?.google.clientConfigured ? 'Client configured · Calendar access' : 'GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN'}
          />
          <EnvRow
            name="Anthropic API"
            ok={!!authStatus?.anthropic.keyConfigured}
            detail="ANTHROPIC_API_KEY · Radar token & cost analytics"
          />
        </div>
      </div>
    </div>
  )
}
