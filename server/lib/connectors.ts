// title: Agent connector configuration store
// path: server/lib/connectors.ts
// purpose: Persist per-source gateway connection settings (base URL + token +
//          enabled) for OpenClaw and Hermes. Tokens stay server-side; the
//          Settings UI only ever receives masked values.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { maskSecret } from './redact.js'

export type ConnectorId = 'openclaw' | 'hermes'

export interface ConnectorConfig {
  id:           ConnectorId
  label:        string
  baseUrl:      string         // Dashboard URL (Hermes /api/*, OpenClaw /ws)
  token:        string         // Dashboard / gateway token
  enabled:      boolean
  workspaceDir?: string        // optional: absolute path to the agent's memory workspace dir
  // ── Hermes only ────────────────────────────────────────────────────────────
  // Hermes runs the operator dashboard on one port and a separate OpenAI-compat
  // API server (POST /v1/chat/completions, GET /v1/models, …) on another. The
  // dashboard URL above is correct for status/sessions/logs/cron, but it does
  // NOT accept chat requests — those must hit the API server below.
  apiBaseUrl?:  string         // e.g. http://127.0.0.1:8642/v1
  apiToken?:    string         // Bearer key for the API server
}

/** Connector config with secrets masked — safe to send to the browser. */
export interface PublicConnectorConfig {
  id:            ConnectorId
  label:         string
  baseUrl:       string
  enabled:       boolean
  hasToken:      boolean
  tokenHint:     string
  apiBaseUrl:    string
  hasApiToken:   boolean
  apiTokenHint:  string
}

const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
const configPath = join(dataDir, 'connectors.json')

// Env fallbacks let you preconfigure a connector via .env without the UI.
// The Hermes API server is a separate service from the operator dashboard —
// default to the canonical localhost API server URL so OpenAI-compat chat
// works out of the box once HERMES_API_KEY is set.
const ENV_DEFAULTS: Record<ConnectorId, { baseUrl: string; token: string; apiBaseUrl?: string; apiToken?: string }> = {
  openclaw: {
    baseUrl: process.env.OPENCLAW_BASE_URL ?? '',
    token:   process.env.OPENCLAW_TOKEN ?? process.env.OPENCLAW_PUSH_TOKEN ?? '',
  },
  hermes: {
    baseUrl: process.env.HERMES_BASE_URL ?? '',
    token:   process.env.HERMES_TOKEN ?? '',
    apiBaseUrl: process.env.HERMES_API_BASE_URL ?? 'http://127.0.0.1:8642/v1',
    apiToken:   process.env.HERMES_API_KEY ?? process.env.HERMES_API_SERVER_KEY ?? '',
  },
}

function defaults(): Record<ConnectorId, ConnectorConfig> {
  return {
    openclaw: {
      id: 'openclaw', label: 'OpenClaw',
      baseUrl: ENV_DEFAULTS.openclaw.baseUrl,
      token:   ENV_DEFAULTS.openclaw.token,
      enabled: false,
    },
    hermes: {
      id: 'hermes', label: 'Hermes',
      baseUrl: ENV_DEFAULTS.hermes.baseUrl,
      token:   ENV_DEFAULTS.hermes.token,
      enabled: false,
      apiBaseUrl: ENV_DEFAULTS.hermes.apiBaseUrl ?? '',
      apiToken:   ENV_DEFAULTS.hermes.apiToken ?? '',
    },
  }
}

function load(): Record<ConnectorId, ConnectorConfig> {
  const base = defaults()
  try {
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<
        Record<ConnectorId, Partial<ConnectorConfig>>
      >
      for (const id of ['openclaw', 'hermes'] as ConnectorId[]) {
        if (raw[id]) base[id] = { ...base[id], ...raw[id], id, label: base[id].label }
      }
    }
  } catch { /* fall back to defaults */ }
  return base
}

let cache = load()

function persist() {
  try {
    writeFileSync(configPath, JSON.stringify(cache, null, 2), 'utf8')
  } catch (err) {
    console.error('Failed to persist connectors.json:', err)
  }
}

export function getConnectors(): ConnectorConfig[] {
  return Object.values(cache)
}

export function getConnector(id: ConnectorId): ConnectorConfig | null {
  return cache[id] ?? null
}

/** A connector is usable for live pull only when enabled with a base URL. */
export function isLive(id: ConnectorId): boolean {
  const c = cache[id]
  return !!(c && c.enabled && c.baseUrl.trim())
}

export function toPublic(c: ConnectorConfig): PublicConnectorConfig {
  return {
    id:           c.id,
    label:        c.label,
    baseUrl:      c.baseUrl,
    enabled:      c.enabled,
    hasToken:     !!c.token,
    tokenHint:    c.token ? maskSecret(c.token) : '',
    apiBaseUrl:   c.apiBaseUrl ?? '',
    hasApiToken:  !!c.apiToken,
    apiTokenHint: c.apiToken ? maskSecret(c.apiToken) : '',
  }
}

export type ConnectorPatch = Partial<Pick<ConnectorConfig, 'baseUrl' | 'token' | 'enabled' | 'apiBaseUrl' | 'apiToken'>>

export function saveConnector(id: ConnectorId, patch: ConnectorPatch): ConnectorConfig {
  const current = cache[id] ?? defaults()[id]
  const next: ConnectorConfig = { ...current, id, label: current.label }

  if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl.trim().replace(/\/+$/, '')
  if (patch.enabled !== undefined) next.enabled = patch.enabled
  // Empty-string token means "leave unchanged"; an explicit null clears it.
  // A value starting with the mask char (••••) is the redacted hint echoed back
  // by the UI — never store it, or the gateway will 401 on every request.
  const tokenPatch = typeof patch.token === 'string' ? patch.token.trim() : patch.token
  if (typeof tokenPatch === 'string' && tokenPatch && !tokenPatch.startsWith('••••')) next.token = tokenPatch
  if (patch.token === null as unknown as string) next.token = ''

  // Hermes API server (separate from the dashboard). Same masking rule for the key.
  if (patch.apiBaseUrl !== undefined) next.apiBaseUrl = patch.apiBaseUrl.trim().replace(/\/+$/, '')
  const apiTokenPatch = typeof patch.apiToken === 'string' ? patch.apiToken.trim() : patch.apiToken
  if (typeof apiTokenPatch === 'string' && apiTokenPatch && !apiTokenPatch.startsWith('••••')) next.apiToken = apiTokenPatch
  if (patch.apiToken === null as unknown as string) next.apiToken = ''

  cache[id] = next
  persist()
  return next
}
