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
  baseUrl:      string
  token:        string
  enabled:      boolean
  workspaceDir?: string  // optional: absolute path to the agent's memory workspace dir
}

/** Connector config with the token masked — safe to send to the browser. */
export interface PublicConnectorConfig {
  id:        ConnectorId
  label:     string
  baseUrl:   string
  enabled:   boolean
  hasToken:  boolean
  tokenHint: string
}

const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
const configPath = join(dataDir, 'connectors.json')

// Env fallbacks let you preconfigure a connector via .env without the UI.
const ENV_DEFAULTS: Record<ConnectorId, { baseUrl: string; token: string }> = {
  openclaw: {
    baseUrl: process.env.OPENCLAW_BASE_URL ?? '',
    token:   process.env.OPENCLAW_TOKEN ?? process.env.OPENCLAW_PUSH_TOKEN ?? '',
  },
  hermes: {
    baseUrl: process.env.HERMES_BASE_URL ?? '',
    token:   process.env.HERMES_TOKEN ?? '',
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
    id:        c.id,
    label:     c.label,
    baseUrl:   c.baseUrl,
    enabled:   c.enabled,
    hasToken:  !!c.token,
    tokenHint: c.token ? maskSecret(c.token) : '',
  }
}

export type ConnectorPatch = Partial<Pick<ConnectorConfig, 'baseUrl' | 'token' | 'enabled'>>

export function saveConnector(id: ConnectorId, patch: ConnectorPatch): ConnectorConfig {
  const current = cache[id] ?? defaults()[id]
  const next: ConnectorConfig = { ...current, id, label: current.label }

  if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl.trim().replace(/\/+$/, '')
  if (patch.enabled !== undefined) next.enabled = patch.enabled
  // Empty-string token means "leave unchanged"; an explicit null clears it.
  // A value starting with the mask char (••••) is the redacted hint echoed
  // back by a client — never store it, or the gateway will 401 every request.
  const tokenPatch = typeof patch.token === 'string' ? patch.token.trim() : patch.token
  if (typeof tokenPatch === 'string' && tokenPatch && !tokenPatch.startsWith('••••')) next.token = tokenPatch
  if (patch.token === null as unknown as string) next.token = ''

  cache[id] = next
  persist()
  return next
}
