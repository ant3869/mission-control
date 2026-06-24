import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractSeverity, extractDue, extractPrice, extractPriority,
  parseSpend, formatDueDate, fmtMoney, fmtList,
} from './discordParsers.js'

// ─── extractSeverity ─────────────────────────────────────────────────────────

describe('extractSeverity', () => {
  test('strips trailing severity and returns it', () => {
    const r = extractSeverity('Buy milk high')
    assert.equal(r.severity, 'high')
    assert.equal(r.rest, 'Buy milk')
  })

  test('strips leading severity', () => {
    const r = extractSeverity('critical renew the cert')
    assert.equal(r.severity, 'critical')
    assert.equal(r.rest, 'renew the cert')
  })

  test('defaults to medium when absent', () => {
    const r = extractSeverity('Buy milk')
    assert.equal(r.severity, 'medium')
    assert.equal(r.rest, 'Buy milk')
  })

  test('is case-insensitive', () => {
    assert.equal(extractSeverity('task CRITICAL').severity, 'critical')
    assert.equal(extractSeverity('task HIGH').severity, 'high')
    assert.equal(extractSeverity('task LOW').severity, 'low')
  })

  test('prefers critical over high (checked first)', () => {
    const r = extractSeverity('critical high task')
    assert.equal(r.severity, 'critical')
  })

  test('handles medium keyword', () => {
    const r = extractSeverity('medium priority task')
    assert.equal(r.severity, 'medium')
    assert.equal(r.rest, 'priority task')
  })
})

// ─── extractDue ──────────────────────────────────────────────────────────────

describe('extractDue', () => {
  test('extracts due:YYYY-MM-DD', () => {
    const r = extractDue('Buy milk due:2026-07-01')
    assert.equal(r.due, '2026-07-01')
    assert.equal(r.rest, 'Buy milk')
  })

  test('returns empty string when no due', () => {
    const r = extractDue('Buy milk')
    assert.equal(r.due, '')
    assert.equal(r.rest, 'Buy milk')
  })

  test('is case-insensitive', () => {
    const r = extractDue('task DUE:2026-12-31')
    assert.equal(r.due, '2026-12-31')
  })

  test('handles due: in the middle of text', () => {
    const r = extractDue('report due:2026-09-01 high')
    assert.equal(r.due, '2026-09-01')
    assert.equal(r.rest, 'report high')
  })
})

// ─── extractPrice ────────────────────────────────────────────────────────────

describe('extractPrice', () => {
  test('parses $5.50', () => {
    const r = extractPrice('Coffee $5.50')
    assert.equal(r.price, 5.50)
    assert.equal(r.rest, 'Coffee')
  })

  test('parses $249 whole dollars', () => {
    const r = extractPrice('AirPods Pro $249')
    assert.equal(r.price, 249)
    assert.equal(r.rest, 'AirPods Pro')
  })

  test('does NOT match bare numbers — Raspberry Pi 4', () => {
    const r = extractPrice('Raspberry Pi 4')
    assert.equal(r.price, 0)
    assert.equal(r.rest, 'Raspberry Pi 4')
  })

  test('parses price with comma separator $1,299', () => {
    const r = extractPrice('MacBook $1,299')
    assert.equal(r.price, 1299)
  })

  test('returns price 0 and original text when no match', () => {
    const r = extractPrice('Just text')
    assert.equal(r.price, 0)
    assert.equal(r.rest, 'Just text')
  })

  test('handles $ at start of string', () => {
    const r = extractPrice('$12 Gas')
    assert.equal(r.price, 12)
    assert.equal(r.rest, 'Gas')
  })
})

// ─── extractPriority ─────────────────────────────────────────────────────────

describe('extractPriority', () => {
  test('finds high', () => {
    const r = extractPriority('AirPods high')
    assert.equal(r.priority, 'high')
    assert.equal(r.rest, 'AirPods')
  })

  test('finds low', () => {
    const r = extractPriority('rubber bands low')
    assert.equal(r.priority, 'low')
    assert.equal(r.rest, 'rubber bands')
  })

  test('defaults to medium when absent', () => {
    const r = extractPriority('AirPods')
    assert.equal(r.priority, 'medium')
    assert.equal(r.rest, 'AirPods')
  })

  test('is case-insensitive', () => {
    assert.equal(extractPriority('item HIGH').priority, 'high')
    assert.equal(extractPriority('item Low').priority, 'low')
  })
})

// ─── parseSpend ──────────────────────────────────────────────────────────────

describe('parseSpend', () => {
  test('parses amount + description', () => {
    const r = parseSpend('$5.50 Coffee')
    assert.deepEqual(r, { amount: 5.50, description: 'Coffee', category: 'Misc' })
  })

  test('parses amount + description + category (double space separator)', () => {
    const r = parseSpend('$12.00 Gas  Transport')
    assert.deepEqual(r, { amount: 12.00, description: 'Gas', category: 'Transport' })
  })

  test('returns null when no $ price', () => {
    const r = parseSpend('Coffee')
    assert.equal(r, null)
  })

  test('returns null when no description after price', () => {
    const r = parseSpend('$5.50')
    assert.equal(r, null)
  })

  test('handles comma-formatted price', () => {
    const r = parseSpend('$1,299 MacBook  Electronics')
    assert.ok(r !== null)
    assert.equal(r!.amount, 1299)
    assert.equal(r!.description, 'MacBook')
    assert.equal(r!.category, 'Electronics')
  })
})

// ─── formatDueDate ───────────────────────────────────────────────────────────

describe('formatDueDate', () => {
  test('returns empty string for empty input', () => {
    assert.equal(formatDueDate(''), '')
  })

  test('returns "today" for today\'s date', () => {
    const today = new Date().toISOString().slice(0, 10)
    assert.equal(formatDueDate(today), 'today')
  })

  test('returns "tomorrow" for tomorrow', () => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + 1)
    const tomorrow = d.toISOString().slice(0, 10)
    assert.equal(formatDueDate(tomorrow), 'tomorrow')
  })

  test('returns "yesterday" for yesterday', () => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 1)
    const yesterday = d.toISOString().slice(0, 10)
    assert.equal(formatDueDate(yesterday), 'yesterday')
  })

  test('returns Nd overdue for past dates beyond yesterday', () => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 5)
    const r = formatDueDate(d.toISOString().slice(0, 10))
    assert.equal(r, '5d overdue')
  })

  test('returns "in Nd" for near future', () => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + 3)
    const r = formatDueDate(d.toISOString().slice(0, 10))
    assert.equal(r, 'in 3d')
  })

  test('returns month-day for dates > 7 days away', () => {
    const r = formatDueDate('2030-01-15')
    assert.match(r, /Jan 15/)
  })
})

// ─── fmtMoney ────────────────────────────────────────────────────────────────

describe('fmtMoney', () => {
  test('formats small amounts with 2 decimals', () => {
    assert.equal(fmtMoney(5.5), '$5.50')
    assert.equal(fmtMoney(0), '$0.00')
  })

  test('formats large amounts without decimals', () => {
    assert.equal(fmtMoney(1234), '$1,234')
    assert.equal(fmtMoney(1000), '$1,000')
  })

  test('returns dash for non-finite', () => {
    assert.equal(fmtMoney(NaN), '—')
    assert.equal(fmtMoney(Infinity), '—')
  })
})

// ─── fmtList ─────────────────────────────────────────────────────────────────

describe('fmtList', () => {
  test('joins lines under the header', () => {
    const r = fmtList(['• Item A', '• Item B'], '**List**')
    assert.ok(r.includes('**List**'))
    assert.ok(r.includes('• Item A'))
    assert.ok(r.includes('• Item B'))
  })

  test('truncates when list exceeds limit', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `• Item ${i} `.repeat(15))
    const r = fmtList(lines, '**Big list**')
    assert.ok(r.length <= 1950, `Expected ≤1950 chars, got ${r.length}`)
    assert.ok(r.includes('more item'))
  })
})
