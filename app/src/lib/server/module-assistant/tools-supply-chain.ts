/**
 * Supply Chain Module — Smart DB Tools
 *
 * Intent-based DB queries for products, orders, inventory,
 * QR tracking, warehouses, and stock movements.
 */
import 'server-only'
import { type SupabaseClient } from '@supabase/supabase-js'

// ─── Types ─────────────────────────────────────────────────────────

export type SCToolName =
  | 'productSummary'
  | 'totalProducts'
  | 'lowStockItems'
  | 'recentOrders'
  | 'orderSummary'
  | 'ordersByStatus'
  | 'qrBatchSummary'
  | 'qrCodeStats'
  | 'inventorySummary'
  | 'stockMovements'
  | 'warehouseList'
  | 'brandSummary'
  | 'categorySummary'
  | 'productSearch'
  | 'topSellingProducts'
  | 'pendingOrders'
  | 'distributorList'

export interface SCToolResult {
  success: boolean
  tool: string
  summary: string
  rows?: Record<string, any>[]
  totalCount?: number
  truncated?: boolean
  error?: string
}

const MAX_ROWS = 25

// ─── Intent Detection ──────────────────────────────────────────────

interface IntentPattern {
  tool: SCToolName
  patterns: RegExp[]
  priority: number
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    tool: 'totalProducts',
    patterns: [
      /\b(total|jumlah|berapa|how\s*many|show|list|senarai\w*|cek|check)\b.*\b(products?|produk|items?|barang)\b/i,
      /\b(products?|produk|items?|barang)\b.*\b(total|jumlah|berapa|how\s*many|count)\b/i,
      /^total\s*products?\s*\??$/i,
    ],
    priority: 10,
  },
  {
    tool: 'productSummary',
    patterns: [
      /\b(products?|produk)\b.*\b(summary|ringkasan|overview|stat)\b/i,
      /\b(summary|ringkasan|overview)\b.*\b(products?|produk)\b/i,
    ],
    priority: 9,
  },
  {
    tool: 'lowStockItems',
    patterns: [
      /\b(low\s*stock|stok\s*(rendah|sikit|kurang)|out\s*of\s*stock|habis\s*stok|reorder|kehabisan)\b/i,
      /\b(stock|stok|inventory)\b.*\b(low|rendah|sikit|kurang|habis|critical)\b/i,
    ],
    priority: 10,
  },
  {
    tool: 'recentOrders',
    patterns: [
      /\b(recent|terkini|latest|baru)\b.*\b(orders?|pesanan)\b/i,
      /\b(orders?|pesanan)\b.*\b(recent|terkini|latest|baru|last)\b/i,
    ],
    priority: 8,
  },
  {
    tool: 'orderSummary',
    patterns: [
      /\b(orders?|pesanan)\b.*\b(summary|ringkasan|total|stat|berapa|how\s*many)\b/i,
      /\b(summary|total|jumlah|berapa)\b.*\b(orders?|pesanan)\b/i,
      /^total\s*orders?\s*\??$/i,
    ],
    priority: 9,
  },
  {
    tool: 'ordersByStatus',
    patterns: [
      /\b(order|pesanan)\b.*\b(status|keadaan|pending|approved|draft|submitted|closed)\b/i,
      /\b(pending|approved|draft|submitted)\b.*\b(order|pesanan)\b/i,
    ],
    priority: 9,
  },
  {
    tool: 'pendingOrders',
    patterns: [
      /\b(pending|belum|menunggu)\b.*\b(order|pesanan|approval|kelulusan)\b/i,
      /\b(order|pesanan)\b.*\b(pending|belum|menunggu|await)\b/i,
    ],
    priority: 10,
  },
  {
    tool: 'qrBatchSummary',
    patterns: [
      /\b(qr)\b.*\b(batch|kumpulan)\b/i,
      /\b(batch|kumpulan)\b.*\b(qr|status|stat)\b/i,
      /^qr\s*batch(es)?\s*\??$/i,
    ],
    priority: 8,
  },
  {
    tool: 'qrCodeStats',
    patterns: [
      /\b(qr)\b.*\b(code|kod|stat|total|jumlah|berapa)\b/i,
      /\b(total|jumlah|berapa)\b.*\b(qr)\b/i,
    ],
    priority: 8,
  },
  {
    tool: 'inventorySummary',
    patterns: [
      /\b(inventory|inventori|stok|stock)\b.*\b(summary|ringkasan|total|stat|overview)\b/i,
      /\b(summary|total|overview)\b.*\b(inventory|inventori|stok|stock)\b/i,
    ],
    priority: 9,
  },
  {
    tool: 'stockMovements',
    patterns: [
      /\b(stock|stok)\b.*\b(movement|pergerakan|transfer|pindah)\b/i,
      /\b(movement|pergerakan|transfer|pindah)\b.*\b(stock|stok)\b/i,
    ],
    priority: 8,
  },
  {
    tool: 'warehouseList',
    patterns: [
      /\b(warehouse|gudang)\b/i,
    ],
    priority: 7,
  },
  {
    tool: 'brandSummary',
    patterns: [
      /\b(brand|jenama)\b.*\b(list|senarai|total|berapa|how\s*many|summary)\b/i,
      /\b(total|berapa|list|senarai)\b.*\b(brand|jenama)\b/i,
    ],
    priority: 7,
  },
  {
    tool: 'categorySummary',
    patterns: [
      /\b(category|kategori)\b.*\b(list|senarai|total|berapa|how\s*many|summary)\b/i,
      /\b(total|berapa|list|senarai)\b.*\b(category|kategori)\b/i,
    ],
    priority: 7,
  },
  {
    tool: 'productSearch',
    patterns: [
      /\b(cari|search|find|look\s*up|cek|check)\b.*\b(products?|produk|items?|barang)\b/i,
      /\b(products?|produk|items?|barang)\b.*\b(cari|search|find|cek|check)\b/i,
    ],
    priority: 6,
  },
  {
    tool: 'topSellingProducts',
    patterns: [
      /\b(top|terlaris|best[\s-]*sell\w*|paling\s*(laris|banyak)|popular|famous|highest)\b.*\b(products?|produk|items?)\b/i,
      /\b(products?|produk|items?)\b.*\b(top|terlaris|best[\s-]*sell\w*|paling\s*(laris|banyak)|popular|highest)\b/i,
    ],
    priority: 9,
  },
  {
    tool: 'distributorList',
    patterns: [
      /\b(distributor|pengedar|dealer|agent|ejen)\b/i,
    ],
    priority: 7,
  },
]

export function detectSCIntent(message: string): { tool: SCToolName | null; confidence: 'high' | 'medium' } {
  const lower = message.toLowerCase()
  let bestMatch: { tool: SCToolName; priority: number } | null = null
  for (const ip of INTENT_PATTERNS) {
    for (const p of ip.patterns) {
      if (p.test(lower)) {
        if (!bestMatch || ip.priority > bestMatch.priority) {
          bestMatch = { tool: ip.tool, priority: ip.priority }
        }
        break
      }
    }
  }
  return bestMatch
    ? { tool: bestMatch.tool, confidence: bestMatch.priority >= 8 ? 'high' : 'medium' }
    : { tool: null, confidence: 'medium' }
}

// ─── Tool Executor ─────────────────────────────────────────────────

export async function executeSCTool(
  toolName: SCToolName,
  supabase: SupabaseClient,
  orgId: string,
): Promise<SCToolResult> {
  try {
    switch (toolName) {
      case 'totalProducts': return await totalProducts(supabase, orgId)
      case 'productSummary': return await productSummary(supabase, orgId)
      case 'lowStockItems': return await lowStockItems(supabase, orgId)
      case 'recentOrders': return await recentOrders(supabase, orgId)
      case 'orderSummary': return await orderSummary(supabase, orgId)
      case 'ordersByStatus': return await ordersByStatus(supabase, orgId)
      case 'pendingOrders': return await pendingOrders(supabase, orgId)
      case 'qrBatchSummary': return await qrBatchSummary(supabase, orgId)
      case 'qrCodeStats': return await qrCodeStats(supabase, orgId)
      case 'inventorySummary': return await inventorySummary(supabase, orgId)
      case 'stockMovements': return await stockMovements(supabase, orgId)
      case 'warehouseList': return await warehouseList(supabase, orgId)
      case 'brandSummary': return await brandSummary(supabase)
      case 'categorySummary': return await categorySummary(supabase)
      case 'productSearch': return await totalProducts(supabase, orgId)
      case 'topSellingProducts': return await topSellingProducts(supabase, orgId)
      case 'distributorList': return await distributorList(supabase, orgId)
      default: return { success: false, tool: toolName, summary: 'Unknown tool' }
    }
  } catch (err: any) {
    console.error(`[SC Tool ${toolName}] Error:`, err.message)
    return { success: false, tool: toolName, summary: `Error: ${err.message}`, error: err.message }
  }
}

// ─── Tool Implementations ──────────────────────────────────────────

async function totalProducts(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  const { count: total } = await supabase.from('products').select('id', { count: 'exact', head: true }).eq('company_id', orgId)
  const { count: active } = await supabase.from('products').select('id', { count: 'exact', head: true }).eq('company_id', orgId).eq('is_active', true)
  const { count: variants } = await supabase.from('product_variants').select('id', { count: 'exact', head: true })
  const { count: categories } = await supabase.from('product_categories').select('id', { count: 'exact', head: true })
  const { count: brands } = await supabase.from('brands').select('id', { count: 'exact', head: true })

  return {
    success: true,
    tool: 'totalProducts',
    summary: `📦 **Product Overview:**\n- Total Products: **${total ?? 0}** (${active ?? 0} active)\n- Product Variants: **${variants ?? 0}**\n- Categories: **${categories ?? 0}**\n- Brands: **${brands ?? 0}**`,
    totalCount: total ?? 0,
  }
}

async function productSummary(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  const { data: products, count } = await supabase
    .from('products')
    .select('id, product_name, product_code, is_active', { count: 'exact' })
    .eq('company_id', orgId)
    .order('product_name')
    .limit(MAX_ROWS)

  return {
    success: true,
    tool: 'productSummary',
    summary: `📦 **Products** (${count ?? 0} total):\n${(products ?? []).slice(0, 15).map((p: any) => `- **${p.product_name}** (${p.product_code}) [${p.is_active ? 'Active' : 'Inactive'}]`).join('\n')}`,
    rows: products ?? [],
    totalCount: count ?? 0,
    truncated: (count ?? 0) > MAX_ROWS,
  }
}

async function lowStockItems(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  const { data, count } = await supabase
    .from('product_inventory')
    .select('id, variant_id, organization_id, quantity_on_hand, quantity_available, reorder_point, product_variants(variant_name, product_id, products(product_name))', { count: 'exact' })
    .eq('organization_id', orgId)
    .limit(200)

  // Filter for low stock (qty <= reorder_point or qty <= 0)
  const lowStock = (data ?? []).filter((item: any) => {
    const qty = item.quantity_available ?? item.quantity_on_hand ?? 0
    const reorder = item.reorder_point ?? 10
    return qty <= reorder
  }).slice(0, MAX_ROWS)

  const rows = lowStock.map((item: any) => ({
    product: (item.product_variants as any)?.products?.product_name ?? '—',
    variant: (item.product_variants as any)?.variant_name ?? '—',
    qty_available: item.quantity_available ?? 0,
    qty_on_hand: item.quantity_on_hand ?? 0,
    reorder_point: item.reorder_point ?? 0,
  }))

  return {
    success: true,
    tool: 'lowStockItems',
    summary: `⚠️ **Low Stock Items** (${lowStock.length} items):\n${rows.slice(0, 10).map(r => `- **${r.product}** (${r.variant}) — Qty: ${r.qty_available} / Reorder: ${r.reorder_point}`).join('\n') || 'No low stock items found'}`,
    rows,
    totalCount: lowStock.length,
  }
}

async function recentOrders(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  const { data, count } = await supabase
    .from('orders')
    .select('id, order_number, order_type, status, total_amount, created_at', { count: 'exact' })
    .eq('company_id', orgId)
    .order('created_at', { ascending: false })
    .limit(10)

  const rows = (data ?? []).map((o: any) => ({
    order_no: o.order_number,
    type: o.order_type,
    status: o.status,
    amount: o.total_amount,
    date: o.created_at?.split('T')[0],
  }))

  return {
    success: true,
    tool: 'recentOrders',
    summary: `📋 **Recent Orders** (${count ?? 0} total):\n${rows.map(r => `- **${r.order_no}** [${r.type}] — ${r.status} RM${r.amount ?? 0} (${r.date})`).join('\n') || 'No orders found'}`,
    rows,
    totalCount: count ?? 0,
  }
}

async function orderSummary(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  const { count: total } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('company_id', orgId)

  const statuses = ['draft', 'submitted', 'approved', 'closed', 'canceled']
  const rows: any[] = []
  for (const s of statuses) {
    const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('company_id', orgId).eq('status', s)
    if ((count ?? 0) > 0) rows.push({ status: s, count: count ?? 0 })
  }

  // Order types
  const types = ['H2M', 'D2H', 'S2D']
  const typeRows: any[] = []
  for (const t of types) {
    const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('company_id', orgId).eq('order_type', t)
    if ((count ?? 0) > 0) typeRows.push({ type: t, count: count ?? 0 })
  }

  return {
    success: true,
    tool: 'orderSummary',
    summary: `📋 **Order Summary** (${total ?? 0} total):\n\n**By Status:**\n${rows.map(r => `- ${r.status}: **${r.count}**`).join('\n')}\n\n**By Type:**\n${typeRows.map(r => `- ${r.type}: **${r.count}**`).join('\n')}`,
    totalCount: total ?? 0,
  }
}

async function ordersByStatus(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  return orderSummary(supabase, orgId)
}

async function pendingOrders(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  const { data, count } = await supabase
    .from('orders')
    .select('id, order_number, order_type, total_amount, created_at', { count: 'exact' })
    .eq('company_id', orgId)
    .in('status', ['draft', 'submitted'])
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)

  return {
    success: true,
    tool: 'pendingOrders',
    summary: `⏳ **Pending Orders** (${count ?? 0}):\n${(data ?? []).slice(0, 10).map((o: any) => `- **${o.order_number}** [${o.order_type}] — RM${o.total_amount ?? 0} (${o.created_at?.split('T')[0]})`).join('\n') || 'No pending orders'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

async function qrBatchSummary(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  const { count: total } = await supabase.from('qr_batches').select('id', { count: 'exact', head: true }).eq('company_id', orgId)
  const { data: batches } = await supabase
    .from('qr_batches')
    .select('id, batch_number, total_unique_codes, status, packing_status, receiving_status, created_at')
    .eq('company_id', orgId)
    .order('created_at', { ascending: false })
    .limit(10)

  return {
    success: true,
    tool: 'qrBatchSummary',
    summary: `📱 **QR Batches** (${total ?? 0} total):\n${(batches ?? []).map((b: any) => `- **${b.batch_number ?? b.id}** — ${b.total_unique_codes ?? 0} codes [${b.status}] Pack:${b.packing_status} Recv:${b.receiving_status}`).join('\n') || 'No QR batches'}`,
    rows: batches ?? [],
    totalCount: total ?? 0,
  }
}

async function qrCodeStats(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  const { count: totalCodes } = await supabase.from('qr_codes').select('id', { count: 'exact', head: true }).eq('company_id', orgId)
  const { count: activated } = await supabase.from('qr_codes').select('id', { count: 'exact', head: true }).eq('company_id', orgId).not('activated_at', 'is', null)
  const { count: masterCodes } = await supabase.from('qr_master_codes').select('id', { count: 'exact', head: true })

  return {
    success: true,
    tool: 'qrCodeStats',
    summary: `📱 **QR Code Stats:**\n- Total QR Codes: **${totalCodes ?? 0}**\n- Activated: **${activated ?? 0}**\n- Not Activated: **${(totalCodes ?? 0) - (activated ?? 0)}**\n- Master Codes: **${masterCodes ?? 0}**`,
  }
}

async function inventorySummary(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  const { data, count } = await supabase
    .from('product_inventory')
    .select('id, quantity_on_hand, quantity_allocated, quantity_available, reorder_point', { count: 'exact' })
    .eq('organization_id', orgId)
    .limit(1000)

  let totalOnHand = 0, totalAvailable = 0, lowCount = 0
  for (const item of (data ?? [])) {
    totalOnHand += item.quantity_on_hand ?? 0
    totalAvailable += item.quantity_available ?? 0
    if ((item.quantity_available ?? 0) <= (item.reorder_point ?? 0)) lowCount++
  }

  return {
    success: true,
    tool: 'inventorySummary',
    summary: `📦 **Inventory Summary:**\n- SKUs Tracked: **${count ?? 0}**\n- Total On Hand: **${totalOnHand}** units\n- Total Available: **${totalAvailable}** units\n- Low Stock Items: **${lowCount}** ⚠️`,
    totalCount: count ?? 0,
  }
}

async function stockMovements(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  const { data, count } = await supabase
    .from('stock_movements')
    .select('id, movement_type, quantity_change, reference_type, created_at', { count: 'exact' })
    .eq('company_id', orgId)
    .order('created_at', { ascending: false })
    .limit(15)

  return {
    success: true,
    tool: 'stockMovements',
    summary: `📋 **Recent Stock Movements** (${count ?? 0} total):\n${(data ?? []).slice(0, 10).map((m: any) => `- [${m.movement_type}] ${m.quantity_change > 0 ? '+' : ''}${m.quantity_change} (ref: ${m.reference_type}) — ${m.created_at?.split('T')[0]}`).join('\n') || 'No movements found'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

async function warehouseList(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  const { data, count } = await supabase
    .from('organizations')
    .select('id, org_code, org_name, org_type_code, address', { count: 'exact' })
    .in('org_type_code', ['WAREHOUSE', 'WH'])
    .limit(MAX_ROWS)

  return {
    success: true,
    tool: 'warehouseList',
    summary: `🏭 **Warehouses** (${count ?? 0}):\n${(data ?? []).map((w: any) => `- **${w.org_name}** (${w.org_code})`).join('\n') || 'No warehouses configured'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

async function brandSummary(supabase: SupabaseClient): Promise<SCToolResult> {
  const { data, count } = await supabase
    .from('brands')
    .select('id, brand_code, brand_name', { count: 'exact' })
    .order('brand_name')
    .limit(MAX_ROWS)

  return {
    success: true,
    tool: 'brandSummary',
    summary: `🏷️ **Brands** (${count ?? 0}):\n${(data ?? []).map((b: any) => `- **${b.brand_name}** (${b.brand_code})`).join('\n') || 'No brands found'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

async function categorySummary(supabase: SupabaseClient): Promise<SCToolResult> {
  const { data, count } = await supabase
    .from('product_categories')
    .select('id, category_code, category_name', { count: 'exact' })
    .order('category_name')
    .limit(MAX_ROWS)

  return {
    success: true,
    tool: 'categorySummary',
    summary: `📂 **Categories** (${count ?? 0}):\n${(data ?? []).map((c: any) => `- **${c.category_name}** (${c.category_code})`).join('\n') || 'No categories found'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

async function topSellingProducts(supabase: SupabaseClient, orgId: string): Promise<SCToolResult> {
  // Get order items aggregated by product
  const { data: items } = await supabase
    .from('order_items')
    .select('product_id, qty, line_total, products(product_name)')
    .limit(2000)

  const productMap = new Map<string, { name: string; totalQty: number; totalRevenue: number; orderCount: number }>()
  for (const item of (items ?? [])) {
    const pid = item.product_id
    const existing = productMap.get(pid)
    const name = (item as any).products?.product_name ?? '—'
    if (!existing) {
      productMap.set(pid, { name, totalQty: item.qty ?? 0, totalRevenue: item.line_total ?? 0, orderCount: 1 })
    } else {
      existing.totalQty += item.qty ?? 0
      existing.totalRevenue += item.line_total ?? 0
      existing.orderCount++
    }
  }

  const sorted = Array.from(productMap.values()).sort((a, b) => b.totalQty - a.totalQty).slice(0, 10)

  return {
    success: true,
    tool: 'topSellingProducts',
    summary: `🏆 **Top Selling Products:**\n${sorted.map((p, i) => `${i + 1}. **${p.name}** — ${p.totalQty} units (RM${p.totalRevenue.toLocaleString()}) in ${p.orderCount} orders`).join('\n') || 'No order data available'}`,
    rows: sorted,
    totalCount: sorted.length,
  }
}

async function distributorList(supabase: SupabaseClient, _orgId: string): Promise<SCToolResult> {
  const { data, count } = await supabase
    .from('organizations')
    .select('id, org_code, org_name, contact_email, contact_phone', { count: 'exact' })
    .eq('org_type_code', 'DISTRIBUTOR')
    .order('org_name')
    .limit(MAX_ROWS)

  return {
    success: true,
    tool: 'distributorList',
    summary: `🚚 **Distributors** (${count ?? 0}):\n${(data ?? []).map((d: any) => `- **${d.org_name}** (${d.org_code}) ${d.contact_phone ?? ''}`).join('\n') || 'No distributors found'}`,
    rows: data ?? [],
    totalCount: count ?? 0,
  }
}

// ─── Suggestions ───────────────────────────────────────────────────

export const SC_SUGGESTIONS = [
  { label: 'Total products?', intent: 'totalProducts' },
  { label: 'Low stock items?', intent: 'lowStockItems' },
  { label: 'Recent orders?', intent: 'recentOrders' },
  { label: 'Pending orders?', intent: 'pendingOrders' },
  { label: 'QR batch status?', intent: 'qrBatchSummary' },
  { label: 'Inventory summary?', intent: 'inventorySummary' },
]
