import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { discordNotifier, type ApprovalEvent, type ResearchDoneEvent, type AlertFiredEvent, type DiscordNotifierEvent } from './discordNotifier.js'

// Reset listener count between tests so we don't accumulate handlers.
// Using .once() in each test means they self-clean, but we guard the max anyway.

describe('discordNotifier — event bus', () => {

  test('emits ApprovalEvent on the "discord" channel', async () => {
    const event: ApprovalEvent = {
      kind:        'approval',
      id:          'abc123',
      title:       'Deploy to production',
      description: 'Agent wants to run npm publish',
      type:        'deploy',
      urgency:     'urgent',
      agentName:   'openclaw',
      payload:     'npm publish --access public',
    }

    const received = await new Promise<DiscordNotifierEvent>(resolve => {
      discordNotifier.once('discord', resolve)
      discordNotifier.notify(event)
    })

    assert.equal(received.kind, 'approval')
    assert.equal((received as ApprovalEvent).id, 'abc123')
    assert.equal((received as ApprovalEvent).urgency, 'urgent')
  })

  test('emits ResearchDoneEvent with success=true', async () => {
    const event: ResearchDoneEvent = {
      kind:     'research_done',
      itemType: 'inventory',
      id:       'inv-1',
      title:    'Raspberry Pi 4',
      success:  true,
      summary:  'Quad-core ARM Cortex-A72, 4GB RAM, USB 3.0, Gigabit Ethernet.',
    }

    const received = await new Promise<DiscordNotifierEvent>(resolve => {
      discordNotifier.once('discord', resolve)
      discordNotifier.notify(event)
    })

    assert.equal(received.kind, 'research_done')
    const r = received as ResearchDoneEvent
    assert.equal(r.title, 'Raspberry Pi 4')
    assert.equal(r.success, true)
    assert.ok(r.summary?.includes('ARM'))
  })

  test('emits ResearchDoneEvent with success=false and error', async () => {
    const event: ResearchDoneEvent = {
      kind:     'research_done',
      itemType: 'todo',
      id:       'todo-1',
      title:    'Some task',
      success:  false,
      error:    'Agent timed out',
    }

    const received = await new Promise<DiscordNotifierEvent>(resolve => {
      discordNotifier.once('discord', resolve)
      discordNotifier.notify(event)
    })

    const r = received as ResearchDoneEvent
    assert.equal(r.success, false)
    assert.equal(r.error, 'Agent timed out')
  })

  test('emits AlertFiredEvent', async () => {
    const event: AlertFiredEvent = {
      kind:     'alert',
      ruleId:   'rule-42',
      ruleName: 'Token spike',
      severity: 'warning',
      message:  'Token usage exceeded 150% threshold',
      firedAt:  new Date().toISOString(),
    }

    const received = await new Promise<DiscordNotifierEvent>(resolve => {
      discordNotifier.once('discord', resolve)
      discordNotifier.notify(event)
    })

    assert.equal(received.kind, 'alert')
    assert.equal((received as AlertFiredEvent).severity, 'warning')
  })

  test('multiple listeners all receive the same event', async () => {
    const received: string[] = []
    const event: ApprovalEvent = {
      kind:        'approval',
      id:          'multi-test',
      title:       'Multi-listener test',
      description: '',
      type:        'action',
      urgency:     'normal',
      agentName:   'test-agent',
      payload:     '',
    }

    const p1 = new Promise<void>(r => discordNotifier.once('discord', () => { received.push('l1'); r() }))
    const p2 = new Promise<void>(r => discordNotifier.once('discord', () => { received.push('l2'); r() }))

    discordNotifier.notify(event)
    await Promise.all([p1, p2])

    assert.ok(received.includes('l1'), 'listener 1 should fire')
    assert.ok(received.includes('l2'), 'listener 2 should fire')
  })

  test('independent events do not cross-contaminate listeners', async () => {
    const results: DiscordNotifierEvent[] = []
    const listener = (e: DiscordNotifierEvent) => results.push(e)
    discordNotifier.on('discord', listener)

    const e1: ResearchDoneEvent = { kind: 'research_done', itemType: 'todo', id: '1', title: 'First',  success: true }
    const e2: ResearchDoneEvent = { kind: 'research_done', itemType: 'todo', id: '2', title: 'Second', success: false }

    discordNotifier.notify(e1)
    discordNotifier.notify(e2)

    // Give the event loop a tick to process
    await new Promise(r => setTimeout(r, 10))

    discordNotifier.off('discord', listener)
    assert.equal(results.length, 2)
    assert.equal((results[0] as ResearchDoneEvent).id, '1')
    assert.equal((results[1] as ResearchDoneEvent).id, '2')
  })
})
