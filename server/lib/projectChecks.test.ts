import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join } from 'node:path'

const root = process.cwd()

describe('project verification workflow', () => {
  it('defines web, server, and aggregate typecheck scripts', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    assert.equal(typeof pkg.scripts['typecheck:web'], 'string')
    assert.equal(typeof pkg.scripts['typecheck:server'], 'string')
    assert.match(pkg.scripts.check, /typecheck:web/)
    assert.match(pkg.scripts.check, /typecheck:server/)
  })

  it('includes every server TypeScript file in a server config', () => {
    const path = join(root, 'tsconfig.server.json')
    assert.equal(existsSync(path), true)
    const config = JSON.parse(readFileSync(path, 'utf8'))
    assert.deepEqual(config.include, ['server/**/*.ts'])
  })

  it('has a Node 22 container that verifies and builds the app', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
    assert.match(dockerfile, /FROM node:22/)
    assert.match(dockerfile, /RUN npm run check && npm test && npm run build/)
  })

  it('serves the built frontend in production', () => {
    const server = readFileSync(join(root, 'server/index.ts'), 'utf8')
    assert.match(server, /express\.static\(distDir\)/)
    assert.match(server, /NODE_ENV === 'production'/)
  })
})
