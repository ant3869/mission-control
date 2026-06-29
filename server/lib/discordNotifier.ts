// title: Discord notifier — cross-module event bus
// path: server/lib/discordNotifier.ts
// purpose: Singleton EventEmitter that routes (approvals, research, alerts) can
//          call to push structured events toward the Discord bot without importing
//          discord.js or knowing about the bot's channel IDs.

import { EventEmitter } from 'node:events'

// ─── Event types ──────────────────────────────────────────────────────────────

export interface ApprovalEvent {
  kind:        'approval'
  id:          string
  title:       string
  description: string
  type:        string   // publish | send | merge | purchase | action | deploy
  urgency:     string   // urgent | normal | low
  agentName:   string
  payload:     string
  project?:    string
}

export interface ResearchDoneEvent {
  kind:     'research_done'
  itemType: 'todo' | 'tobuy' | 'inventory'
  id:       string
  title:    string
  success:  boolean
  summary?: string
  error?:   string
}

export interface AlertFiredEvent {
  kind:     'alert'
  ruleId:   string
  ruleName: string
  severity: string   // info | warning | critical
  message:  string
  firedAt:  string
}

export interface BriefingEvent { kind: 'briefing'; title: string; message: string }

export type DiscordNotifierEvent = ApprovalEvent | ResearchDoneEvent | AlertFiredEvent | BriefingEvent

// ─── Singleton ────────────────────────────────────────────────────────────────

class DiscordNotifier extends EventEmitter {
  notify(event: DiscordNotifierEvent): void {
    this.emit('discord', event)
  }
}

export const discordNotifier = new DiscordNotifier()
// Allow many listeners (bot + tests + any future consumer).
discordNotifier.setMaxListeners(50)
