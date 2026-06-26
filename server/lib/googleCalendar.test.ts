/**
 * Tests for the pure To-Do → Google Calendar mapping helpers.
 * These never touch the network. Run with: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseLooseDate, parseLooseTime, resolveTodoDateTime,
  buildEventFromTodo, buildEventDescription, mapEvent,
  type TodoLike,
} from './googleCalendar.js'

function todo(over: Partial<TodoLike> = {}): TodoLike {
  return { id: 'abc12345', title: 'Eye exam', ...over }
}

// ─── parseLooseDate ───────────────────────────────────────────────────────────

test('parseLooseDate: US slash format', () => {
  assert.deepEqual(parseLooseDate('06/17/2026'), { y: 2026, m: 5, d: 17 })
})
test('parseLooseDate: 2-digit year is 2000s', () => {
  assert.deepEqual(parseLooseDate('6/17/26'), { y: 2026, m: 5, d: 17 })
})
test('parseLooseDate: ISO format', () => {
  assert.deepEqual(parseLooseDate('2026-06-17'), { y: 2026, m: 5, d: 17 })
})
test('parseLooseDate: month name with year', () => {
  assert.deepEqual(parseLooseDate('Jun 17, 2026'), { y: 2026, m: 5, d: 17 })
})
test('parseLooseDate: day-month-year', () => {
  assert.deepEqual(parseLooseDate('17 June 2026'), { y: 2026, m: 5, d: 17 })
})
test('parseLooseDate: empty / garbage → null', () => {
  assert.equal(parseLooseDate(''), null)
  assert.equal(parseLooseDate('soon'), null)
  assert.equal(parseLooseDate(undefined), null)
})

// ─── parseLooseTime ───────────────────────────────────────────────────────────

test('parseLooseTime: 12h with meridiem and space', () => {
  assert.deepEqual(parseLooseTime('11:40 AM'), { h: 11, min: 40 })
})
test('parseLooseTime: 12h no space', () => {
  assert.deepEqual(parseLooseTime('11:40AM'), { h: 11, min: 40 })
})
test('parseLooseTime: PM converts to 24h', () => {
  assert.deepEqual(parseLooseTime('1:05 pm'), { h: 13, min: 5 })
})
test('parseLooseTime: 24h passes through', () => {
  assert.deepEqual(parseLooseTime('14:30'), { h: 14, min: 30 })
})
test('parseLooseTime: 12 AM is midnight, 12 PM is noon', () => {
  assert.deepEqual(parseLooseTime('12:00 AM'), { h: 0, min: 0 })
  assert.deepEqual(parseLooseTime('12 PM'), { h: 12, min: 0 })
})
test('parseLooseTime: empty / garbage → null', () => {
  assert.equal(parseLooseTime(''), null)
  assert.equal(parseLooseTime('whenever'), null)
})

// ─── resolveTodoDateTime ──────────────────────────────────────────────────────

test('resolveTodoDateTime: date only → all-day on that day', () => {
  const r = resolveTodoDateTime(todo({ details: { date: '06/17/2026' } }))
  assert.ok(r)
  assert.equal(r!.allDay, true)
  assert.equal(r!.start.getFullYear(), 2026)
  assert.equal(r!.start.getMonth(), 5)
  assert.equal(r!.start.getDate(), 17)
  // all-day end is the next day
  assert.equal(r!.end.getDate(), 18)
})

test('resolveTodoDateTime: date + time → 60-min timed event (local)', () => {
  const r = resolveTodoDateTime(todo({ details: { date: '06/17/2026', time: '11:40 AM' } }))
  assert.ok(r)
  assert.equal(r!.allDay, false)
  assert.equal(r!.start.getHours(), 11)
  assert.equal(r!.start.getMinutes(), 40)
  assert.equal(r!.end.getTime() - r!.start.getTime(), 60 * 60_000)
})

test('resolveTodoDateTime: falls back to dueDate as all-day', () => {
  // Use a fixed UTC noon time so the calendar date is unambiguous in any timezone.
  const due = '2026-08-03T12:00:00.000Z'
  const r = resolveTodoDateTime(todo({ dueDate: due }))
  assert.ok(r)
  assert.equal(r!.allDay, true)
  assert.equal(r!.start.getMonth(), 7)   // August (0-indexed)
  assert.equal(r!.start.getDate(), 3)
})

test('resolveTodoDateTime: details.date wins over dueDate', () => {
  const r = resolveTodoDateTime(todo({ details: { date: '2026-01-09' }, dueDate: new Date(2026, 7, 3).toISOString() }))
  assert.equal(r!.start.getMonth(), 0)
  assert.equal(r!.start.getDate(), 9)
})

test('resolveTodoDateTime: no date → null (not calendar-eligible)', () => {
  assert.equal(resolveTodoDateTime(todo()), null)
  assert.equal(resolveTodoDateTime(todo({ details: { location: 'somewhere' } })), null)
})

// ─── buildEventFromTodo ───────────────────────────────────────────────────────

test('buildEventFromTodo: returns null when no date', () => {
  assert.equal(buildEventFromTodo(todo()), null)
})

test('buildEventFromTodo: timed event carries summary, location, and todo stamp', () => {
  const ev = buildEventFromTodo(todo({
    title: 'Eye exam',
    details: { date: '06/17/2026', time: '11:40 AM', location: '406 S Walton Blvd' },
  }))!
  assert.equal(ev.summary, 'Eye exam')
  assert.equal(ev.location, '406 S Walton Blvd')
  assert.ok(ev.start?.dateTime, 'timed event uses dateTime')
  assert.equal(ev.extendedProperties?.private?.mcTodoId, 'abc12345')
})

test('buildEventFromTodo: all-day event uses date (not dateTime)', () => {
  const ev = buildEventFromTodo(todo({ details: { date: '2026-06-17' } }))!
  assert.equal(ev.start?.date, '2026-06-17')
  assert.equal(ev.end?.date, '2026-06-18')
  assert.equal(ev.start?.dateTime, undefined)
})

// ─── buildEventDescription ────────────────────────────────────────────────────

test('buildEventDescription: includes every relevant field + footer', () => {
  const desc = buildEventDescription(todo({
    notes: 'Bring insurance card',
    severity: 'high',
    details: {
      phone: '479-271-0301', cost: '$100', url: 'https://example.com',
      category: 'Appointment', customFields: { Doctor: 'Smith' },
    },
  }))
  assert.match(desc, /Bring insurance card/)
  assert.match(desc, /Priority: high/)
  assert.match(desc, /Phone: 479-271-0301/)
  assert.match(desc, /Cost: \$100/)
  assert.match(desc, /URL: https:\/\/example\.com/)
  assert.match(desc, /Category: Appointment/)
  assert.match(desc, /Doctor: Smith/)
  assert.match(desc, /Synced from Mission Control/)
})

// ─── mapEvent ─────────────────────────────────────────────────────────────────

test('mapEvent: reads todo stamp and all-day flag back out', () => {
  const m = mapEvent({
    id: 'evt1', summary: 'Eye exam',
    start: { date: '2026-06-17' }, end: { date: '2026-06-18' },
    extendedProperties: { private: { mcTodoId: 'abc12345' } },
  })
  assert.equal(m.id, 'evt1')
  assert.equal(m.allDay, true)
  assert.equal(m.todoId, 'abc12345')
})
