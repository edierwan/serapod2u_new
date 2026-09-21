import fs from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  FUTURE_ORDER_DATE_MESSAGE,
  addDaysToDateKey,
  businessDateStartUtc,
  formatDateKey,
  formatDateKeyLong,
  formatDateKeyShort,
  isDateKey,
  isMissingOrderDateColumn,
  isMissingOrderDateRpcParameter,
  malaysiaDateOf,
  malaysiaToday,
  orderBusinessDate,
  validateOrderDate,
} from './order-date'
import { sortOrders } from './order-list-sort'
import { ClassicTemplate, type TemplateDocumentData, type TemplateOrderData } from '@/lib/pdf-templates'

/**
 * D2H Sales Order backdating: orders.order_date is the business/SO date,
 * orders.created_at stays the real creation instant.
 */

const APP_SRC = path.resolve(__dirname, '../..')
const REPO = path.resolve(APP_SRC, '../..')
const read = (relative: string) => fs.readFileSync(path.resolve(APP_SRC, relative), 'utf8')
const readMigration = (name: string) => fs.readFileSync(path.resolve(REPO, 'supabase/migrations', name), 'utf8')

/** 21 Sep 2026, 10:00 in Malaysia — the scenario date. */
const NOW = new Date('2026-09-21T10:00:00+08:00')

// ═══ Calendar helpers ══════════════════════════════════════════════════════

describe('Malaysia business date helpers', () => {
  it('1. defaults to today in Asia/Kuala_Lumpur', () => {
    expect(malaysiaToday(NOW)).toBe('2026-09-21')
  })

  it('22. does not shift to the UTC date around Malaysian midnight', () => {
    // 00:30 MYT on 22 Sep is still 21 Sep in UTC — the business date is the 22nd.
    expect(malaysiaToday(new Date('2026-09-21T16:30:00.000Z'))).toBe('2026-09-22')
    // 07:59 MYT on 1 Sep is 31 Aug 23:59 UTC.
    expect(malaysiaDateOf('2026-08-31T23:59:00.000Z')).toBe('2026-09-01')
    // 23:59 MYT on 31 Aug stays in August.
    expect(malaysiaDateOf('2026-08-31T15:59:59.000Z')).toBe('2026-08-31')
  })

  it('2/3. allows today and past dates, rejects a future date', () => {
    expect(validateOrderDate('2026-09-21', NOW)).toEqual({ ok: true, orderDate: '2026-09-21', isBackdated: false })
    expect(validateOrderDate('2026-09-15', NOW)).toEqual({ ok: true, orderDate: '2026-09-15', isBackdated: true })
    expect(validateOrderDate('2026-08-31', NOW)).toEqual({ ok: true, orderDate: '2026-08-31', isBackdated: true })
    expect(validateOrderDate('2026-09-22', NOW)).toEqual({ ok: false, error: FUTURE_ORDER_DATE_MESSAGE })
    expect(FUTURE_ORDER_DATE_MESSAGE).toBe('SO Date cannot be in the future.')
  })

  it('judges "future" by the Malaysia day, not the UTC day', () => {
    // 00:30 MYT on the 22nd: the 22nd is today, not the future.
    const justAfterMidnight = new Date('2026-09-21T16:30:00.000Z')
    expect(validateOrderDate('2026-09-22', justAfterMidnight).ok).toBe(true)
    expect(validateOrderDate('2026-09-23', justAfterMidnight).ok).toBe(false)
  })

  it('rejects malformed and impossible dates', () => {
    expect(validateOrderDate('', NOW).ok).toBe(false)
    expect(validateOrderDate('2026-02-30', NOW).ok).toBe(false)
    expect(validateOrderDate('15/09/2026', NOW).ok).toBe(false)
    expect(isDateKey('2028-02-29')).toBe(true)
  })

  it('formats a DATE directly, with no browser/UTC day shift', () => {
    expect(formatDateKey('2026-09-15')).toBe('15/09/2026')
    expect(formatDateKeyShort('2026-09-15')).toBe('15/09/26')
    expect(formatDateKeyLong('2026-09-15')).toBe('15 Sep 2026')
    expect(formatDateKey(null)).toBe('—')
  })

  it('21. a legacy order without order_date resolves to the MYT date of created_at', () => {
    expect(orderBusinessDate({ order_date: null, created_at: '2026-08-31T16:30:00.000Z' })).toBe('2026-09-01')
    expect(orderBusinessDate({ created_at: '2026-09-15T02:00:00+00:00' })).toBe('2026-09-15')
    // A stored order_date always wins over created_at.
    expect(orderBusinessDate({ order_date: '2026-09-15', created_at: '2026-09-21T02:00:00.000Z' })).toBe('2026-09-15')
  })

  it('maps a business date to the instant its Malaysia day starts', () => {
    expect(businessDateStartUtc('2026-09-01')).toBe('2026-08-31T16:00:00.000Z')
    expect(addDaysToDateKey('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('recognises a database without the order_date column or RPC parameter', () => {
    expect(isMissingOrderDateColumn({ code: '42703', message: 'column orders.order_date does not exist' })).toBe(true)
    expect(isMissingOrderDateColumn({ code: '42703', message: 'column orders.foo does not exist' })).toBe(false)
    expect(isMissingOrderDateRpcParameter({
      code: 'PGRST202',
      message: 'Could not find the function public.submit_and_allocate_d2h_order(p_buyer_org_id, ..., p_order_date) in the schema cache',
    })).toBe(true)
    expect(isMissingOrderDateRpcParameter({ code: 'P0001', message: 'SO Date cannot be in the future.' })).toBe(false)
  })
})

// ═══ Migration: column, backfill, default, guard ═══════════════════════════

describe('orders.order_date migration (static — NOT executed)', () => {
  const sql = readMigration('20260921120000_add_orders_order_date.sql')

  it('adds the column additively', () => {
    expect(sql).toMatch(/ALTER TABLE public\.orders\s+ADD COLUMN IF NOT EXISTS order_date date;/)
  })

  it('9. backfills every legacy order with the Asia/Kuala_Lumpur date of created_at', () => {
    expect(sql).toContain("SET order_date = (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date")
    // The same rule the application falls back to.
    expect(orderBusinessDate({ created_at: '2026-08-31T16:30:00.000Z' })).toBe('2026-09-01')
  })

  it('never rewrites created_at, and keeps updated_at out of the backfill', () => {
    expect(sql).not.toMatch(/SET\s+created_at/i)
    expect(sql).not.toMatch(/SET\s+updated_at/i)
    expect(sql).toContain('ALTER TABLE public.orders DISABLE TRIGGER orders_updated_at;')
    expect(sql).toContain('ALTER TABLE public.orders ENABLE TRIGGER orders_updated_at;')
    expect(sql.indexOf('DISABLE TRIGGER orders_updated_at')).toBeLessThan(sql.indexOf('UPDATE public.orders'))
  })

  it('defaults new rows to the Malaysia date, then enforces NOT NULL', () => {
    expect(sql).toContain("ALTER COLUMN order_date SET DEFAULT ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date)")
    expect(sql).toContain('ALTER COLUMN order_date SET NOT NULL')
    expect(sql).not.toMatch(/DEFAULT\s+(CURRENT_DATE|now\(\)::date)/i)
  })

  it('guards every write path against future dates and fills a missing date', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF order_date ON public.orders')
    expect(sql).toContain("RAISE EXCEPTION 'Order Date cannot be in the future.'")
  })

  it('documents and indexes the column for reporting', () => {
    expect(sql).toContain('COMMENT ON COLUMN public.orders.order_date IS')
    expect(sql).toMatch(/created_at remains the actual system\/audit creation timestamp/)
    expect(sql).toContain('idx_orders_order_date')
    expect(sql).toContain('idx_orders_type_order_date')
  })
})

// ═══ Atomic D2H submit RPC ═════════════════════════════════════════════════

describe('submit_and_allocate_d2h_order with p_order_date (static — NOT executed)', () => {
  const sql = readMigration('20260921120100_d2h_submit_order_date.sql')
  const original = readMigration('20260720_hq_warehouse_fulfillment_01.sql')
  const body = (source: string, marker: string) => {
    const start = source.indexOf(marker)
    return source.slice(start, source.indexOf('$$;', start))
  }
  const next = body(sql, 'CREATE FUNCTION public.submit_and_allocate_d2h_order(')
  const prev = body(original, 'CREATE OR REPLACE FUNCTION public.submit_and_allocate_d2h_order(')

  it('6. replaces the 8-arg signature with one 9-arg function so existing named calls stay unambiguous', () => {
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.submit_and_allocate_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text);')
    expect(next).toContain('p_idempotency_key text DEFAULT NULL,\n  p_order_date date DEFAULT NULL\n) RETURNS public.orders')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.submit_and_allocate_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text, date)')
    expect(sql).toContain('TO authenticated, service_role')
  })

  it('21. a caller without p_order_date gets today in Asia/Kuala_Lumpur', () => {
    expect(next).toContain("v_order_date date := COALESCE(p_order_date, (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date);")
  })

  it('3/13. rejects a future SO date authoritatively, before any write', () => {
    expect(next).toContain('IF v_order_date > v_today THEN')
    expect(next).toContain("RAISE EXCEPTION 'SO Date cannot be in the future.'")
    expect(next.indexOf('IF v_order_date > v_today')).toBeLessThan(next.indexOf('INSERT INTO public.orders'))
  })

  it('4/5. persists order_date in the same insert and never backdates created_at', () => {
    expect(next).toContain('has_redeem, notes, created_by, order_date')
    expect(next).toContain('true, p_notes, v_actor, v_order_date')
    expect(next).not.toMatch(/created_at\s*[:=,]/)
    expect(next).toContain('updated_at = now()')
  })

  it('7/8/24. keeps allocation, locking, idempotency and validation byte-for-byte', () => {
    const strip = (source: string) => source
      .replace(/CREATE (OR REPLACE )?FUNCTION/, 'CREATE FUNCTION')
      .replace(/,\n  p_order_date date DEFAULT NULL/, '')
      .replace(/\n  v_today date :=[^\n]*\n  v_order_date date :=[^\n]*/, '')
      .replace(/\n  -- Business SO date:[\s\S]*?\n  END IF;/, '')
      .replace(', order_date\n', '\n')
      .replace(', v_actor, v_order_date\n', ', v_actor\n')
    expect(strip(next)).toBe(strip(prev))
    expect(next).toContain('PERFORM public.allocate_inventory_for_order(v_order.id);')
    expect(next).toContain('FROM public.d2h_order_submit_idempotency')
    expect(next).toContain('pg_advisory_xact_lock')
  })

  it('14. leaves order numbering to the existing insert triggers', () => {
    expect(next).not.toMatch(/order_no|display_doc_no|base_seq/)
  })

  it('6. existing callers keep calling without p_order_date', () => {
    const serapp = read('lib/serapp/assistant-actions.ts')
    expect(serapp).toContain("'submit_and_allocate_d2h_order'")
    expect(serapp).not.toContain('p_order_date')
  })
})

// ═══ D2H create screen ═════════════════════════════════════════════════════

describe('D2H create screen SO Date', () => {
  const source = read('components/orders/DistributorOrderView.tsx')

  it('1. defaults to today in Malaysia and caps the picker at today', () => {
    expect(source).toContain('useState(() => malaysiaToday())')
    expect(source).toContain('max={todayMyt}')
    expect(source).toContain('type="date"')
  })

  it('sits in the first header card: below Fulfillment Warehouse, above the warehouse note and Customer Information', () => {
    const warehouse = source.indexOf('Fulfillment Warehouse <span')
    const soDate = source.indexOf('SO Date <span')
    const note = source.indexOf('Stock for this order will be allocated and fulfilled from this warehouse.')
    const customer = source.indexOf('{/* Customer Information */}')
    const products = source.indexOf('Product Selection')
    expect(warehouse).toBeGreaterThan(-1)
    expect(soDate).toBeGreaterThan(warehouse)
    expect(note).toBeGreaterThan(soDate)
    expect(customer).toBeGreaterThan(note)
    if (products > -1) expect(soDate).toBeLessThan(products)
  })

  it('shows a subtle Backdated SO badge for a past date', () => {
    expect(source).toContain('Backdated SO')
    expect(source).toContain('orderDateBackdated')
  })

  it('3. re-validates on submit, not only through <input max>', () => {
    expect(source).toContain('validateOrderDate(orderDateTouched ? orderDate : malaysiaToday())')
  })

  it('4. sends the selected SO date into the atomic D2H RPC', () => {
    expect(source).toContain("rpc('submit_and_allocate_d2h_order', {\n        ...submitArgs,\n        p_order_date: soDate,")
  })

  it('refuses a backdated SO on a database without the RPC migration instead of silently using today', () => {
    expect(source).toContain('isMissingOrderDateRpcParameter(submitError)')
    expect(source).toContain('Backdated SO Date is not available yet')
  })
})

// ═══ SO detail, Orders list ════════════════════════════════════════════════

describe('10. SO detail shows the business date', () => {
  const source = read('components/orders/ViewOrderDetailsView.tsx')
  it('renders order_date (legacy fallback) in the header, and keeps the signature date as created_at', () => {
    expect(source).toContain('{formatDateKey(orderBusinessDate(orderData))}')
    expect(source).not.toContain("new Date(orderData.created_at).toLocaleDateString('en-MY')}</span>")
    // The "Created by" signature date is an audit timestamp and stays created_at.
    expect(source).toContain("orderData.created_at ? new Date(orderData.created_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })")
  })
})

describe('12. Orders list DATE column', () => {
  const source = read('components/orders/OrdersView.tsx')

  it('displays and sorts by the business date', () => {
    expect(source).toContain('{formatDateKeyShort(orderBusinessDate(order))}')
    expect(source).toContain("onClick={() => handleSort('order_date')}")
    expect(source).toContain("useState<string>('order_date')")
  })

  it('sorts a backdated SO by its SO date, ties by real entry time', () => {
    const orders = [
      { id: 'entered-today', order_no: 'SO26000200', order_date: '2026-09-21', created_at: '2026-09-21T01:00:00.000Z' },
      { id: 'backdated', order_no: 'SO26000201', order_date: '2026-09-15', created_at: '2026-09-21T02:00:00.000Z' },
      { id: 'legacy', order_no: 'SO26000100', order_date: null, created_at: '2026-09-18T02:00:00.000Z' },
      { id: 'same-day-later', order_no: 'SO26000202', order_date: '2026-09-21', created_at: '2026-09-21T03:00:00.000Z' },
    ]
    expect(sortOrders(orders, 'order_date', 'desc').map((o) => o.id))
      .toEqual(['same-day-later', 'entered-today', 'legacy', 'backdated'])
    expect(sortOrders(orders, 'order_date', 'asc').map((o) => o.id))
      .toEqual(['backdated', 'legacy', 'entered-today', 'same-day-later'])
  })
})

// ═══ Sales Order PDF ═══════════════════════════════════════════════════════

function pdfText(bytes: Buffer): string[] {
  let content = ''
  let cursor = 0
  while (true) {
    const open = bytes.indexOf('stream', cursor)
    if (open === -1) break
    let start = open + 'stream'.length
    if (bytes[start] === 0x0d) start += 1
    if (bytes[start] === 0x0a) start += 1
    const close = bytes.indexOf('endstream', start)
    if (close === -1) break
    try {
      content += inflateSync(bytes.subarray(start, close)).toString('latin1')
    } catch {
      // not a deflate stream
    }
    cursor = close + 'endstream'.length
  }
  return [...content.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map((match) => match[1])
}

async function renderHeaderDate(docType: 'SO' | 'PO', orderDate: string | null): Promise<string> {
  const ORG = { org_name: 'Serapod Sdn Bhd', org_type_code: 'HQ' }
  const orderData = {
    order_no: 'SO26000210',
    order_type: 'D2H',
    status: 'submitted',
    // Keyed in 21 Sep 2026 10:00 MYT, SO dated 15 Sep.
    created_at: '2026-09-21T02:00:00.000Z',
    order_date: orderDate,
    buyer_org: ORG,
    seller_org: ORG,
    order_items: [{ product: { product_name: 'Cellera Hero', product_code: 'CEL' }, variant: { variant_name: '[ Honeydew ]' }, qty: 10, unit_price: 5, line_total: 50 }],
  } as unknown as TemplateOrderData
  const documentData = {
    doc_no: `${docType}26000210`,
    display_doc_no: `${docType}26000210`,
    doc_type: docType,
    status: 'pending',
    created_at: '2026-09-21T02:00:00.000Z',
  } as TemplateDocumentData
  const blob = await new ClassicTemplate([]).generate(orderData, documentData, docType === 'SO' ? 'Sales Order' : 'Purchase Order')
  const text = pdfText(Buffer.from(await blob.arrayBuffer()))
  return text[text.indexOf('Date:') + 1]
}

describe('11. Sales Order PDF date', () => {
  it('prints the SO business date, not the document creation date', async () => {
    expect(await renderHeaderDate('SO', '2026-09-15')).toBe('15/09/2026')
  })

  it('falls back to the legacy date when order_date is not available', async () => {
    const legacy = await renderHeaderDate('SO', null)
    expect(legacy).toMatch(/^2[01]\/09\/2026$/)
  })

  it('does not move another document (PO) onto the SO date', async () => {
    expect(await renderHeaderDate('PO', '2026-09-15')).not.toBe('15/09/2026')
  })

  it('the detailed SO template labels SO Date with order_date and leaves DO/Invoice alone', () => {
    const source = read('lib/pdf-generator.ts')
    expect(source).toContain("{ label: 'SO Date:', value: this.formatOrderBusinessDate(orderData.order_date, documentData.created_at) }")
    expect(source).toContain("{ label: 'DO Date:', value: this.formatDate(documentData.created_at) }")
    expect(source).toContain("{ label: 'Invoice Date:', value: this.formatDate(documentData.created_at) }")
    expect(source).toContain("{ label: 'Receipt Date:', value: this.formatDate(documentData.created_at) }")
    expect(source).toContain("{ label: 'Payment Date:', value: this.formatDate(documentData.created_at) }")
  })
})

// ═══ Reporting migrations ══════════════════════════════════════════════════

describe('reporting functions move to order_date (static — NOT executed)', () => {
  const distributor = readMigration('20260921120200_distributor_analytics_order_date.sql')
  const product = readMigration('20260921120300_product_analytics_order_date.sql')
  const code = (sql: string) => sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')

  it('Distributor Analytics windows, trend, lifetime and months all use order_date', () => {
    const body = code(distributor)
    expect(body).toContain("to_char(o.order_date, 'YYYY-MM') AS period_key")
    expect(body).toContain('(e.order_date >= v_month_start AND e.order_date < v_end_date)      AS in_current')
    expect(body).toContain('(e.order_date >= v_prev_month  AND e.order_date < v_prev_end_date) AS in_previous')
    expect(body).toContain("SELECT to_char(w.order_date, 'YYYY-MM-DD') AS day_key")
    expect(body).toContain('min(e.order_date)  AS first_order_date')
    expect(body).toContain('max(e.order_date)  AS last_order_date')
    expect(body).toContain("'dateField', 'orders.order_date'")
    // created_at is only carried for display/tie-breaks, never used as a window.
    expect(body).not.toMatch(/created_at\s*(>=|<|>)/)
    expect(body).not.toMatch(/order_date AT TIME ZONE/)
  })

  it('Distributor Analytics keeps the MTD rule and its signature/grants', () => {
    expect(distributor).toContain('WHEN v_month_start = v_current_month THEN LEAST(extract(day from v_today)::integer, v_days_in_month)')
    expect(distributor).toContain('GRANT EXECUTE ON FUNCTION public.reporting_distributor_analytics(text, uuid, text) TO authenticated;')
    expect(distributor).toContain('SECURITY INVOKER')
    expect(distributor).toContain('(array_agg(pv.product_id))[1] AS product_id')
  })

  it('Product Analytics uses the same business date', () => {
    const body = code(product)
    expect(body).toContain("to_char(o.order_date, 'YYYY-MM') AS period_key")
    expect(body).toContain('(o.order_date >= v_month_start AND o.order_date < v_end_date)      AS in_current')
    expect(body).toContain('order_date AS d,')
    expect(body).toContain('max(o.order_date) AS last_date')
    expect(body).not.toMatch(/created_at/)
    expect(product).toContain('GRANT EXECUTE ON FUNCTION public.reporting_product_analytics(text, uuid) TO authenticated;')
  })

  it('never edits the historical reporting migrations', () => {
    expect(readMigration('20260908140000_distributor_analytics_top_products_uuid_fix.sql')).toContain('e.created_at >= v_prev_start')
    expect(readMigration('20260908120000_product_analytics_category_filter.sql')).toContain('o.created_at >= v_prev_start')
  })
})
