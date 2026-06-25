// Opens one SSE connection to /api/watch/stream and re-dispatches
// data:changed events as a DOM CustomEvent so any mounted view can
// call its load() without polling.

export const DATA_REFRESH_EVENT = 'mc:data'

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

  function connect() {
    if (dead) return
    es = new EventSource('/api/watch/stream')

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
      if (!dead) retryTimer = setTimeout(connect, 5000)
    }
  }

  connect()

  return () => {
    dead = true
    if (retryTimer) clearTimeout(retryTimer)
    es?.close()
    started = false
  }
}
