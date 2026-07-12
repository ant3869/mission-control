import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  API_BASE_CHANGED_EVENT,
  ApiError,
  apiFetch,
  clearApiBaseUrl,
  getApiBaseUrl,
  setApiBaseUrl,
  validateApiBase,
} from '../lib/apiTransport.js'
import { isNativeApp, onAppResume } from '../lib/native'

export type ConnectionStatus = 'checking' | 'online' | 'degraded' | 'offline' | 'misconfigured'

export interface HealthPayload {
  ok: boolean
  ts: string
  hostname: string
  version: string
}

export interface ServerProbe {
  health: HealthPayload
  latencyMs: number
  baseUrl: string
}

export interface ServerConnectionValue {
  status: ConnectionStatus
  baseUrl: string
  health: HealthPayload | null
  latencyMs: number | null
  error: string
  retry(): Promise<void>
  test(candidate: string): Promise<ServerProbe>
  save(candidate: string): Promise<ServerProbe>
  reset(): void
}

const ServerConnectionContext = createContext<ServerConnectionValue | null>(null)

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function connectionMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Unable to reach the Mission Control server.'
}

async function probeBase(baseUrl: string): Promise<ServerProbe> {
  const started = performance.now()
  const health = await apiFetch<HealthPayload>('/api/health', {}, { baseUrl, timeoutMs: 8_000 })
  return {
    health,
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
    baseUrl,
  }
}

export function ServerConnectionProvider({ children }: { children: ReactNode }) {
  const [baseUrl, setBaseUrlState] = useState(() => getApiBaseUrl())
  const [status, setStatus] = useState<ConnectionStatus>(() => (
    isNativeApp() && !getApiBaseUrl() ? 'misconfigured' : 'checking'
  ))
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [error, setError] = useState('')
  const healthRef = useRef<HealthPayload | null>(null)

  const applyProbe = useCallback((probe: ServerProbe) => {
    healthRef.current = probe.health
    setHealth(probe.health)
    setLatencyMs(probe.latencyMs)
    setBaseUrlState(probe.baseUrl)
    setError('')
    setStatus('online')
  }, [])

  const retry = useCallback(async () => {
    const nextBase = getApiBaseUrl()
    setBaseUrlState(nextBase)
    if (isNativeApp() && !nextBase) {
      setStatus('misconfigured')
      setError('Choose the Mission Control server URL.')
      return
    }

    setStatus(prev => prev === 'online' ? 'checking' : prev)
    try {
      applyProbe(await probeBase(nextBase))
    } catch (err) {
      setError(connectionMessage(err))
      setStatus(healthRef.current ? 'degraded' : 'offline')
    }
  }, [applyProbe])

  const test = useCallback(async (candidate: string) => {
    const result = validateApiBase(candidate)
    if (!result.ok) throw new ApiError('configuration', result.error)
    return probeBase(result.value)
  }, [])

  const save = useCallback(async (candidate: string) => {
    const probe = await test(candidate)
    setApiBaseUrl(probe.baseUrl)
    applyProbe(probe)
    return probe
  }, [applyProbe, test])

  const reset = useCallback(() => {
    clearApiBaseUrl()
    const nextBase = getApiBaseUrl()
    setBaseUrlState(nextBase)
    setError('')
    if (isNativeApp() && !nextBase) {
      setStatus('misconfigured')
      return
    }
    setStatus('checking')
    void retry()
  }, [retry])

  useEffect(() => {
    void retry()

    const poll = window.setInterval(() => {
      if (isVisible()) void retry()
    }, 30_000)
    const refresh = () => { if (isVisible()) void retry() }
    const visibility = () => { if (isVisible()) void retry() }
    const offline = () => {
      setError('This device is offline.')
      setStatus(healthRef.current ? 'degraded' : 'offline')
    }

    window.addEventListener('online', refresh)
    window.addEventListener('offline', offline)
    window.addEventListener(API_BASE_CHANGED_EVENT, refresh)
    document.addEventListener('visibilitychange', visibility)
    const removeResume = onAppResume(refresh)

    return () => {
      window.clearInterval(poll)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', offline)
      window.removeEventListener(API_BASE_CHANGED_EVENT, refresh)
      document.removeEventListener('visibilitychange', visibility)
      removeResume()
    }
  }, [retry])

  const value = useMemo<ServerConnectionValue>(() => ({
    status,
    baseUrl,
    health,
    latencyMs,
    error,
    retry,
    test,
    save,
    reset,
  }), [baseUrl, error, health, latencyMs, reset, retry, save, status, test])

  return (
    <ServerConnectionContext.Provider value={value}>
      {children}
    </ServerConnectionContext.Provider>
  )
}

export function useServerConnection(): ServerConnectionValue {
  const value = useContext(ServerConnectionContext)
  if (!value) throw new Error('useServerConnection must be used inside ServerConnectionProvider')
  return value
}
