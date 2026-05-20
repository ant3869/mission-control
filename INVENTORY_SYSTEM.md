# Inventory System — Mission Control

## Overview

A complete **inventory management system** added to Mission Control for tracking hardware, software, consumables, documentation, and other assets across your homelab infrastructure.

### Features

✅ **Real-time inventory tracking** — quantity, status (in-stock/low/out-of-stock), condition  
✅ **Stock alerts** — automatic detection of low stock and out-of-stock items  
✅ **Asset categorization** — hardware, software, consumables, documentation, other  
✅ **Condition tracking** — new, good, fair, poor, broken  
✅ **Location tracking** — physical or digital location of each item  
✅ **Cost & value tracking** — unit cost and total inventory value  
✅ **Supplier management** — track suppliers and restock history  
✅ **Search & filter** — search by name or SKU, filter by status  
✅ **RESTful API** — full CRUD operations via backend  
✅ **Pre-populated data** — includes your current tech stack (RTX 5060 Ti, Proxmox, ComfyUI, etc.)

---

## What Was Added

### Frontend

#### 1. **Types** (`src/types/index.ts`)
- Added `'inventory'` to the `View` union type
- New types:
  - `InventoryStatus` — 'in-stock' | 'low' | 'out-of-stock' | 'discontinued'
  - `InventoryCategory` — 'hardware' | 'software' | 'consumables' | 'documentation' | 'other'
  - `InventoryCondition` — 'new' | 'good' | 'fair' | 'poor' | 'broken'
  - `InventoryItem` — full item schema
  - `InventoryStat` — inventory statistics (total items, value, alerts)

#### 2. **Inventory View** (`src/views/Inventory.tsx`)
- React component with:
  - Header with stats dashboard (total items, total value, low stock, out-of-stock counts)
  - Search & filter controls
  - Scrollable item list with status colors and alerts
  - Condition badges
  - Location tags
  - Last restocked timestamps
  - Visual warnings for low/out-of-stock items
  - Hover effects for interactivity

#### 3. **Navigation Integration**
- Updated `App.tsx` to import and render the Inventory view
- Updated `Sidebar.tsx` to include Inventory nav item with Package icon
- Inventory nav item appears in the "Knowledge & Resources" section alongside People, Office, etc.

### Backend

#### 4. **Inventory Routes** (`server/routes/inventory.ts`)
Complete RESTful API with endpoints:

```
GET  /api/inventory/items       — Fetch all items
GET  /api/inventory/items/:id   — Fetch single item
GET  /api/inventory/stats       — Fetch inventory statistics
POST /api/inventory/items       — Create new item
PATCH /api/inventory/items/:id  — Update item
DELETE /api/inventory/items/:id — Delete item
```

#### 5. **Pre-populated Data**
10 sample inventory items including:
- **RTX 5060 Ti** (your primary GPU)
- **DDR5 64GB RAM** (Nexus system memory)
- **NVMe SSDs** (distributed across systems)
- **Network cables** (CAT6A, low stock alert)
- **Power supply** (spare, out of stock)
- **Software licenses** (Proxmox, Obsidian)
- **Custom nodes** (ComfyUI documentation)
- **Consumables** (USB cables, thermal paste)

#### 6. **Server Integration** (`server/index.ts`)
- Imported and registered `inventoryRouter`
- Mounted at `/api/inventory` endpoint

---

## Data Model

### InventoryItem Schema

```typescript
{
  id: string                     // Unique identifier
  name: string                   // Item name
  sku: string                    // Stock keeping unit
  category: InventoryCategory    // Type of item
  quantity: number               // Current quantity in stock
  minThreshold: number           // Minimum before 'low' alert
  maxThreshold: number           // Maximum capacity
  status: InventoryStatus        // Computed from quantity & thresholds
  condition?: InventoryCondition // Physical condition
  location?: string              // Where it's stored
  cost?: number                  // Unit cost in USD
  supplier?: string              // Vendor name
  lastRestockedAgo?: string      // Human-readable time since restock
  notes?: string                 // Free-form notes
  tags?: string[]                // Searchable tags
}
```

### InventoryStat Schema

```typescript
{
  totalItems: number        // Count of all items
  totalValue: number        // Sum of (cost × quantity)
  lowStockCount: number     // Items with status='low'
  outOfStockCount: number   // Items with status='out-of-stock'
}
```

---

## Usage

### Viewing Inventory

1. Open Mission Control dashboard
2. Click **Inventory** in the sidebar (Package icon)
3. View all items with real-time stats dashboard at the top

### Filtering & Searching

- **Search** — Enter item name or SKU in the search box
- **Filter** — Use dropdown to filter by:
  - All Items
  - Low Stock (quantity ≤ minThreshold)
  - Out of Stock (quantity = 0)

### Adding Items (API)

```bash
curl -X POST http://localhost:3001/api/inventory/items \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New GPU",
    "sku": "NVIDIA-RTX5090",
    "category": "hardware",
    "quantity": 1,
    "minThreshold": 1,
    "maxThreshold": 2,
    "cost": 5000,
    "supplier": "NVIDIA Direct",
    "location": "Nexus — Slot 2",
    "notes": "Future upgrade"
  }'
```

### Updating Item Quantity (API)

```bash
curl -X PATCH http://localhost:3001/api/inventory/items/inv-4 \
  -H "Content-Type: application/json" \
  -d '{ "quantity": 8, "lastRestockedAgo": "Today" }'
```

### Frontend Status Colors

- 🟢 **Green** (in-stock) — Quantity is above minimum threshold
- 🟡 **Amber** (low) — Quantity ≤ minThreshold
- 🔴 **Red** (out-of-stock) — Quantity = 0

---

## Pre-populated Items

Your current tech stack is represented:

| Item | SKU | Category | Qty | Status | Cost | Location |
|------|-----|----------|-----|--------|------|----------|
| RTX 5060 Ti | NVIDIA-RTX5060-12GB | Hardware | 1 | ✅ In Stock | $2,500 | Nexus — Slot 1 |
| DDR5 64GB RAM | CORSAIR-DDR5-64GB | Hardware | 2 | ✅ In Stock | $400 | Nexus — Slots 1-2 |
| NVMe SSD 2TB | SK-HYNIX-NVMe-2TB | Hardware | 3 | ✅ In Stock | $180 | 3 Systems |
| Ethernet Cables | BELKIN-CAT6A-100FT | Consumables | 2 | ⚠️ Low | $45 | Network Closet |
| Power Supply 1600W | CORSAIR-AX1600-PLAT | Hardware | 0 | ❌ Out | $450 | Spare |
| Proxmox License | PROXMOX-SUPPORT-12M | Software | 1 | ✅ In Stock | $500 | Digital |
| ComfyUI Nodes | CUSTOM-NODE-COLLECTION-V1 | Documentation | 1 | ✅ In Stock | Free | GitHub |
| USB Type-C Cables | ANKER-USB-C-10PACK | Consumables | 5 | ⚠️ Low | $25 | Desk |
| Thermal Paste | NOCTUA-NT-H1-3.5G | Consumables | 0 | ❌ Out | $8 | — |
| Obsidian License | OBSIDIAN-COMMERCIAL-PERPETUAL | Software | 1 | ✅ In Stock | $40 | Digital |

---

## Next Steps (Optional)

### Enhancements to Consider

1. **Database persistence** — Replace in-memory array with SQLite/PostgreSQL
2. **Barcode scanning** — QR/barcode support for quick checkins/checkouts
3. **Audit logging** — Track who modified what and when
4. **Webhooks** — Trigger alerts when stock hits thresholds
5. **Export** — CSV/JSON export for inventory reports
6. **Image attachments** — Upload photos of items
7. **Deprecation tracking** — Mark items as discontinued
8. **Historical cost tracking** — Track price changes over time
9. **Multi-location support** — Detailed location hierarchies
10. **Integration with suppliers** — Auto-reorder when low

---

## Files Modified/Created

**Created:**
- `src/views/Inventory.tsx` — React UI component
- `server/routes/inventory.ts` — Backend API routes

**Modified:**
- `src/types/index.ts` — Added inventory types
- `src/App.tsx` — Added Inventory import and view route
- `src/components/layout/Sidebar.tsx` — Added Inventory nav item
- `server/index.ts` — Imported and mounted inventory router

---

## Architecture

```
Frontend (React)
  ├─ Inventory.tsx (Component)
  │  ├─ Fetches /api/inventory/items
  │  ├─ Fetches /api/inventory/stats
  │  └─ Real-time updates on filter/search
  │
Backend (Express)
  ├─ /api/inventory/items
  ├─ /api/inventory/items/:id
  └─ /api/inventory/stats
     └─ In-memory array (can be DB)
```

---

## Quick Start

1. **Start the API** (if not already running):
   ```bash
   cd /tmp/mission-control
   npm install
   npm run dev  # or appropriate dev command
   ```

2. **Open the dashboard**:
   - Navigate to Mission Control
   - Click **Inventory** in sidebar
   - View your current assets

3. **Explore the API**:
   ```bash
   curl http://localhost:3001/api/inventory/stats
   curl http://localhost:3001/api/inventory/items
   ```

---

## Notes

- **Data is currently in-memory** — Will reset on server restart. For production, integrate with a real database.
- **No authentication** — API endpoints are open. Add auth middleware in production.
- **Mock data matches your actual setup** — Feel free to update items to reflect real inventory.
- **Status is auto-calculated** — Based on quantity vs. min/max thresholds.

---

## Integration Points

The inventory system is designed to integrate with:

- **Radar** — Could include inventory costs in usage analytics
- **Approvals** — Restock requests could flow through the approval system
- **Projects** — Track inventory allocated to specific projects
- **Cron jobs** — Automated low-stock alerts
- **Discord** — Could push alerts to your Discord server

Let me know if you want any of these integrations! 🚀
