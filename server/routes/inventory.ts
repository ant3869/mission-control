import { Router } from 'express'
import type { InventoryItem, InventoryStat } from '../../src/types/index.js'

const router = Router()

// Mock data — in production, use a real database
const inventoryItems: InventoryItem[] = [
  {
    id: 'inv-1',
    name: 'RTX 5060 Ti',
    sku: 'NVIDIA-RTX5060-12GB',
    category: 'hardware',
    quantity: 1,
    minThreshold: 1,
    maxThreshold: 5,
    status: 'in-stock',
    condition: 'new',
    location: 'Nexus — Slot 1',
    cost: 2500,
    supplier: 'NVIDIA Direct',
    lastRestockedAgo: '3 months ago',
    notes: 'Primary GPU for ComfyUI & inference workloads',
    tags: ['gpu', 'ai', 'production'],
  },
  {
    id: 'inv-2',
    name: 'DDR5 64GB RAM',
    sku: 'CORSAIR-DDR5-64GB',
    category: 'hardware',
    quantity: 2,
    minThreshold: 2,
    maxThreshold: 8,
    status: 'in-stock',
    condition: 'good',
    location: 'Nexus — Slots 1-2',
    cost: 400,
    supplier: 'Corsair',
    lastRestockedAgo: '6 months ago',
    notes: 'Ryzen 9 7950X system memory',
    tags: ['memory', 'system', 'upgradeable'],
  },
  {
    id: 'inv-3',
    name: 'NVMe SSD 2TB',
    sku: 'SK-HYNIX-NVMe-2TB',
    category: 'hardware',
    quantity: 3,
    minThreshold: 2,
    maxThreshold: 6,
    status: 'in-stock',
    condition: 'good',
    location: 'Nexus, HP-NEXCO (1x), Dell T340',
    cost: 180,
    supplier: 'SK Hynix',
    lastRestockedAgo: '2 months ago',
    notes: 'System drives and project storage',
    tags: ['storage', 'nvme', 'distributed'],
  },
  {
    id: 'inv-4',
    name: 'Ethernet Cables CAT6A',
    sku: 'BELKIN-CAT6A-100FT',
    category: 'consumables',
    quantity: 2,
    minThreshold: 3,
    maxThreshold: 10,
    status: 'low',
    condition: 'good',
    location: 'Network Closet',
    cost: 45,
    supplier: 'Belkin',
    lastRestockedAgo: '8 months ago',
    notes: 'Homelab networking — reorder soon',
    tags: ['networking', 'consumable', 'critical'],
  },
  {
    id: 'inv-5',
    name: 'Power Supply 1600W',
    sku: 'CORSAIR-AX1600-PLAT',
    category: 'hardware',
    quantity: 0,
    minThreshold: 1,
    maxThreshold: 2,
    status: 'out-of-stock',
    condition: 'good',
    location: 'Dell T340 (spare)',
    cost: 450,
    supplier: 'Corsair',
    lastRestockedAgo: '12 months ago',
    notes: 'Critical spare for server infrastructure',
    tags: ['power', 'server', 'urgent'],
  },
  {
    id: 'inv-6',
    name: 'Proxmox License',
    sku: 'PROXMOX-SUPPORT-12M',
    category: 'software',
    quantity: 1,
    minThreshold: 1,
    maxThreshold: 1,
    status: 'in-stock',
    condition: 'new',
    location: 'Digital License',
    cost: 500,
    supplier: 'Proxmox',
    lastRestockedAgo: '1 month ago',
    notes: 'Support + updates for Dell T340 Proxmox 9.x',
    tags: ['software', 'license', 'virtualization'],
  },
  {
    id: 'inv-7',
    name: 'ComfyUI Nodes (Custom)',
    sku: 'CUSTOM-NODE-COLLECTION-V1',
    category: 'documentation',
    quantity: 1,
    minThreshold: 1,
    maxThreshold: 1,
    status: 'in-stock',
    condition: 'good',
    location: 'GitHub Repo',
    cost: 0,
    notes: 'Custom node implementations for generative AI',
    tags: ['ai', 'documentation', 'development'],
  },
  {
    id: 'inv-8',
    name: 'USB Type-C Cables',
    sku: 'ANKER-USB-C-10PACK',
    category: 'consumables',
    quantity: 5,
    minThreshold: 8,
    maxThreshold: 20,
    status: 'low',
    condition: 'good',
    location: 'Desk Drawer',
    cost: 25,
    supplier: 'Anker',
    lastRestockedAgo: '10 months ago',
    notes: 'Charging & data cables for various devices',
    tags: ['cable', 'consumable', 'mobile'],
  },
  {
    id: 'inv-9',
    name: 'Thermal Paste (Noctua)',
    sku: 'NOCTUA-NT-H1-3.5G',
    category: 'consumables',
    quantity: 0,
    minThreshold: 2,
    maxThreshold: 5,
    status: 'out-of-stock',
    condition: 'new',
    cost: 8,
    supplier: 'Noctua',
    notes: 'For CPU cooler maintenance — needed for T340 maintenance',
    tags: ['maintenance', 'consumable', 'urgent'],
  },
  {
    id: 'inv-10',
    name: 'Obsidian Vault License',
    sku: 'OBSIDIAN-COMMERCIAL-PERPETUAL',
    category: 'software',
    quantity: 1,
    minThreshold: 1,
    maxThreshold: 1,
    status: 'in-stock',
    condition: 'new',
    location: 'Digital License',
    cost: 40,
    supplier: 'Obsidian',
    lastRestockedAgo: '18 months ago',
    notes: 'Second Brain PKM for research & notes',
    tags: ['software', 'license', 'productivity'],
  },
]

// GET /api/inventory/items
router.get('/items', (_req, res) => {
  res.json(inventoryItems)
})

// GET /api/inventory/stats
router.get('/stats', (_req, res) => {
  const stats: InventoryStat = {
    totalItems: inventoryItems.length,
    totalValue: inventoryItems.reduce((sum, item) => sum + ((item.cost ?? 0) * item.quantity), 0),
    lowStockCount: inventoryItems.filter(i => i.status === 'low').length,
    outOfStockCount: inventoryItems.filter(i => i.status === 'out-of-stock').length,
  }
  res.json(stats)
})

// GET /api/inventory/items/:id
router.get('/items/:id', (req, res) => {
  const item = inventoryItems.find(i => i.id === req.params.id)
  if (!item) {
    return res.status(404).json({ error: 'Item not found' })
  }
  res.json(item)
})

// POST /api/inventory/items (add new item)
router.post('/items', (req, res) => {
  const { name, sku, category, quantity, minThreshold, maxThreshold } = req.body
  
  if (!name || !sku || !category) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const newItem: InventoryItem = {
    id: `inv-${Date.now()}`,
    name,
    sku,
    category,
    quantity,
    minThreshold,
    maxThreshold,
    status: quantity === 0 ? 'out-of-stock' : quantity <= minThreshold ? 'low' : 'in-stock',
    ...req.body,
  }

  inventoryItems.push(newItem)
  res.status(201).json(newItem)
})

// PATCH /api/inventory/items/:id (update item)
router.patch('/items/:id', (req, res) => {
  const item = inventoryItems.find(i => i.id === req.params.id)
  if (!item) {
    return res.status(404).json({ error: 'Item not found' })
  }

  // Update fields
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

export const inventoryRouter = router
