import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { IncidentStore } from './incidentStore.js'

const resources: Array<{ dir: string; store: IncidentStore }> = []
afterEach(() => { for (const item of resources.splice(0)) { item.store.close(); rmSync(item.dir, { recursive: true, force: true }) } })

function setup() { const dir = mkdtempSync(join(tmpdir(), 'nexus-incidents-')); const store = new IncidentStore(join(dir, 'incidents.sqlite')); resources.push({ dir, store }); return store }
const alert = { ruleId: 'rule-1', ruleName: 'Agent stalled', severity: 'critical', message: 'No events for 31 minutes', firedAt: '2026-06-28T10:00:00.000Z' }

describe('incident store', () => {
  it('deduplicates repeated alerts into a stable incident', () => {
    const store = setup(); store.sync([alert]); store.sync([{ ...alert, message: 'No events for 32 minutes', firedAt: '2026-06-28T10:01:00.000Z' }])
    const incidents = store.list()
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0].occurrences, 2)
    assert.equal(incidents[0].status, 'open')
  })

  it('resolves incidents absent from the next active set and reopens recurrence', () => {
    const store = setup(); store.sync([alert]); store.sync([])
    assert.equal(store.list()[0].status, 'resolved')
    store.sync([{ ...alert, firedAt: '2026-06-28T11:00:00.000Z' }])
    assert.equal(store.list()[0].status, 'open')
  })
})
