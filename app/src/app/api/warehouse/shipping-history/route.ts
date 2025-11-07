import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractOrderNumber } from '@/lib/qr-code-utils'

const MAX_PAGE_SIZE = 50
const DEFAULT_PAGE_SIZE = 15
const DEFAULT_RANGE_DAYS = 90

interface ShipmentHistoryRow {
  sessionId: string
  orderId: string | null
  orderNo: string
  distributorOrgId: string | null
  distributorName: string | null
  scannedSummary: {
    totalCases: number
    totalUnits: number
  }
  expectedSummary: {
    totalCases: number | null
    totalUnits: number | null
  }
  status: string
  hasDiscrepancy: boolean
  warnings: string[]
  createdAt: string | null
  updatedAt: string | null
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

const resolveRange = (rangeParam: string | null) => {
  if (!rangeParam) {
    return { days: DEFAULT_RANGE_DAYS, isAll: false }
  }

  if (rangeParam === 'all') {
    return { days: null, isAll: true }
  }

  const numericMatch = rangeParam.match(/(\d{1,3})/)
  if (numericMatch) {
    const days = parseInt(numericMatch[1], 10)
    if (!Number.isNaN(days) && days > 0) {
      return { days, isAll: false }
    }
  }

  return { days: DEFAULT_RANGE_DAYS, isAll: false }
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
    const distributorFilter = (searchParams.get('distributor_org_id') || '').trim().toLowerCase()
    const statusesParam = (searchParams.get('statuses') || '').trim().toLowerCase()
    const includePending = searchParams.get('include_pending') === 'true'

    const { days, isAll } = resolveRange(searchParams.get('range'))

    const defaultEnd = new Date()
    defaultEnd.setHours(23, 59, 59, 999)

    const defaultStart = new Date(defaultEnd)
    if (days && !isAll) {
      defaultStart.setDate(defaultStart.getDate() - (days - 1))
    } else {
      defaultStart.setFullYear(defaultStart.getFullYear() - 5)
    }
    defaultStart.setHours(0, 0, 0, 0)

    const startDate = parseDateParam(searchParams.get('start'), defaultStart)
    const endDate = parseDateParam(searchParams.get('end'), defaultEnd)

    if (startDate > endDate) {
      return NextResponse.json({ error: 'start must be before end' }, { status: 400 })
    }

    const startIso = startDate.toISOString()
    const endIso = endDate.toISOString()

    const normalizedStatuses = statusesParam
      ? statusesParam.split(',').map(token => token.trim()).filter(Boolean)
      : []

    const { data, error } = await supabase
      .from('qr_validation_reports')
      .select(
        `
          id,
          validation_status,
          created_at,
          updated_at,
          destination_order_id,
          distributor_org_id,
          master_codes_scanned,
          unique_codes_scanned,
          scanned_quantities,
          expected_quantities,
          discrepancy_details,
          destination_order:orders!qr_validation_reports_destination_order_id_fkey (
            id,
            order_no,
            buyer_org_id,
            seller_org_id,
            buyer:organizations!orders_buyer_org_id_fkey (
              id,
              org_name
            )
          ),
          distributor:organizations!qr_validation_reports_distributor_org_id_fkey (
            id,
            org_name
          )
        `
      )
      .eq('warehouse_org_id', warehouseOrgId)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('updated_at', { ascending: false })
      .limit(1000)

    if (error) {
      console.error('❌ Shipping history query error', error)
      return NextResponse.json({ error: error.message || 'Failed to load shipping history' }, { status: 500 })
    }

    const rows: ShipmentHistoryRow[] = []

    ;(data || []).forEach((row: any) => {
      const status: string = row.validation_status || 'pending'
      if (!includePending && status === 'pending') {
        return
      }

      if (normalizedStatuses.length > 0 && !normalizedStatuses.includes(status.toLowerCase())) {
        return
      }

  const orderRecord = Array.isArray(row.destination_order) ? row.destination_order[0] : row.destination_order
  const buyerOrg = orderRecord?.buyer
      const buyerOrgRecord = Array.isArray(buyerOrg) ? buyerOrg[0] : buyerOrg

      const distributorRecord = Array.isArray(row.distributor) ? row.distributor[0] : row.distributor

      const masterCodes: string[] = Array.isArray(row.master_codes_scanned)
        ? row.master_codes_scanned
        : []
      const uniqueCodes: string[] = Array.isArray(row.unique_codes_scanned)
        ? row.unique_codes_scanned
        : []

      // Try to extract order numbers from ALL scanned codes
      const allCodes = [...masterCodes, ...uniqueCodes]
      const extractedOrderNumbers = new Set<string>()
      
      for (const code of allCodes.slice(0, 10)) { // Check first 10 codes max
        const orderNo = extractOrderNumber(code)
        if (orderNo) {
          extractedOrderNumbers.add(orderNo)
        }
      }
      
      const extractedOrderNo = extractedOrderNumbers.size > 0 
        ? Array.from(extractedOrderNumbers).join(', ')
        : null

      const resolvedOrderId: string | null = orderRecord?.id ?? row.destination_order_id ?? null
      const rawOrderNo: string | null = orderRecord?.order_no ?? null

      // Prefer database order_no, then extracted from QR codes, then fallback
      const orderNo = rawOrderNo && rawOrderNo.trim().length > 0
        ? rawOrderNo.trim()
        : extractedOrderNo || (resolvedOrderId ? `Shipment ${row.id.slice(0, 8)}` : 'Unknown')

      const scannedQuantities = (row.scanned_quantities || {}) as { total_units?: number; total_cases?: number }
      const expectedQuantities = (row.expected_quantities || {}) as { master_cases_available?: number; units_available?: number }
      const discrepancyDetails = (row.discrepancy_details || {}) as { warnings?: string[]; inventory_shortfalls?: any[] }

      const mappedRow: ShipmentHistoryRow = {
        sessionId: row.id,
        orderId: resolvedOrderId,
        orderNo,
        distributorOrgId: row.distributor_org_id ?? null,
        distributorName: distributorRecord?.org_name || buyerOrgRecord?.org_name || null,
        scannedSummary: {
          totalCases: Number(scannedQuantities.total_cases) || 0,
          totalUnits: Number(scannedQuantities.total_units) || 0
        },
        expectedSummary: {
          totalCases: expectedQuantities.master_cases_available ?? null,
          totalUnits: expectedQuantities.units_available ?? null
        },
        status,
        hasDiscrepancy: Boolean(discrepancyDetails.inventory_shortfalls?.length || discrepancyDetails.warnings?.length),
        warnings: Array.isArray(discrepancyDetails.warnings) ? discrepancyDetails.warnings : [],
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
      }

      rows.push(mappedRow)
    })

    let filteredRows = rows

    if (searchTerm) {
      filteredRows = filteredRows.filter(row => {
        const haystack = [row.orderNo, row.sessionId, row.orderId, row.distributorName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(searchTerm)
      })
    }

    if (distributorFilter) {
      filteredRows = filteredRows.filter(row => {
        const distributorName = row.distributorName ? row.distributorName.toLowerCase() : ''
        const distributorId = row.distributorOrgId ? row.distributorOrgId.toLowerCase() : ''
        return distributorName.includes(distributorFilter) || distributorId.includes(distributorFilter)
      })
    }

    const total = filteredRows.length
    const totalPages = Math.max(Math.ceil(total / pageSize), 1)
    const currentPage = Math.min(page, totalPages)
    const startIndex = (currentPage - 1) * pageSize
    const endIndex = startIndex + pageSize
    const pagedRows = filteredRows.slice(startIndex, endIndex)

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
        search: searchTerm || null,
        distributor: distributorFilter || null,
        statuses: normalizedStatuses,
        includePending
      }
    })
  } catch (error: any) {
    console.error('❌ Shipping history handler error', error)
    return NextResponse.json(
      { error: error?.message || 'Unexpected error loading shipping history' },
      { status: 500 }
    )
  }
}
