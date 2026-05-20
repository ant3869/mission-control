import { Router } from 'express'
import type { InventoryItem } from '../../src/types/index.js'
import { getAllObsidianItems, getInventoryStats } from '../services/obsidian-vault-sync.js'
import { queueEnrichment } from '../services/inventory-enrichment.js'

const router = Router()

// In-memory inventory store
let inventoryItems: InventoryItem[] = []

// Load from Obsidian on startup
async function loadFromObsidian() {
  try {
    const items = getAllObsidianItems()
    inventoryItems = items
    console.log(`[Inventory] Loaded ${items.length} items from Obsidian vault`)
  } catch (error) {
    console.error('[Inventory] Failed to load from Obsidian:', error)
  }
}

// Initialize on module load
loadFromObsidian().catch(err => console.error(err))

// GET /api/inventory/items
router.get('/items', (_req, res) => {
  res.json(inventoryItems)
})

// GET /api/inventory/stats
router.get('/stats', (_req, res) => {
  const stats = getInventoryStats()
  res.json({
    totalItems: stats.total,
    totalValue: 0, // Could calculate from cost data
    lowStockCount: 0,
    outOfStockCount: stats.broken + stats.parts,
    byCategory: stats.byCategory,
    byCondition: {
      working: stats.working,
      broken: stats.broken,
      parts: stats.parts,
      unknown: stats.unknown,
    },
  })
})

// GET /api/inventory/items/:id
router.get('/items/:id', (req, res) => {
  const item = inventoryItems.find(i => i.id === req.params.id)
  if (!item) {
    return res.status(404).json({ error: 'Item not found' })
  }
  res.json(item)
})

// POST /api/inventory/items — Create and auto-enrich with AI
router.post('/items', async (req, res) => {
  try {
    const { name, model, category, sku, quantity, notes } = req.body
    
    if (!name) {
      return res.status(400).json({ error: 'Item name is required' })
    }

    // Create base item
    const newItem: InventoryItem = {
      id: `item-${Date.now()}`,
      name,
      sku: sku || model || '',
      category: category || 'hardware',
      quantity: quantity || 1,
      minThreshold: 1,
      maxThreshold: 10,
      status: 'in-stock',
      notes: notes || '',
      tags: [],
    }

    inventoryItems.push(newItem)

    // Queue enrichment in background using OpenClaw/Hermes
    // This will fetch specs, price, manufacturer info, etc.
    queueEnrichment({
      item_id: newItem.id,
      name,
      model,
      category,
      existing_data: newItem,
    })
      .then(jobId => {
        console.log(`[Inventory] Enrichment queued: ${jobId}`)
      })
      .catch(err => {
        console.error('[Inventory] Failed to queue enrichment:', err)
      })

    res.status(201).json(newItem)
  } catch (error) {
    res.status(500).json({ error: 'Failed to create item' })
  }
})

// PATCH /api/inventory/items/:id
router.patch('/items/:id', (req, res) => {
  const item = inventoryItems.find(i => i.id === req.params.id)
  if (!item) {
    return res.status(404).json({ error: 'Item not found' })
  }

  Object.assign(item, req.body)

  // Recalculate status
  if (item.quantity === 0) {
    item.status = 'out-of-stock'
  } else if (item.quantity <= item.minThreshold) {
    item.status = 'low'
  } else {
    item.status = 'in-stock'
  }

  res.json(item)
})

// DELETE /api/inventory/items/:id
router.delete('/items/:id', (req, res) => {
  const index = inventoryItems.findIndex(i => i.id === req.params.id)
  if (index === -1) {
    return res.status(404).json({ error: 'Item not found' })
  }

  inventoryItems.splice(index, 1)
  res.status(204).send()
})

// POST /api/inventory/sync-obsidian — Sync from Obsidian vault
router.post('/sync-obsidian', async (_req, res) => {
  try {
    const items = getAllObsidianItems()
    inventoryItems = items

    res.json({
      success: true,
      imported: items.length,
      total: inventoryItems.length,
      message: `Synced ${items.length} items from Obsidian vault`,
    })
  } catch (error) {
    res.status(500).json({ error: 'Sync failed' })
  }
})

export const inventoryRouter = router
