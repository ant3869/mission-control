// title: To-Do ↔ Google Calendar sync
// path: server/lib/todoCalendarSync.ts
// purpose: The bridge between a To-Do and its Google Calendar event. Pure
//   orchestration: given a todo's current state it decides whether to create,
//   update, delete, or skip the linked event, and returns the sync-metadata
//   fields to persist. It NEVER throws — Google failures are captured into
//   calendarSyncError so a calendar outage can never block saving a to-do.
//
// Behaviour (per product decisions):
//   • Sync is opt-in per task (calendarSyncEnabled).
//   • Enabled + has date  → create or UPDATE the same event (no duplicates).
//   • Enabled + no date   → delete the linked event, unlink.
//   • Disabled            → delete the linked event, unlink.
//   • Deleting a task     → delete the linked event (removeTodoFromCalendar).
//   • Completing a task   → no calendar change (handled by the route, not here).

import {
  buildEventFromTodo, createEvent, updateEvent, deleteEvent, findEventByTodoId,
  type TodoLike,
} from './googleCalendar.js'
import { isConfigured, hasToken, GoogleAuthError } from './googleAuth.js'

export type TodoCalendarSyncStatus = 'idle' | 'synced' | 'pending' | 'error' | 'disabled'

export interface CalendarSyncFields {
  calendarSyncEnabled:   boolean
  googleCalendarEventId:  string
  calendarSyncStatus:    TodoCalendarSyncStatus
  lastCalendarSyncAt:    string
  calendarSyncError:     string
}

export interface SyncableTodo extends TodoLike {
  calendarSyncEnabled?:   boolean
  googleCalendarEventId?:  string
  calendarSyncStatus?:    TodoCalendarSyncStatus
  lastCalendarSyncAt?:    string
  calendarSyncError?:     string
}

export function defaultSyncFields(): CalendarSyncFields {
  return {
    calendarSyncEnabled:  false,
    googleCalendarEventId: '',
    calendarSyncStatus:   'idle',
    lastCalendarSyncAt:   '',
    calendarSyncError:    '',
  }
}

function current(todo: SyncableTodo): CalendarSyncFields {
  return {
    calendarSyncEnabled:  Boolean(todo.calendarSyncEnabled),
    googleCalendarEventId: todo.googleCalendarEventId ?? '',
    calendarSyncStatus:   todo.calendarSyncStatus ?? 'idle',
    lastCalendarSyncAt:   todo.lastCalendarSyncAt ?? '',
    calendarSyncError:    todo.calendarSyncError ?? '',
  }
}

function notConnected(): boolean {
  return !isConfigured() || !hasToken()
}

/** Best-effort delete of whatever event a todo is linked to. Never throws. */
async function deleteLinkedEvent(todo: SyncableTodo): Promise<void> {
  const id = todo.googleCalendarEventId
  try {
    if (id) { await deleteEvent(id); return }
    // No stored id — try to recover by stamp so we don't orphan an event.
    if (!notConnected()) {
      const found = await findEventByTodoId(todo.id)
      if (found?.id) await deleteEvent(found.id)
    }
  } catch (err) {
    console.error('[todo-calendar] delete failed:', (err as Error)?.message)
  }
}

/**
 * Reconcile a todo's calendar event with its current state.
 * Returns the sync-metadata fields to persist on the todo.
 */
export async function syncTodoCalendar(todo: SyncableTodo): Promise<CalendarSyncFields> {
  const prev = current(todo)
  const event = buildEventFromTodo(todo)            // null when there's no resolvable date
  const wantsSync = prev.calendarSyncEnabled && Boolean(event)

  // ── Cases that should remove the event: disabled, or enabled-but-no-date ──
  if (!wantsSync) {
    await deleteLinkedEvent(todo)
    return {
      calendarSyncEnabled:  prev.calendarSyncEnabled,
      googleCalendarEventId: '',
      calendarSyncStatus:   prev.calendarSyncEnabled ? 'idle' : 'disabled',
      lastCalendarSyncAt:   new Date().toISOString(),
      calendarSyncError:    '',
    }
  }

  // ── Wants sync but Google isn't connected → surface a recoverable error ──
  if (notConnected()) {
    return {
      ...prev,
      calendarSyncStatus: 'error',
      calendarSyncError:  'Google Calendar is not connected — connect it in Settings to sync.',
    }
  }

  // ── Create or update (idempotent — same event, never a duplicate) ──
  try {
    let eventId = prev.googleCalendarEventId

    if (!eventId) {
      // Recover a previously-created event for this todo before making a new one.
      const existing = await findEventByTodoId(todo.id).catch(() => null)
      if (existing?.id) eventId = existing.id
    }

    let saved
    if (eventId) {
      try {
        saved = await updateEvent(eventId, event!)
      } catch (err) {
        // Event was deleted in Google — recreate it.
        if (err instanceof GoogleAuthError && err.state === 'auth_error') throw err
        saved = await createEvent(event!)
      }
    } else {
      saved = await createEvent(event!)
    }

    return {
      calendarSyncEnabled:  true,
      googleCalendarEventId: saved.id,
      calendarSyncStatus:   'synced',
      lastCalendarSyncAt:   new Date().toISOString(),
      calendarSyncError:    '',
    }
  } catch (err) {
    const message = err instanceof GoogleAuthError ? err.message : (err as Error)?.message ?? 'Calendar sync failed.'
    console.error('[todo-calendar] sync failed:', message)
    return {
      ...prev,
      calendarSyncStatus: 'error',
      calendarSyncError:  message,
    }
  }
}

/** Called when a todo is deleted: remove its calendar event, then clear fields. */
export async function removeTodoFromCalendar(todo: SyncableTodo): Promise<CalendarSyncFields> {
  if (todo.googleCalendarEventId || todo.calendarSyncEnabled) await deleteLinkedEvent(todo)
  return { ...defaultSyncFields(), calendarSyncEnabled: Boolean(todo.calendarSyncEnabled) }
}
