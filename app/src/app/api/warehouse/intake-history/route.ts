import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractOrderNumber } from '@/lib/qr-code-utils'

export const dynamic = 'force-dynamic'

const MAX_PAGE_SIZE = 50
const DEFAULT_PAGE_SIZE = 30
const DEFAULT_RANGE_DAYS = 30

interface HistoryRow {
  orderId: string
  orderNo: string
  buyerOrgName: string | null
  sellerOrgName: string | null // NEW: Seller organization name
  casesReceived: number
  unitsReceived: number
  casesScanned: number
  unitsScanned: number
  casesShipped: number    // NEW: Cases shipped to distributors
  unitsShipped: number    // NEW: Units shipped to distributors
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

    // Check if user is Super Admin (role_level = 1)
    const { data: profile } = await supabase
      .from('users')
      .select('role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    const isSuperAdmin = profile && (profile as any).roles && (profile as any).roles.role_level === 1

    const searchParams = request.nextUrl.searchParams
    const warehouseOrgId = searchParams.get('warehouse_org_id')

    // Super Admin can view ALL warehouses if no warehouse_org_id is provided
    if (!warehouseOrgId && !isSuperAdmin) {
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

    console.log('🔍 [Intake History] Query parameters:', {
      warehouseOrgId,
      startIso,
      endIso,
      searchTerm
    })

    // Build query with conditional warehouse filter
    let query = supabase
      .from('qr_master_codes')
      .select(
        `
          id,
          master_code,
          company_id,
          warehouse_received_at,
          warehouse_org_id,
          actual_unit_count,
          expected_unit_count,
          qr_batches!inner (
            order_id,
            orders!inner (
              id,
              order_no,
              buyer_org_id,
              seller_org_id,
              organizations!orders_buyer_org_id_fkey (
                org_name
              ),
              seller_org:organizations!orders_seller_org_id_fkey (
                org_name
              ),
              company:organizations!orders_company_id_fkey (
                org_name
              )
            )
          )
        `
      )
      .not('warehouse_received_at', 'is', null)
      .gte('warehouse_received_at', startIso)
      .lte('warehouse_received_at', endIso)
      .order('warehouse_received_at', { ascending: false })
      .limit(2000)

    // Only filter by warehouse_org_id if provided (Super Admin can view all)
    if (warehouseOrgId) {
      query = query.eq('warehouse_org_id', warehouseOrgId)
    }

    const { data, error } = await query

    console.log('🔍 [Intake History] Query result:', {
      recordCount: data?.length || 0,
      hasError: !!error,
      errorMessage: error?.message
    })

    if (data && data.length > 0) {
      console.log('🔍 [Intake History] Sample records:', data.slice(0, 3).map(r => ({
        master_code: r.master_code,
        warehouse_org_id: r.warehouse_org_id,
        warehouse_received_at: r.warehouse_received_at
      })))
    }

    if (error) {
      console.error('❌ Intake history query error', error)
      return NextResponse.json({ error: error.message || 'Failed to load intake history' }, { status: 500 })
    }

    // If no data found, check if ANY data exists for this warehouse
    if (!data || data.length === 0) {
      console.log('⚠️ [Intake History] No records found, running diagnostics...')
      
      if (warehouseOrgId) {
        const { count: totalForWarehouse } = await supabase
          .from('qr_master_codes')
          .select('*', { count: 'exact', head: true })
          .eq('warehouse_org_id', warehouseOrgId)
          .not('warehouse_received_at', 'is', null)
        
        const { count: totalAnyWarehouse } = await supabase
          .from('qr_master_codes')
          .select('*', { count: 'exact', head: true })
          .not('warehouse_received_at', 'is', null)
        
        console.log('🔍 [Intake History] Diagnostics:', {
          totalForYourWarehouse: totalForWarehouse,
          totalAnyWarehouse: totalAnyWarehouse,
          warehouseOrgId,
          dateRange: { start: startIso, end: endIso }
        })
      }
    }

    const historyMap = new Map<string, HistoryRow>()
    const orderIdSet = new Set<string>()

    // First pass: collect received data and order IDs
    ;(data || []).forEach((row: any) => {
      const batches = Array.isArray(row.qr_batches) ? row.qr_batches : [row.qr_batches]
      const batch = batches[0]
      if (!batch) return

      const orders = batch.orders
      const orderRecord = Array.isArray(orders) ? orders[0] : orders
      const orderId = orderRecord?.id || batch.order_id
      if (!orderId) return

      orderIdSet.add(orderId)

      const buyerOrg = orderRecord?.organizations
      const buyerOrgRecord = Array.isArray(buyerOrg) ? buyerOrg[0] : buyerOrg
      const buyerOrgName = buyerOrgRecord?.org_name || null

      const sellerOrg = orderRecord?.seller_org
      const sellerOrgRecord = Array.isArray(sellerOrg) ? sellerOrg[0] : sellerOrg
      
      const companyOrg = orderRecord?.company
      const companyOrgRecord = Array.isArray(companyOrg) ? companyOrg[0] : companyOrg

      // Fallback: If seller_org is missing, try to use company_id from the master code or order
      // Note: In this system, Company usually equals Manufacturer
      let sellerOrgName = sellerOrgRecord?.org_name || companyOrgRecord?.org_name || null

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
          sellerOrgName,
          casesReceived: 1,
          unitsReceived: units,
          casesScanned: 0, // Will be updated below
          unitsScanned: 0, // Will be updated below
          casesShipped: 0, // Will be updated below
          unitsShipped: 0, // Will be updated below
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

    // Second pass: get total scanned cases and units for each order
    if (orderIdSet.size > 0) {
      const orderIds = Array.from(orderIdSet)
      let masterQuery = supabase
        .from('qr_master_codes')
        .select(`
          id,
          actual_unit_count,
          expected_unit_count,
          status,
          shipment_order_id,
          qr_batches!inner (
            order_id
          )
        `)
        .in('qr_batches.order_id', orderIds)

      if (warehouseOrgId) {
        masterQuery = masterQuery.eq('warehouse_org_id', warehouseOrgId)
      }

      const { data: allMasterCodes, error: masterError } = await masterQuery

      if (!masterError && allMasterCodes) {
        const orderTotals = new Map<string, { cases: number; units: number }>()
        const masterInfoByOrder = new Map<string, Array<{ id: string; status: string | null; units: number }>>()
        const masterIds: string[] = []

        allMasterCodes.forEach((row: any) => {
          const batches = Array.isArray(row.qr_batches) ? row.qr_batches : [row.qr_batches]
          const batch = batches[0]
          if (!batch) return

          // Use the same order ID resolution as the first pass for consistency
          const resolvedOrderId = batch.order_id
          if (!resolvedOrderId) return

          const units = row.actual_unit_count ?? row.expected_unit_count ?? 0

          masterIds.push(row.id)

          const existing = orderTotals.get(resolvedOrderId) || { cases: 0, units: 0 }
          existing.cases += 1
          existing.units += units
          orderTotals.set(resolvedOrderId, existing)

          const infoList = masterInfoByOrder.get(resolvedOrderId) || []
          infoList.push({ id: row.id, status: row.status ?? null, units })
          masterInfoByOrder.set(resolvedOrderId, infoList)
        })

        // Load shipped unique counts for relevant masters
        let shippedUniqueByMaster = new Map<string, number>()
        if (masterIds.length > 0) {
          const { data: shippedUniqueRows, error: shippedUniqueError } = await supabase
            .from('qr_codes')
            .select('master_code_id')
            .eq('status', 'shipped_distributor')
            .in('master_code_id', masterIds)

          if (!shippedUniqueError && shippedUniqueRows) {
            shippedUniqueByMaster = shippedUniqueRows.reduce((map: Map<string, number>, row: any) => {
              const masterId = row.master_code_id
              if (masterId) {
                map.set(masterId, (map.get(masterId) || 0) + 1)
              }
              return map
            }, new Map<string, number>())
          }
        }

        // NEW: Load unlinked shipped codes (loose items) for these orders
        // These are codes that were shipped but unlinked from their master case
        let unlinkedShippedByOrder = new Map<string, number>()
        if (orderIds.length > 0) {
          const { data: unlinkedRows, error: unlinkedError } = await supabase
            .from('qr_codes')
            .select(`
              qr_batches!inner (
                order_id
              )
            `)
            .eq('status', 'shipped_distributor')
            .is('master_code_id', null)
            .in('qr_batches.order_id', orderIds)

          if (!unlinkedError && unlinkedRows) {
            unlinkedShippedByOrder = unlinkedRows.reduce((map: Map<string, number>, row: any) => {
              const batches = Array.isArray(row.qr_batches) ? row.qr_batches : [row.qr_batches]
              const batch = batches[0]
              const orderId = batch?.order_id
              if (orderId) {
                map.set(orderId, (map.get(orderId) || 0) + 1)
              }
              return map
            }, new Map<string, number>())
          }
        }

        const casesShippedByOrder = new Map<string, number>()
        const unitsShippedByOrder = new Map<string, number>()
        
        console.log('🔍 [Intake History] Calculating shipped counts...')
        console.log('🔍 [Intake History] Total master IDs:', masterIds.length)
        console.log('🔍 [Intake History] Shipped unique by master entries:', shippedUniqueByMaster.size)
        console.log('🔍 [Intake History] Unlinked shipped by order entries:', unlinkedShippedByOrder.size)
        
        masterInfoByOrder.forEach((masters, orderId) => {
          let shippedCasesCount = 0
          let shippedUnitsCount = 0
          
          // Add unlinked shipped units first
          shippedUnitsCount += unlinkedShippedByOrder.get(orderId) || 0
          
          masters.forEach((master) => {
            const caseUnits = master.units > 0 ? master.units : 0
            const masterStatus = master.status || ''
            const shippedUniqueCount = shippedUniqueByMaster.get(master.id) || 0

            // A master case is shipped if:
            // 1. Its status is shipped_distributor
            // 2. OR all its unique codes have been shipped (shippedUniqueCount >= caseUnits)
            const masterShipped = masterStatus === 'shipped_distributor'
            const shippedByUniques = caseUnits > 0 && shippedUniqueCount >= caseUnits

            console.log(`🔍 [Intake History] Master ${master.id.slice(0, 8)}: status=${masterStatus}, units=${caseUnits}, shippedUniques=${shippedUniqueCount}, isShipped=${masterShipped || shippedByUniques}`)

            if (masterShipped) {
              shippedCasesCount += 1
              // Master was shipped as a whole - count all units
              shippedUnitsCount += caseUnits
            } else {
              // Not fully shipped by status
              // Count shipped units from unique codes (partial shipment)
              shippedUnitsCount += shippedUniqueCount
              
              // If all units are shipped via unique codes, count as a shipped case
              if (shippedByUniques) {
                shippedCasesCount += 1
              }
            }
          })
          
          console.log(`🔍 [Intake History] Order ${orderId.slice(0, 8)}: casesShipped=${shippedCasesCount}, unitsShipped=${shippedUnitsCount}`)
          
          casesShippedByOrder.set(orderId, shippedCasesCount)
          unitsShippedByOrder.set(orderId, shippedUnitsCount)
        })

        // Update history map values
        orderTotals.forEach((totals, orderId) => {
          const historyRow = historyMap.get(orderId)
          if (historyRow) {
            historyRow.casesScanned = totals.cases
            historyRow.unitsScanned = totals.units
          }
        })

        casesShippedByOrder.forEach((cases, orderId) => {
          const historyRow = historyMap.get(orderId)
          if (historyRow) {
            historyRow.casesShipped = cases
          }
        })

        unitsShippedByOrder.forEach((units, orderId) => {
          const historyRow = historyMap.get(orderId)
          if (historyRow) {
            historyRow.unitsShipped = units
          }
        })
      }
    }

    let rows = Array.from(historyMap.values()).sort((a, b) => {
      const aTime = a.lastReceivedAt ? new Date(a.lastReceivedAt).getTime() : 0
      const bTime = b.lastReceivedAt ? new Date(b.lastReceivedAt).getTime() : 0
      return bTime - aTime
    })

    if (searchTerm) {
      rows = rows.filter((row) => {
        const haystack = [row.orderNo, row.buyerOrgName || '', row.sellerOrgName || '', row.orderId].join(' ').toLowerCase()
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
