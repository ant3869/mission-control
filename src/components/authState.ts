export type SessionStatus = { required: boolean; authenticated: boolean }
export type AuthScreen = 'loading' | 'login' | 'ready'

export function authScreen(status: SessionStatus | null): AuthScreen {
  if (!status) return 'loading'
  return status.required && !status.authenticated ? 'login' : 'ready'
}
