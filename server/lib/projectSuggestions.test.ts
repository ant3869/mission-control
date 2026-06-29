/**
 * Tests for the project suggestion dedupe + similarity layer.
 * Run with: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSimilar, dedupeIdeas, isConceptuallySimilar } from './projectSuggestions.js'
import type { ProjectBacklogContext, ProjectIdeaResult } from './projectSuggestions.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function idea(title: string, description = '', category = 'raspberry-pi-build'): ProjectIdeaResult {
  return {
    title, description, category,
    whyFit: '', haveParts: [], missingParts: [], difficulty: 'medium',
    timeEstimate: '', costEstimate: '', confidence: 70, coolness: 70, usefulnessScore: 70,
    requiredTools: [], relatedItemIds: [], nextStep: '',
    influenceMetadata: { inventoryFactors: [], matchedCategories: [], priorLikedInfluence: [], priorRejectedInfluence: [], rejectionNotes: [], preferenceSignals: [], contextualFactors: [] },
  }
}

function emptyCtx(): ProjectBacklogContext {
  return { rejected: [], liked: [], snoozed: [], existing: [] }
}

// ─── isSimilar ────────────────────────────────────────────────────────────────

test('isSimilar: identical titles are similar', () => {
  const a = idea('Raspberry Pi Weather Dashboard')
  const b = idea('Raspberry Pi Weather Dashboard')
  assert.equal(isSimilar(a, b), true)
})

test('isSimilar: near-identical titles (renamed variant) are similar', () => {
  const a = idea('Raspberry Pi Weather Dashboard')
  const b = idea('Pi Weather Dashboard Station')
  assert.equal(isSimilar(a, b), true)
})

test('isSimilar: completely different titles are not similar', () => {
  const a = idea('Raspberry Pi Weather Dashboard')
  const b = idea('Arduino LED Blink Controller')
  assert.equal(isSimilar(a, b), false)
})

test('isSimilar: same category + very similar description triggers match', () => {
  const a = { ...idea('Project A'), description: 'A temperature and humidity sensor display using Pi and a small screen.' }
  const b = { ...idea('Project B'), description: 'A humidity and temperature sensor display using Pi and a small screen.' }
  // Same category, high description overlap
  assert.equal(isSimilar(a, b), true)
})

test('isSimilar: same description but different category does not trigger description path', () => {
  const desc = 'Build an automated LED strip controller with motion detection.'
  const a = { ...idea('LED Visualizer Array', desc, 'raspberry-pi-build') }
  const b = { ...idea('Motor Speed Controller', desc, 'microcontroller-project') }
  // Different categories block the description path; title token overlap is 0
  assert.equal(isSimilar(a, b), false)
})

test('isSimilar: lower threshold catches more matches', () => {
  const a = idea('Raspberry Pi Sensor Node')
  const b = idea('Pi Sensor Hub')
  // At default threshold (0.38) "raspberry pi sensor" vs "pi sensor hub" — check both ways
  // token overlap: {raspberry, pie, sensor, node} vs {sensor, hub} = 1 shared out of 5 = 0.2 — should be false
  assert.equal(isSimilar(a, b, 0.38), false)
  // But at lower threshold 0.15 it should match
  assert.equal(isSimilar(a, b, 0.15), true)
})

// ─── dedupeIdeas ─────────────────────────────────────────────────────────────

test('dedupeIdeas: passes through ideas when context is empty', () => {
  const ideas = [idea('Home Automation Hub'), idea('Robot Arm Controller')]
  const { kept, filtered } = dedupeIdeas(ideas, emptyCtx())
  assert.equal(kept.length, 2)
  assert.equal(filtered.length, 0)
})

test('dedupeIdeas: blocks idea similar to a rejected idea', () => {
  const ctx: ProjectBacklogContext = {
    ...emptyCtx(),
    rejected: [
      {
        title: 'Raspberry Pi Weather Dashboard',
        description: 'Show temperature and humidity on a small display.',
        category: 'raspberry-pi-build',
        rejectionReason: 'Too boring',
        haveParts: ['Raspberry Pi'],
      },
    ],
  }
  const ideas = [
    idea('Pi Weather Dashboard Station'),         // similar to rejected
    idea('Arduino MIDI Controller'),              // different
  ]
  const { kept, filtered } = dedupeIdeas(ideas, ctx)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].title, 'Arduino MIDI Controller')
  assert.equal(filtered.length, 1)
  assert.match(filtered[0].reason, /too similar to rejected/)
})

test('dedupeIdeas: rejection reason is recorded in filtered list', () => {
  const ctx: ProjectBacklogContext = {
    ...emptyCtx(),
    rejected: [{
      title: 'Raspberry Pi Weather Station',
      description: '',
      category: 'raspberry-pi-build',
      rejectionReason: 'Already have one',
      haveParts: [],
    }],
  }
  const { filtered } = dedupeIdeas([idea('Raspberry Pi Weather Station')], ctx)
  assert.equal(filtered.length, 1)
  assert.match(filtered[0].reason, /Raspberry Pi Weather Station/)
})

test('dedupeIdeas: blocks duplicate of existing non-rejected idea', () => {
  const ctx: ProjectBacklogContext = {
    ...emptyCtx(),
    existing: [{ title: 'Home Media Server', description: 'A Pi-based Plex media server.', category: 'raspberry-pi-build', status: 'liked' }],
  }
  const ideas = [
    idea('Home Media Server Build'),  // too close to existing
    idea('CNC Router Controller'),    // fresh
  ]
  const { kept, filtered } = dedupeIdeas(ideas, ctx)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].title, 'CNC Router Controller')
  assert.equal(filtered.length, 1)
  assert.match(filtered[0].reason, /duplicate of existing/)
})

test('dedupeIdeas: does NOT block idea similar to a rejected existing entry in the existing list', () => {
  // An idea that is only in `existing` with status=rejected should not block new ideas
  // (rejected ones are blocked via ctx.rejected, not ctx.existing)
  const ctx: ProjectBacklogContext = {
    ...emptyCtx(),
    existing: [{ title: 'Pi Cluster Build', description: '', category: 'raspberry-pi-build', status: 'rejected' }],
  }
  const ideas = [idea('Pi Cluster Build')]
  // The existing list's rejected entry should NOT block (that's handled by ctx.rejected)
  const { kept } = dedupeIdeas(ideas, ctx)
  // status=rejected items are excluded from the nonRejected filter — so this should pass through
  assert.equal(kept.length, 1)
})

test('dedupeIdeas: snoozed ideas are not filtered by dedupeIdeas (prompt handles that)', () => {
  // Snoozed ideas go into ctx.snoozed but dedupeIdeas only checks rejected + existing.
  // They shouldn't be filtered at the dedupe level — the prompt instructs the agent to avoid them.
  const ctx: ProjectBacklogContext = {
    ...emptyCtx(),
    snoozed: [{ title: 'LED Matrix Clock', description: '', category: 'microcontroller-project' }],
  }
  const { kept } = dedupeIdeas([idea('LED Matrix Clock', '', 'microcontroller-project')], ctx)
  // Snoozed ideas are NOT in ctx.existing so they won't be caught here
  assert.equal(kept.length, 1)
})

test('dedupeIdeas: multiple ideas, mixed outcomes', () => {
  const ctx: ProjectBacklogContext = {
    rejected: [{
      title: 'Robot Arm with Servos',
      description: 'A 4-DOF robot arm using servo motors.',
      category: 'microcontroller-project',
      rejectionReason: 'Too expensive',
      haveParts: ['Arduino'],
    }],
    liked: [],
    snoozed: [],
    existing: [
      { title: 'Smart Plant Watering System', description: 'Auto-water plants using soil sensor.', category: 'sensor-automation', status: 'new' },
    ],
  }
  const ideas = [
    idea('Robot Arm Servos Build', '', 'microcontroller-project'),  // similar to rejected (robot/arm/servos overlap ≥0.35)
    idea('Smart Plant Watering', '', 'sensor-automation'),         // duplicate of existing
    idea('Retro Game Console', '', 'raspberry-pi-build'),          // fresh
    idea('MIDI Drum Pad', '', 'microcontroller-project'),          // fresh
  ]
  const { kept, filtered } = dedupeIdeas(ideas, ctx)
  assert.equal(kept.length, 2)
  assert.equal(filtered.length, 2)
  assert.ok(kept.some(k => k.title === 'Retro Game Console'))
  assert.ok(kept.some(k => k.title === 'MIDI Drum Pad'))
})

// ─── isConceptuallySimilar ───────────────────────────────────────────────────────────────────

test('isConceptuallySimilar: all four real-world renamed dashboard variants are blocked', () => {
  // Regression test for the case that originally bypassed raw-Jaccard dedup:
  //   rejected "basic Raspberry Pi dashboard"
  //   → agent regenerated: "sensor display station", "Pi monitoring screen", "home status display"
  // All three are conceptually the same: Pi platform + display output + sensor data.
  const rejected = {
    title: 'Basic Raspberry Pi Dashboard',
    description: 'Shows temperature and sensor readings on a small connected display.',
    category: 'display-dashboard',
    relatedItemIds: [] as string[],
    haveParts: ['Raspberry Pi 4'],
  }
  const variants = [
    {
      title: 'Sensor Display Station',
      description: 'A station showing sensor readings on a screen.',
      category: 'display-dashboard',
      relatedItemIds: [] as string[],
      haveParts: [] as string[],
    },
    {
      title: 'Pi Monitoring Screen',
      description: 'Monitor Pi sensor data on a display screen.',
      category: 'display-dashboard',
      relatedItemIds: [] as string[],
      haveParts: [] as string[],
    },
    {
      title: 'Home Status Display',
      description: 'A Raspberry Pi screen for home sensor data.',
      category: 'display-dashboard',
      relatedItemIds: [] as string[],
      haveParts: [] as string[],
    },
  ]
  for (const v of variants) {
    const result = isConceptuallySimilar(rejected, v)
    assert.equal(
      result.similar, true,
      `Expected "${v.title}" to be blocked but was allowed (reason: ${result.reason ?? 'none'})`,
    )
  }
})

test('isConceptuallySimilar: genuinely different ideas are not blocked', () => {
  const base = {
    title: 'Basic Raspberry Pi Dashboard',
    description: 'Shows temperature and sensor readings on a small connected display.',
    category: 'display-dashboard',
    relatedItemIds: [] as string[],
    haveParts: [] as string[],
  }
  const different = [
    {
      title: 'Arduino MIDI Controller',
      description: 'A USB MIDI controller using Arduino for music production.',
      category: 'microcontroller-project',
      relatedItemIds: [] as string[], haveParts: [] as string[],
    },
    {
      title: 'CNC Router Z-Axis Driver',
      description: 'Motor driver for a homemade CNC router z-axis.',
      category: 'microcontroller-project',
      relatedItemIds: [] as string[], haveParts: [] as string[],
    },
    {
      title: 'Retro LED Lamp',
      description: 'Repurpose vintage glass tubes with LED strips for ambient lighting.',
      category: 'repair-reuse',
      relatedItemIds: [] as string[], haveParts: [] as string[],
    },
  ]
  for (const d of different) {
    const result = isConceptuallySimilar(base, d)
    assert.equal(
      result.similar, false,
      `Expected "${d.title}" NOT to be blocked (reason: ${result.reason ?? 'none'})`,
    )
  }
})

test('isConceptuallySimilar: returns reason string explaining the block', () => {
  const a = {
    title: 'Pi Monitoring Screen',
    description: 'Monitor Pi sensor data on a display.',
    category: 'display-dashboard',
    relatedItemIds: [] as string[], haveParts: [] as string[],
  }
  const b = {
    title: 'Basic Raspberry Pi Dashboard',
    description: 'Shows temperature and sensor readings on a small display.',
    category: 'display-dashboard',
    relatedItemIds: [] as string[], haveParts: [] as string[],
  }
  const result = isConceptuallySimilar(a, b)
  assert.equal(result.similar, true)
  // reason must be a non-empty string that mentions something specific
  assert.ok(result.reason && result.reason.length > 5, `reason should describe the block, got: ${result.reason}`)
})

test('dedupeIdeas: blocks all renamed Pi-dashboard variants via concept matching', () => {
  const ctx: ProjectBacklogContext = {
    ...emptyCtx(),
    rejected: [{
      title: 'Basic Raspberry Pi Dashboard',
      description: 'Shows temperature and sensor readings on a small connected display.',
      category: 'display-dashboard',
      rejectionReason: 'Too boring, already built one',
      haveParts: ['Raspberry Pi 4'],
    }],
  }
  const variants = [
    idea('Sensor Display Station', 'A station showing sensor readings on a screen.', 'display-dashboard'),
    idea('Pi Monitoring Screen',   'Monitor Pi sensor data on a display screen.',    'display-dashboard'),
    idea('Home Status Display',    'A Raspberry Pi screen for home sensor data.',    'display-dashboard'),
  ]
  const fresh = idea('Arduino MIDI Controller', 'A USB MIDI pad for music production.', 'microcontroller-project')

  const { kept, filtered } = dedupeIdeas([...variants, fresh], ctx)

  assert.equal(filtered.length, 3, `expected 3 filtered, got ${filtered.length}: ${filtered.map(f => f.title).join(', ')}`)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].title, 'Arduino MIDI Controller')
  // All three filter reasons must mention concept similarity, not raw Jaccard
  for (const f of filtered) {
    assert.match(f.reason, /conceptually similar/, `reason should cite concept match: ${f.reason}`)
  }
})
