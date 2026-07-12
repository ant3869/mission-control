// Opens one SSE connection to /api/watch/stream and re-dispatches
// data:changed events as a DOM CustomEvent so any mounted view can
// call its load() without polling.
//
// apiUrl resolves the stream against the runtime-configured API base for mobile.

import { API_BASE_CHANGED_EVENT, apiUrl } from './apiTransport.js'

export const DATA_REFRESH_EVENT    = 'mc:data'
export const DATA_CONNECT_EVENT    = 'mc:data:connect'
export const DATA_DISCONNECT_EVENT = 'mc:data:disconnect'

export interface DataRefreshDetail {
  domain: string
  ts:     string
}

let started = false

export function startDataRefresh(): () => void {
  if (started) return () => {}
  started = true

  let es: EventSource | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let dead = false
  let retryDelay = 5_000
  const MAX_DELAY = 60_000

  function connect() {
    if (dead) return
    es = new EventSource(apiUrl('/api/watch/stream'))

    es.onopen = () => {
      retryDelay = 5_000
      window.dispatchEvent(new CustomEvent(DATA_CONNECT_EVENT))
    }

    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data)
        if (payload?.type === 'data:changed') {
          window.dispatchEvent(
            new CustomEvent<DataRefreshDetail>(DATA_REFRESH_EVENT, {
              detail: { domain: payload.domain, ts: payload.ts },
            })
          )
        }
      } catch { /* ignore malformed */ }
    }

    es.onerror = () => {
      es?.close()
      es = null
      if (!dead) {
        window.dispatchEvent(new CustomEvent(DATA_DISCONNECT_EVENT))
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, MAX_DELAY)
          connect()
        }, retryDelay)
      }
    }
  }

  function reconnect() {
    es?.close()
    es = null
    if (retryTimer) clearTimeout(retryTimer)
    retryDelay = 5_000
    connect()
  }

  connect()
  window.addEventListener(API_BASE_CHANGED_EVENT, reconnect)

  return () => {
    dead = true
    if (retryTimer) clearTimeout(retryTimer)
    window.removeEventListener(API_BASE_CHANGED_EVENT, reconnect)
    es?.close()
    started = false
  }
}
