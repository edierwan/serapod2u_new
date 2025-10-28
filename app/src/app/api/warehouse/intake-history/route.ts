import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractOrderNumber } from '@/lib/qr-code-utils'

const MAX_PAGE_SIZE = 50
const DEFAULT_PAGE_SIZE = 30
const DEFAULT_RANGE_DAYS = 30

interface HistoryRow {
  orderId: string
  orderNo: string
  buyerOrgName: string | null
  casesReceived: number
  unitsReceived: number
  firstReceivedAt: string | null
  lastReceivedAt: string | null
}

const clampPageSize = (value: number | null) => {
  if (!value || Number.isNaN(value)) return DEFAULT_PAGE_SIZE
  return Math.min(Math.max(value, 5), MAX_PAGE_SIZE)
}

const parseDateParam = (value: string | null, fallback: Date): Date => {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return fallback
  }
  return parsed
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const warehouseOrgId = searchParams.get('warehouse_org_id')

    if (!warehouseOrgId) {
      return NextResponse.json({ error: 'warehouse_org_id is required' }, { status: 400 })
    }

    const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1)
    const pageSize = clampPageSize(parseInt(searchParams.get('pageSize') || '', 10))
    const searchTerm = (searchParams.get('search') || '').trim().toLowerCase()

    const defaultStart = new Date()
    defaultStart.setDate(defaultStart.getDate() - DEFAULT_RANGE_DAYS)
    defaultStart.setHours(0, 0, 0, 0)

    const defaultEnd = new Date()
    defaultEnd.setHours(23, 59, 59, 999)

    const startDate = parseDateParam(searchParams.get('start'), defaultStart)
    const endDate = parseDateParam(searchParams.get('end'), defaultEnd)

    if (startDate > endDate) {
      return NextResponse.json({ error: 'start date must be before end date' }, { status: 400 })
    }

    const startIso = startDate.toISOString()
    const endIso = endDate.toISOString()

    const { data, error } = await supabase
      .from('qr_master_codes')
      .select(
        `
          id,
          master_code,
          warehouse_received_at,
          actual_unit_count,
          expected_unit_count,
          qr_batches!inner (
            order_id,
            orders!inner (
              id,
              order_no,
              buyer_org_id,
              organizations!orders_buyer_org_id_fkey (
                org_name
              )
            )
          )
        `
      )
      .eq('warehouse_org_id', warehouseOrgId)
      .not('warehouse_received_at', 'is', null)
      .gte('warehouse_received_at', startIso)
      .lte('warehouse_received_at', endIso)
  .order('warehouse_received_at', { ascending: false })
  .limit(2000)

    if (error) {
      console.error('❌ Intake history query error', error)
      return NextResponse.json({ error: error.message || 'Failed to load intake history' }, { status: 500 })
    }

    const historyMap = new Map<string, HistoryRow>()

    ;(data || []).forEach((row: any) => {
      const batches = Array.isArray(row.qr_batches) ? row.qr_batches : [row.qr_batches]
      const batch = batches[0]
      if (!batch) return

      const orders = batch.orders
      const orderRecord = Array.isArray(orders) ? orders[0] : orders
      const orderId = orderRecord?.id || batch.order_id
      if (!orderId) return

      const buyerOrg = orderRecord?.organizations
      const buyerOrgRecord = Array.isArray(buyerOrg) ? buyerOrg[0] : buyerOrg
      const buyerOrgName = buyerOrgRecord?.org_name || null

      const resolvedOrderNo = (() => {
        const rawOrderNo = orderRecord?.order_no || null
        if (rawOrderNo && rawOrderNo.trim().length > 0) {
          return rawOrderNo
        }
        const parsed = row.master_code ? extractOrderNumber(row.master_code) : null
        return parsed || `Order ${orderId.slice(0, 8)}`
      })()

      const existing = historyMap.get(orderId)
      const units = row.actual_unit_count ?? row.expected_unit_count ?? 0
      const receivedAt = row.warehouse_received_at

      if (!existing) {
        historyMap.set(orderId, {
          orderId,
          orderNo: resolvedOrderNo,
          buyerOrgName,
          casesReceived: 1,
          unitsReceived: units,
          firstReceivedAt: receivedAt,
          lastReceivedAt: receivedAt
        })
        return
      }

      existing.casesReceived += 1
      existing.unitsReceived += units

      if (!existing.firstReceivedAt || (receivedAt && receivedAt < existing.firstReceivedAt)) {
        existing.firstReceivedAt = receivedAt
      }
      if (!existing.lastReceivedAt || (receivedAt && receivedAt > existing.lastReceivedAt)) {
        existing.lastReceivedAt = receivedAt
      }
    })

    let rows = Array.from(historyMap.values()).sort((a, b) => {
      const aTime = a.lastReceivedAt ? new Date(a.lastReceivedAt).getTime() : 0
      const bTime = b.lastReceivedAt ? new Date(b.lastReceivedAt).getTime() : 0
      return bTime - aTime
    })

    if (searchTerm) {
      rows = rows.filter((row) => {
        const haystack = [row.orderNo, row.buyerOrgName || '', row.orderId].join(' ').toLowerCase()
        return haystack.includes(searchTerm)
      })
    }

    const total = rows.length
    const totalPages = Math.max(Math.ceil(total / pageSize), 1)
    const currentPage = Math.min(page, totalPages)
    const startIndex = (currentPage - 1) * pageSize
    const endIndex = startIndex + pageSize

    const pagedRows = rows.slice(startIndex, endIndex)

    return NextResponse.json({
      data: pagedRows,
      pageInfo: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
        hasMore: endIndex < total
      },
      filters: {
        start: startIso,
        end: endIso,
        search: searchTerm || null
      }
    })
  } catch (error: any) {
    console.error('❌ Intake history handler error', error)
    return NextResponse.json(
      { error: error?.message || 'Unexpected error loading intake history' },
      { status: 500 }
    )
  }
}
