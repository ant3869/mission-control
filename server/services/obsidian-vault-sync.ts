/**
 * Obsidian Vault Sync
 * 
 * Reads inventory items from your Obsidian vault and syncs them
 * to the Mission Control inventory system
 */

import * as fs from 'fs'
import * as path from 'path'
import type { InventoryItem } from '../../src/types/index.js'

const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || 
  path.join(process.env.HOME || '/home/ant3869', 'Documents/Obsidian Vault/Second Brain')

const INVENTORY_FOLDER = path.join(OBSIDIAN_VAULT_PATH, 'Inventory')

interface FrontmatterData {
  item_id?: string
  name?: string
  category?: string
  subcategory?: string
  condition?: string
  location?: string
  status?: string
  tags?: string[]
  [key: string]: any
}

/**
 * Parse YAML frontmatter from markdown file
 */
function parseFrontmatter(content: string): [FrontmatterData, string] {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/)
  if (!match) return [{}, content]

  const frontmatter: FrontmatterData = {}
  const yamlContent = match[1]

  // Simple YAML parser for our needs
  yamlContent.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim()
      let value = line.substring(colonIndex + 1).trim()

      // Handle different value types
      if (value === 'true') value = true as any
      else if (value === 'false') value = false as any
      else if (value.startsWith('[') && value.endsWith(']')) {
        // Parse arrays like [item1, item2]
        value = value
          .slice(1, -1)
          .split(',')
          .map(v => v.trim())
          .filter(v => v) as any
      }

      frontmatter[key] = value
    }
  })

  return [frontmatter, match[2]]
}

/**
 * Extract tech specs from markdown content
 */
function extractSpecsFromContent(content: string): Record<string, string> {
  const specs: Record<string, string> = {}
  const detailsSection = content.match(/## Details\n([\s\S]*?)(?:##|$)/)

  if (detailsSection) {
    const lines = detailsSection[1].split('\n')
    lines.forEach(line => {
      const match = line.match(/- \*\*(.+?)\*\*:\s*(.+)/)
      if (match) {
        specs[match[1]] = match[2]
      }
    })
  }

  return specs
}

/**
 * Convert Obsidian item to InventoryItem
 */
function obsidianToInventoryItem(
  filePath: string,
  frontmatter: FrontmatterData,
  content: string
): InventoryItem {
  const specs = extractSpecsFromContent(content)
  const fileName = path.basename(filePath, '.md')

  // Map condition to status
  const conditionToStatus = {
    'Working': 'in-stock',
    'Broken': 'out-of-stock',
    'Parts': 'out-of-stock',
    'Unknown': 'low',
  }

  return {
    id: frontmatter.item_id || `obs-${fileName}`,
    name: frontmatter.name || fileName,
    sku: specs['Model'] || frontmatter.model || '',
    category: mapCategory(frontmatter.category),
    quantity: 1,
    minThreshold: 1,
    maxThreshold: 5,
    status: (conditionToStatus as any)[frontmatter.condition] || 'in-stock',
    condition: frontmatter.condition,
    location: frontmatter.location || '',
    supplier: specs['Manufacturer'] || frontmatter.manufacturer || '',
    lastRestockedAgo: specs['Purchase Date'] || frontmatter.purchase_date || '',
    notes: `${frontmatter.subcategory || ''}\n${Object.entries(specs)
      .map(([k, v]) => `**${k}**: ${v}`)
      .join('\n')}`,
    tags: [
      frontmatter.category?.toLowerCase(),
      frontmatter.subcategory?.toLowerCase(),
      frontmatter.condition?.toLowerCase(),
      frontmatter.status?.toLowerCase(),
      ...(frontmatter.tags || []),
    ].filter(Boolean) as string[],
  }
}

/**
 * Map Obsidian categories to our inventory categories
 */
function mapCategory(obsidianCategory: string): string {
  const categoryMap: Record<string, string> = {
    'Computing': 'hardware',
    'Mobile': 'hardware',
    'SBC': 'hardware',
    'Peripheral': 'hardware',
    'Component': 'hardware',
    'MCU': 'hardware',
    'IoT': 'hardware',
    'Software': 'software',
    'Documentation': 'documentation',
    'Consumable': 'consumables',
    'Other': 'other',
  }

  return categoryMap[obsidianCategory] || 'other'
}

/**
 * Read all inventory files from Obsidian
 */
function readInventoryFiles(): Map<string, InventoryItem> {
  const items = new Map<string, InventoryItem>()

  try {
    if (!fs.existsSync(INVENTORY_FOLDER)) {
      console.warn(`[Obsidian Sync] Inventory folder not found: ${INVENTORY_FOLDER}`)
      return items
    }

    // Recursively read all markdown files
    const readDir = (dir: string) => {
      const files = fs.readdirSync(dir)

      files.forEach(file => {
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)

        if (stat.isDirectory()) {
          // Skip templates and special folders
          if (!file.startsWith('_')) {
            readDir(filePath)
          }
        } else if (file.endsWith('.md') && !file.startsWith('_')) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8')
            const [frontmatter, markdown] = parseFrontmatter(content)

            if (frontmatter.name || frontmatter.item_id) {
              const item = obsidianToInventoryItem(filePath, frontmatter, markdown)
              items.set(item.id, item)
              console.log(`[Obsidian Sync] Loaded: ${item.name} (${item.id})`)
            }
          } catch (error) {
            console.error(`[Obsidian Sync] Failed to parse ${filePath}:`, error)
          }
        }
      })
    }

    readDir(INVENTORY_FOLDER)
  } catch (error) {
    console.error('[Obsidian Sync] Failed to read inventory folder:', error)
  }

  return items
}

/**
 * Get all inventory items from Obsidian
 */
export function getAllObsidianItems(): InventoryItem[] {
  const items = readInventoryFiles()
  return Array.from(items.values())
}

/**
 * Get item by Obsidian ID
 */
export function getObsidianItem(itemId: string): InventoryItem | null {
  const items = readInventoryFiles()
  return items.get(itemId) || null
}

/**
 * Watch Obsidian folder for changes (optional)
 */
export function watchObsidianFolder(
  callback: (items: InventoryItem[]) => void
): () => void {
  if (!fs.existsSync(INVENTORY_FOLDER)) {
    console.warn(`[Obsidian Sync] Cannot watch folder, does not exist: ${INVENTORY_FOLDER}`)
    return () => {}
  }

  const watcher = fs.watch(
    INVENTORY_FOLDER,
    { recursive: true },
    (_eventType: string, filename: string | null) => {
      if (filename && filename.endsWith('.md') && !filename.startsWith('_')) {
        console.log(`[Obsidian Sync] Change detected: ${filename}`)
        const items = readInventoryFiles()
        callback(Array.from(items.values()))
      }
    }
  )

  return () => watcher.close()
}

/**
 * Export inventory stats summary
 */
export function getInventoryStats() {
  const items = getAllObsidianItems()

  return {
    total: items.length,
    working: items.filter(i => i.condition === 'Working').length,
    broken: items.filter(i => i.condition === 'Broken').length,
    parts: items.filter(i => i.condition === 'Parts').length,
    unknown: items.filter(i => i.condition === 'Unknown').length,
    byCategory: items.reduce(
      (acc, item) => {
        acc[item.category] = (acc[item.category] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    ),
    byTag: items.reduce(
      (acc, item) => {
        item.tags?.forEach(tag => {
          acc[tag] = (acc[tag] || 0) + 1
        })
        return acc
      },
      {} as Record<string, number>
    ),
  }
}

export const VaultSync = {
  getAllItems: getAllObsidianItems,
  getItem: getObsidianItem,
  watch: watchObsidianFolder,
  stats: getInventoryStats,
  vaultPath: INVENTORY_FOLDER,
}
