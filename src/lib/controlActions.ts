import type { ApprovalCreateBody, ConnectorId } from './api'

interface SessionForApproval { key: string; title: string; status: string; model: string; tokens: number }

export function buildSessionApproval(source: ConnectorId, session: SessionForApproval): ApprovalCreateBody {
  return {
    type: 'action', urgency: 'normal', title: `Review session: ${session.title || session.key}`,
    description: `${source} session is ${session.status || 'unknown'} on ${session.model || 'an unknown model'} with ${session.tokens.toLocaleString()} tokens.`,
    payload: JSON.stringify({ source, sessionKey: session.key }), agentName: source,
  }
}
