import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildBriefing } from './briefing.js'

describe('daily briefing', () => {
  it('prioritizes incidents and overdue work without inventing details', () => {
    const briefing = buildBriefing({ openIncidents: 3, criticalIncidents: 1, overdueTodos: 2, dueToday: 4, activeProjects: 5, recentOperations: 7 }, new Date('2026-06-29T12:00:00Z'))
    assert.equal(briefing.date, '2026-06-29')
    assert.match(briefing.summary, /1 critical incident/)
    assert.deepEqual(briefing.attention.slice(0, 2), ['1 critical incident needs attention', '2 overdue to-dos'])
    assert.equal(briefing.metrics.activeProjects, 5)
  })
})
