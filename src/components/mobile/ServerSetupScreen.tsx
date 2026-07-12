import { useState } from 'react'
import { CheckCircle2, Loader2, RadioTower, Server, XCircle } from 'lucide-react'
import { ApiError } from '../../lib/apiTransport.js'
import { useServerConnection, type ServerProbe } from '../../contexts/ServerConnectionContext'

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Unable to reach the Mission Control server.'
}

export function ServerSetupScreen() {
  const connection = useServerConnection()
  const [input, setInput] = useState(connection.baseUrl)
  const [probe, setProbe] = useState<ServerProbe | null>(null)
  const [error, setError] = useState(connection.error)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  const canSave = Boolean(probe && input.trim() === probe.baseUrl)

  const testConnection = async () => {
    setTesting(true)
    setError('')
    try {
      const nextProbe = await connection.test(input)
      setProbe(nextProbe)
      setInput(nextProbe.baseUrl)
    } catch (err) {
      setProbe(null)
      setError(messageFor(err))
    } finally {
      setTesting(false)
    }
  }

  const saveConnection = async () => {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      await connection.save(input)
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full bg-base text-text-primary flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
        <div className="px-5 py-5 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl border border-teal-500/30 bg-teal-500/10 flex items-center justify-center">
              <RadioTower size={22} className="text-teal-300" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-text-muted">Mission Control</p>
              <h1 className="text-xl font-semibold text-text-primary">Connect to your server</h1>
            </div>
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wider text-text-muted mb-2">Server URL</span>
            <input
              value={input}
              onChange={(event) => { setInput(event.target.value); setProbe(null) }}
              placeholder="https://hp-nexco.<your-tailnet>.ts.net"
              className="w-full min-h-11 rounded-lg border border-border bg-base px-3 text-base text-text-primary outline-none focus:border-teal-400"
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="url"
            />
          </label>

          <div className="rounded-lg border border-border bg-base/60 px-3 py-3 text-xs text-text-secondary space-y-1.5">
            <p>Preferred: <span className="font-mono text-teal-300">https://hp-nexco.&lt;your-tailnet&gt;.ts.net</span></p>
            <p>Trusted LAN fallback: <span className="font-mono text-amber-300">http://192.168.x.x:3001</span></p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void testConnection()}
              disabled={testing || !input.trim()}
              className="min-h-11 flex-1 rounded-lg border border-border bg-card px-4 text-sm font-medium text-text-primary hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testing ? <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Testing</span> : 'Test connection'}
            </button>
            <button
              type="button"
              onClick={() => void saveConnection()}
              disabled={!canSave || saving}
              className="min-h-11 flex-1 rounded-lg bg-teal-500 px-4 text-sm font-semibold text-black hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save and open Mission Control'}
            </button>
          </div>

          {probe && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={16} className="text-green-300 mt-0.5" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-green-200">Connection successful</p>
                  <p className="mt-1 text-xs text-green-100/80">
                    {probe.health.hostname || 'Mission Control'} | API {probe.health.ok ? 'ok' : 'unknown'} | v{probe.health.version || 'unknown'} | {probe.latencyMs}ms
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3">
              <div className="flex items-start gap-2">
                <XCircle size={16} className="text-red-300 mt-0.5" />
                <p className="text-sm text-red-100">{error}</p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-text-muted">
            <Server size={14} className="mt-0.5 shrink-0" />
            <p>The Android app stores only this server origin. Keep the Express API private behind Tailscale Serve or your trusted LAN.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
