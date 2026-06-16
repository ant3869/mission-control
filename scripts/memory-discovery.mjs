// Phase 0 — Memory discovery dump.
// Learns the REAL shape of OpenClaw's memory subsystem before we build more
// renderers against guesses. Uses the dashboard's already-authenticated path
// (operator token in Settings), so no separate gateway creds are needed.
//
//   1. start the app:  npm run dev      (or at least `npm run server`)
//   2. run:            node scripts/memory-discovery.mjs
//
// Prints: doctor.memory.status (raw), the derived embedding/vector view, and the
// workspace memory file list. Use the output to extend server/lib/memoryDoctor.ts
// (the deepNum/deepStr key lists) so vector counts/dims render correctly.

const BASE = process.env.MC_API ?? 'http://localhost:3001'
const SOURCE = process.argv[2] ?? 'openclaw'

async function j(path) {
  const res = await fetch(`${BASE}${path}`)
  const body = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error(body.error ?? res.statusText)
  return body
}

function hr(t) { console.log(`\n${'─'.repeat(64)}\n  ${t}\n${'─'.repeat(64)}`) }

try {
  hr(`Memory subsystem health  (source=${SOURCE})`)
  const health = await j(`/api/memory/health?source=${SOURCE}&force=1`)
  if (!health.reachable) {
    console.log('  ⚠ not reachable:', health.error)
    console.log('  → open Settings, add the OpenClaw gateway URL + operator token, retry.')
  } else {
    console.log('  embedding (derived):', JSON.stringify(health.embedding, null, 2))
    console.log('  vector    (derived):', JSON.stringify(health.vector, null, 2))
    console.log('  store              :', JSON.stringify(health.store, null, 2))
    hr('doctor.memory.status — RAW (extend memoryDoctor.ts against this)')
    console.log(JSON.stringify(health.doctorRaw, null, 2))
  }

  hr('Workspace memory files (agents.files.list)')
  const files = await j(`/api/memory/files?source=${SOURCE}`)
  if (files.error) console.log('  ⚠', files.error)
  console.log(`  ${files.files?.length ?? 0} files`)
  for (const f of (files.files ?? []).slice(0, 40)) {
    console.log(`   · ${f.name}  (${f.size ?? 0} B)  ${f.updatedAt ?? ''}`)
  }

  hr('Recent classified memory events (live collector)')
  const ev = await j(`/api/memory/events?source=${SOURCE}&limit=15`)
  if (!ev.events?.length) console.log('  (none yet — talk to the agent so it saves/recalls memory)')
  for (const e of ev.events ?? []) {
    console.log(`   · ${e.ts}  ${e.type.padEnd(12)} ${e.tool ?? ''}  ${e.summary.slice(0, 60)}`)
  }

  hr('What to do with this')
  console.log('  • If "vector (derived)" is null but doctorRaw clearly has counts/dims,')
  console.log('    add those field names to deepNum/deepStr in server/lib/memoryDoctor.ts.')
  console.log('  • If doctorRaw has no vector data at all, OpenClaw likely keeps the store')
  console.log('    on disk — wire the Plane 4 collector to POST /api/memory/vector-stats.')
  console.log('  • If consolidation/dreaming exists, emit Plane 3 events to')
  console.log('    POST /api/memory/events (type: consolidated) + /api/memory/consolidation.\n')
} catch (err) {
  console.error('\n  discovery failed:', err.message)
  console.error('  → is the dashboard server running?  npm run dev   (needs', BASE + ')\n')
  process.exit(1)
}
