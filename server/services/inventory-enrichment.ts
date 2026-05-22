/**
 * Inventory Enrichment Service
 * 
 * When a new item is added, this service:
 * 1. Searches for the product online
 * 2. Extracts technical specifications
 * 3. Fills in missing details (cost, specs, retailer info)
 * 4. Uses OpenClaw/Claude for intelligent extraction
 */

import type { InventoryItem } from '../../src/types/index.js'

export interface EnrichmentRequest {
  item_id: string
  name: string
  model?: string
  category?: string
  existing_data?: Partial<InventoryItem>
}

export interface EnrichmentResult {
  item_id: string
  enriched_data: Partial<InventoryItem>
  specs: Record<string, string>
  source_urls?: string[]
  confidence: number // 0-1
}

/**
 * Main enrichment function
 * Calls OpenClaw/Claude to fetch and extract specs
 */
export async function enrichInventoryItem(
  request: EnrichmentRequest
): Promise<EnrichmentResult> {
  const { item_id, name, model, category, existing_data } = request

  // Step 1: Build search query
  const searchQuery = buildSearchQuery(name, model, category)
  console.log(`[Enrichment] Searching for: ${searchQuery}`)

  // Step 2: Call web search via Hermes to find product info
  const webResults = await searchProductInfo(searchQuery)

  // Step 3: Call OpenClaw/Claude to extract specs from web results
  const extractedSpecs = await extractSpecsWithAI(name, model, webResults)

  // Step 4: Merge with existing data
  const enrichedData = mergeEnrichedData(existing_data || {}, extractedSpecs)

  return {
    item_id,
    enriched_data: enrichedData,
    specs: extractedSpecs,
    source_urls: webResults.map(r => r.url),
    confidence: calculateConfidence(extractedSpecs),
  }
}

/**
 * Build intelligent search query based on available data
 */
function buildSearchQuery(name: string, model?: string, category?: string): string {
  let query = name

  if (model) query += ` ${model}`

  // Add category hints for better search results
  if (category) {
    if (category === 'hardware' && !query.includes('specs')) {
      query += ' specifications'
    }
  } else {
    query += ' specifications'
  }

  return query
}

/**
 * Search for product information (stub for actual web search)
 * In production, this would call a search API or Hermes web tools
 */
async function searchProductInfo(
  query: string
): Promise<Array<{ url: string; title: string; snippet: string }>> {
  // This is a stub. In production:
  // - Call DuckDuckGo, Google, or Bing API
  // - Use Hermes web_search tool
  // - Parse product pages (Amazon, manufacturer sites, etc.)

  console.log(`[Enrichment] Web search for: ${query}`)

  // Mock response for demo
  return [
    {
      url: 'https://example.com/product',
      title: query,
      snippet: `Product information for ${query}`,
    },
  ]
}

/**
 * Use OpenClaw/Claude to intelligently extract specs from web results
 * This is where the AI magic happens
 */
async function extractSpecsWithAI(
  name: string,
  model: string | undefined,
  webResults: Array<{ url: string; title: string; snippet: string }>
): Promise<Record<string, string>> {
  // Build prompt for Claude/OpenClaw
  const prompt = buildExtractionPrompt(name, model, webResults)

  // In production, this would:
  // 1. Call Hermes delegate_task with claude-code or opencode
  // 2. Or call OpenClaw directly via API
  // 3. Or use a local Claude instance

  console.log(`[Enrichment] Extracting specs for: ${name}`)

  // Example structured extraction
  const specs: Record<string, string> = {
    'Product Name': name,
    'Model': model || 'Unknown',
    'Manufacturer': extractManufacturer(name),
    'Category': categorizeProduct(name),
    // These would be filled by AI:
    'Specifications': 'Pending enrichment',
    'Price Range': 'Pending enrichment',
    'Availability': 'Pending enrichment',
  }

  return specs
}

/**
 * Build extraction prompt for Claude
 */
function buildExtractionPrompt(
  name: string,
  model: string | undefined,
  webResults: Array<{ url: string; title: string; snippet: string }>
): string {
  return `
Extract detailed technical specifications for:
Product: ${name}
Model: ${model || 'Unknown'}

Search Results:
${webResults.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}`).join('\n\n')}

Extract and format as JSON:
{
  "product_name": "",
  "manufacturer": "",
  "model": "",
  "specs": {
    "key_spec_1": "value",
    "key_spec_2": "value"
  },
  "estimated_price_usd": null,
  "availability": "in stock",
  "retailer_recommendations": ["store1", "store2"],
  "reviews_summary": "",
  "confidence": 0.0
}
`
}

/**
 * Extract manufacturer from product name using simple heuristics
 */
function extractManufacturer(name: string): string {
  const manufacturers: Record<string, string> = {
    'dell': 'Dell',
    'hp': 'HP',
    'lenovo': 'Lenovo',
    'samsung': 'Samsung',
    'apple': 'Apple',
    'nvidia': 'NVIDIA',
    'amd': 'AMD',
    'intel': 'Intel',
    'raspberry': 'Raspberry Pi Foundation',
    'arduino': 'Arduino',
    'jetson': 'NVIDIA',
  }

  const lowerName = name.toLowerCase()
  for (const [key, value] of Object.entries(manufacturers)) {
    if (lowerName.includes(key)) {
      return value
    }
  }

  return 'Unknown'
}

/**
 * Categorize product based on name
 */
function categorizeProduct(name: string): string {
  const lowerName = name.toLowerCase()

  if (lowerName.includes('phone') || lowerName.includes('samsung') || lowerName.includes('iphone')) {
    return 'Mobile Device'
  }
  if (lowerName.includes('laptop') || lowerName.includes('dell') || lowerName.includes('macbook')) {
    return 'Computing'
  }
  if (lowerName.includes('raspberry') || lowerName.includes('pi')) {
    return 'SBC'
  }
  if (lowerName.includes('gpu') || lowerName.includes('graphics') || lowerName.includes('nvidia')) {
    return 'Component'
  }
  if (lowerName.includes('headphones') || lowerName.includes('speaker') || lowerName.includes('watch')) {
    return 'Peripheral'
  }

  return 'Other'
}

/**
 * Merge enriched data with existing item data
 * Prioritize existing user data over enriched data
 */
function mergeEnrichedData(
  existingData: Partial<InventoryItem>,
  enrichedSpecs: Record<string, string>
): Partial<InventoryItem> {
  return {
    ...existingData,
    // Only fill in fields that don't already exist
    ...(enrichedSpecs['Product Name'] && !existingData.name && {
      name: enrichedSpecs['Product Name'],
    }),
    ...(enrichedSpecs['Model'] && !existingData.sku && {
      sku: enrichedSpecs['Model'],
    }),
    ...(enrichedSpecs['Specifications'] && !existingData.notes && {
      notes: enrichedSpecs['Specifications'],
    }),
  }
}

/**
 * Calculate enrichment confidence score
 */
function calculateConfidence(specs: Record<string, string>): number {
  let filledFields = 0
  const totalFields = 5 // Basic fields we want to fill

  if (specs['Product Name']) filledFields++
  if (specs['Manufacturer']) filledFields++
  if (specs['Model']) filledFields++
  if (specs['Specifications']) filledFields++
  if (specs['Price Range']) filledFields++

  return Math.min(1, filledFields / totalFields)
}

/**
 * Queue enrichment as a background job
 * This would be called when a new item is added
 */
export async function queueEnrichment(request: EnrichmentRequest): Promise<string> {
  // In production, this would:
  // 1. Store the request in a job queue (Redis, database, etc.)
  // 2. Have a worker process it asynchronously
  // 3. Update the item with enriched data when complete
  
  const jobId = `enrich-${request.item_id}-${Date.now()}`
  console.log(`[Enrichment] Queued job: ${jobId}`)

  // Simulate processing
  setTimeout(() => {
    enrichInventoryItem(request)
      .then(result => {
        console.log(`[Enrichment] Completed: ${jobId}`, result)
        // TODO: Update item in database
      })
      .catch(err => {
        console.error(`[Enrichment] Failed: ${jobId}`, err)
      })
  }, 1000)

  return jobId
}
