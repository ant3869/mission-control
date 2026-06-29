import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const routes = ['finance.ts', 'financials.ts', 'budgets.ts', 'tasks.ts', 'links.ts', 'tobuy.ts']

describe('JSON-backed route persistence', () => {
  it('uses the shared atomic JSON store', () => {
    const violations = routes.filter((route) => /JSON\.parse\(readFileSync/.test(readFileSync(join(process.cwd(), 'server', 'routes', route), 'utf8')))
    assert.deepEqual(violations, [])
  })
})
