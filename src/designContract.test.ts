import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it } from 'node:test'

const sourceRoot = new URL('.', import.meta.url).pathname.replace(/^\/(.:\/)/, '$1')
const forbidden = /(?<![\w-])(?:font-(?:bold|extrabold|black)|rounded-(?:2xl|3xl)|backdrop-blur(?:-(?:[\w/]+|\[[^\]]+\]))?|shadow(?:-(?:[\w/]+|\[[^\]]+\]))?|bg-gradient-to-[\w-]+)(?=[\s'"`])/g

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionTsxFiles(path)
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : []
  })
}

describe('visual design contract', () => {
  it('keeps production views flat, restrained, and semibold at most', () => {
    const violations = productionTsxFiles(sourceRoot).flatMap((file) => {
      const matches = readFileSync(file, 'utf8').match(forbidden) ?? []
      return matches.map((token) => `${relative(sourceRoot, file)}: ${token}`)
    })

    assert.deepEqual(violations, [])
  })
})
