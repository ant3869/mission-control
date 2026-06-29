import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSessionApproval } from './controlActions.js'

describe('activity controls', () => {
  it('turns a live session into a review approval', () => {
    const approval = buildSessionApproval('openclaw', { key: 's-1', title: 'Deploy worker', status: 'running', model: 'gpt-5', tokens: 1200 })
    assert.equal(approval.type, 'action')
    assert.equal(approval.urgency, 'normal')
    assert.equal(approval.title, 'Review session: Deploy worker')
    assert.match(approval.payload ?? '', /s-1/)
    assert.match(approval.description ?? '', /openclaw.*running.*gpt-5/i)
  })
})
