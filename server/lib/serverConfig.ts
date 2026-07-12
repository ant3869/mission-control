const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]

export function resolveApiHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.API_HOST?.trim() || '127.0.0.1'
}

export function buildAllowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const configured = env.CORS_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean) ?? []
  return new Set([...DEFAULT_ORIGINS, ...configured])
}

export function isOriginAllowed(origin: string | undefined, allowed: Set<string>): boolean {
  return origin === undefined || allowed.has(origin)
}
