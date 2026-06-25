import { EventEmitter } from 'node:events'

export type DataDomain = 'todos' | 'tasks' | 'tobuy' | 'finance' | 'financials' | 'approvals' | 'notes' | 'inventory'

class DataEventBus extends EventEmitter {}
export const dataBus = new DataEventBus()
dataBus.setMaxListeners(100)

export function emitDataChanged(domain: DataDomain): void {
  dataBus.emit('changed', { type: 'data:changed', domain, ts: new Date().toISOString() })
}
