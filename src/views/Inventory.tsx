import { useState, useEffect } from 'react'
import { AlertCircle, Plus, TrendingDown, Package } from 'lucide-react'
import type { InventoryItem, InventoryStat } from '../types'

export function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [stats, setStats] = useState<InventoryStat | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'low' | 'out-of-stock'>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchInventory()
  }, [])

  const fetchInventory = async () => {
    try {
      const [itemsRes, statsRes] = await Promise.all([
        fetch('/api/inventory/items'),
        fetch('/api/inventory/stats'),
      ])
      
      const itemsData = await itemsRes.json()
      const statsData = await statsRes.json()
      
      setItems(itemsData)
      setStats(statsData)
    } catch (err) {
      console.error('Failed to fetch inventory:', err)
    } finally {
      setLoading(false)
    }
  }

  const filteredItems = items.filter(item => {
    const matchesFilter = 
      filter === 'all' ||
      (filter === 'low' && item.status === 'low') ||
      (filter === 'out-of-stock' && item.status === 'out-of-stock')
    
    const matchesSearch = 
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.sku.toLowerCase().includes(search.toLowerCase())
    
    return matchesFilter && matchesSearch
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'in-stock':
        return 'text-green-400'
      case 'low':
        return 'text-amber-400'
      case 'out-of-stock':
        return 'text-red-400'
      default:
        return 'text-slate-400'
    }
  }

  const getConditionBg = (condition?: string) => {
    switch (condition) {
      case 'new':
        return 'bg-green-900/30 text-green-300'
      case 'good':
        return 'bg-blue-900/30 text-blue-300'
      case 'fair':
        return 'bg-amber-900/30 text-amber-300'
      case 'poor':
        return 'bg-red-900/30 text-red-300'
      case 'broken':
        return 'bg-slate-900/30 text-slate-300'
      default:
        return 'bg-slate-800/30 text-slate-400'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border border-violet-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gradient-to-b from-slate-950 to-slate-900">
      {/* Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-semibold text-slate-100">Inventory</h2>
          </div>
          <button className="px-3 py-1 bg-violet-600 hover:bg-violet-700 rounded text-sm text-white flex items-center gap-2 transition">
            <Plus className="w-4 h-4" />
            Add Item
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="bg-slate-800/50 rounded p-3">
              <div className="text-xs text-slate-400 mb-1">Total Items</div>
              <div className="text-lg font-bold text-slate-100">{stats.totalItems}</div>
            </div>
            <div className="bg-slate-800/50 rounded p-3">
              <div className="text-xs text-slate-400 mb-1">Total Value</div>
              <div className="text-lg font-bold text-slate-100">${stats.totalValue.toLocaleString()}</div>
            </div>
            <div className="bg-amber-900/30 rounded p-3 border border-amber-700/50">
              <div className="text-xs text-amber-300 mb-1">Low Stock</div>
              <div className="text-lg font-bold text-amber-200">{stats.lowStockCount}</div>
            </div>
            <div className="bg-red-900/30 rounded p-3 border border-red-700/50">
              <div className="text-xs text-red-300 mb-1">Out of Stock</div>
              <div className="text-lg font-bold text-red-200">{stats.outOfStockCount}</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search by name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Items</option>
            <option value="low">Low Stock</option>
            <option value="out-of-stock">Out of Stock</option>
          </select>
        </div>
      </div>

      {/* Items List */}
      <div className="flex-1 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-500">
            <p>No items found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="p-4 hover:bg-slate-800/50 transition cursor-pointer border-l-4 border-l-transparent hover:border-l-violet-500"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-slate-100">{item.name}</h3>
                    <p className="text-xs text-slate-500">SKU: {item.sku}</p>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold text-sm ${getStatusColor(item.status)}`}>
                      {item.quantity} / {item.maxThreshold}
                    </div>
                    <p className="text-xs text-slate-500 capitalize">{item.status}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-2">
                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded capitalize">
                    {item.category}
                  </span>
                  {item.condition && (
                    <span className={`text-xs px-2 py-1 rounded capitalize ${getConditionBg(item.condition)}`}>
                      {item.condition}
                    </span>
                  )}
                  {item.location && (
                    <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">
                      📍 {item.location}
                    </span>
                  )}
                </div>

                <div className="flex justify-between text-xs text-slate-400">
                  <div>
                    {item.supplier && <span>Supplier: {item.supplier}</span>}
                    {item.cost && <span className="ml-4">Cost: ${item.cost}</span>}
                  </div>
                  {item.lastRestockedAgo && (
                    <span>{item.lastRestockedAgo}</span>
                  )}
                </div>

                {item.notes && (
                  <p className="text-xs text-slate-500 mt-2 italic">{item.notes}</p>
                )}

                {/* Alert for low/out-of-stock */}
                {(item.status === 'low' || item.status === 'out-of-stock') && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-amber-300">
                    <AlertCircle className="w-4 h-4" />
                    <span>
                      {item.status === 'low' 
                        ? `Only ${item.quantity} left (min: ${item.minThreshold})`
                        : 'Out of stock - reorder needed'}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
