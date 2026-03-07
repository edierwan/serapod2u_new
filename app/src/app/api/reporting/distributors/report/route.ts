import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  format,
  differenceInDays,
  parseISO,
} from 'date-fns'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Helper – compute date window from preset string
// ---------------------------------------------------------------------------
function computeDateWindow(preset: string) {
  const now = new Date()
  let start: Date
  let end: Date = endOfMonth(now)

  switch (preset) {
    case 'thisMonth':
      start = startOfMonth(now)
      end = now
      break
    case 'lastMonth':
      start = startOfMonth(subMonths(now, 1))
      end = endOfMonth(subMonths(now, 1))
      break
    case 'last3Months':
      start = startOfMonth(subMonths(now, 2))
      end = now
      break
    case 'last6Months':
      start = startOfMonth(subMonths(now, 5))
      end = now
      break
    case 'last12Months':
      start = startOfMonth(subMonths(now, 11))
      end = now
      break
    default:
      start = startOfMonth(now)
      end = now
  }

  // Previous comparable period (same duration shifted back)
  const durationDays = differenceInDays(end, start) || 30
  const prevEnd = new Date(start.getTime() - 1) // 1ms before current start
  const prevStart = new Date(prevEnd.getTime() - durationDays * 86400000)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    prevStart: prevStart.toISOString(),
    prevEnd: prevEnd.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// GET /api/reporting/distributors/report
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const dateRange = searchParams.get('dateRange') || 'thisMonth'
    const orderType = searchParams.get('orderType') || ''
    const seller = searchParams.get('seller') || ''
    const status = searchParams.get('status') || ''
    const search = searchParams.get('search') || ''

    // Normalize 'all' to empty (no filter)
    const effectiveOrderType = orderType === 'all' ? '' : orderType
    const effectiveSeller = seller === 'all' ? '' : seller
    const effectiveStatus = status === 'all' ? '' : status

    const supabase = await createClient()

    // Auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Profile
    const { data: profile } = await supabase
      .from('users')
      .select('organization_id, role_code, roles(role_level)')
      .eq('id', user.id)
      .single()
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const dates = computeDateWindow(dateRange)

    // ── Fetch current-period orders (only distributor buyers) ──────────
    let q = supabase
      .from('orders')
      .select(
        `
        id,
        order_no,
        display_doc_no,
        order_type,
        status,
        created_at,
        updated_at,
        buyer:organizations!orders_buyer_org_id_fkey(id, org_name, org_type_code),
        seller:organizations!orders_seller_org_id_fkey(id, org_name),
        order_items(id, variant_id, qty, unit_price, line_total)
      `
      )
      .gte('created_at', dates.start)
      .lte('created_at', dates.end)
      .order('created_at', { ascending: false })

    if (effectiveOrderType) q = q.eq('order_type', effectiveOrderType as any)
    if (effectiveSeller) q = q.eq('seller_org_id', effectiveSeller)
    if (effectiveStatus) q = q.eq('status', effectiveStatus as any)

    const { data: allOrders, error: ordErr } = await q
    if (ordErr) {
      return NextResponse.json({ error: ordErr.message }, { status: 500 })
    }

    // Filter to distributor buyers only
    let orders = (allOrders || []).filter(
      (o: any) => o.buyer?.org_type_code === 'DIST'
    )

    // Apply search on distributor name
    if (search) {
      const s = search.toLowerCase()
      orders = orders.filter((o: any) =>
        (o.buyer?.org_name || '').toLowerCase().includes(s)
      )
    }

    // ── Fetch previous-period orders (for delta calc) ─────────────────
    let prevQ = supabase
      .from('orders')
      .select(
        `
        id, order_type, status, created_at,
        buyer:organizations!orders_buyer_org_id_fkey(id, org_name, org_type_code),
        order_items(qty, line_total)
      `
      )
      .gte('created_at', dates.prevStart)
      .lte('created_at', dates.prevEnd)

    if (effectiveOrderType) prevQ = prevQ.eq('order_type', effectiveOrderType as any)
    if (effectiveSeller) prevQ = prevQ.eq('seller_org_id', effectiveSeller)
    if (effectiveStatus) prevQ = prevQ.eq('status', effectiveStatus as any)

    const { data: prevAllOrders } = await prevQ
    const prevOrders = (prevAllOrders || []).filter(
      (o: any) => o.buyer?.org_type_code === 'DIST'
    )

    // ── Aggregate current period ──────────────────────────────────────
    let totalAmount = 0
    let totalOrderCount = orders.length
    const distMap: Record<
      string,
      { id: string; name: string; rm: number; orders: number; lastDate: string }
    > = {}
    const monthlyMap: Record<string, { amount: number; orders: number }> = {}

    orders.forEach((o: any) => {
      const distId = o.buyer?.id || 'unknown'
      const distName = o.buyer?.org_name || 'Unknown'
      const lineTotal = (o.order_items || []).reduce(
        (s: number, i: any) => s + (Number(i.line_total) || 0),
        0
      )
      totalAmount += lineTotal

      if (!distMap[distId]) {
        distMap[distId] = { id: distId, name: distName, rm: 0, orders: 0, lastDate: '' }
      }
      distMap[distId].rm += lineTotal
      distMap[distId].orders += 1
      if (o.created_at > (distMap[distId].lastDate || '')) {
        distMap[distId].lastDate = o.created_at
      }

      const mKey = (o.created_at || '').slice(0, 7)
      if (!monthlyMap[mKey]) monthlyMap[mKey] = { amount: 0, orders: 0 }
      monthlyMap[mKey].amount += lineTotal
      monthlyMap[mKey].orders += 1
    })

    const activeDistCount = Object.keys(distMap).length

    // ── Aggregate previous period ─────────────────────────────────────
    let prevTotalAmount = 0
    let prevOrderCount = prevOrders.length
    const prevDistIds = new Set<string>()
    const prevDistMap: Record<string, { rm: number; orders: number }> = {}

    prevOrders.forEach((o: any) => {
      const distId = o.buyer?.id || 'unknown'
      prevDistIds.add(distId)
      const lineTotal = (o.order_items || []).reduce(
        (s: number, i: any) => s + (Number(i.line_total) || 0),
        0
      )
      prevTotalAmount += lineTotal
      if (!prevDistMap[distId]) prevDistMap[distId] = { rm: 0, orders: 0 }
      prevDistMap[distId].rm += lineTotal
      prevDistMap[distId].orders += 1
    })
    const prevActiveDistCount = prevDistIds.size

    // ── Repeat rate ───────────────────────────────────────────────────
    const repeatDists = Object.values(distMap).filter((d) => d.orders > 1).length
    const repeatRate = activeDistCount > 0 ? (repeatDists / activeDistCount) * 100 : 0

    // ── AOV ───────────────────────────────────────────────────────────
    const aov = totalOrderCount > 0 ? totalAmount / totalOrderCount : 0
    const prevAov = prevOrderCount > 0 ? prevTotalAmount / prevOrderCount : 0

    // ── Delta helpers ─────────────────────────────────────────────────
    const pctDelta = (cur: number, prev: number) =>
      prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100

    // ── Approval rate ─────────────────────────────────────────────────
    const approvedOrders = orders.filter(
      (o: any) => o.status === 'approved' || o.status === 'closed'
    ).length
    const approvalRate =
      totalOrderCount > 0 ? (approvedOrders / totalOrderCount) * 100 : 0

    // ── KPIs ──────────────────────────────────────────────────────────
    const kpis = [
      {
        id: 'totalOrders',
        label: 'Total Orders',
        value: totalOrderCount,
        formattedValue: totalOrderCount.toLocaleString(),
        delta: pctDelta(totalOrderCount, prevOrderCount),
        deltaLabel: 'vs previous period',
        trend: totalOrderCount >= prevOrderCount ? 'up' : 'down',
        icon: 'ShoppingCart',
        color: '#3b82f6',
        helpText: `${prevOrderCount} in previous period`,
      },
      {
        id: 'totalAmount',
        label: 'Total Amount (RM)',
        value: totalAmount,
        formattedValue: `RM ${totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        delta: pctDelta(totalAmount, prevTotalAmount),
        deltaLabel: 'vs previous period',
        trend: totalAmount >= prevTotalAmount ? 'up' : 'down',
        icon: 'DollarSign',
        color: '#10b981',
        helpText: `RM ${prevTotalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2 })} previous`,
      },
      {
        id: 'aov',
        label: 'Avg Order Value',
        value: aov,
        formattedValue: `RM ${aov.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        delta: pctDelta(aov, prevAov),
        deltaLabel: 'vs previous period',
        trend: aov >= prevAov ? 'up' : 'down',
        icon: 'Target',
        color: '#8b5cf6',
        helpText: `RM ${prevAov.toLocaleString('en-MY', { minimumFractionDigits: 2 })} previous`,
      },
      {
        id: 'activeDistributors',
        label: 'Active Distributors',
        value: activeDistCount,
        formattedValue: activeDistCount.toLocaleString(),
        delta: pctDelta(activeDistCount, prevActiveDistCount),
        deltaLabel: 'vs previous period',
        trend: activeDistCount >= prevActiveDistCount ? 'up' : 'down',
        icon: 'Building2',
        color: '#f59e0b',
        helpText: `${prevActiveDistCount} in previous period`,
      },
      {
        id: 'repeatRate',
        label: 'Repeat Rate',
        value: repeatRate,
        formattedValue: `${repeatRate.toFixed(1)}%`,
        delta: null,
        deltaLabel: 'distributors with >1 order',
        trend: repeatRate > 50 ? 'up' : 'flat',
        icon: 'RefreshCw',
        color: '#06b6d4',
        helpText: `${repeatDists} of ${activeDistCount} distributors`,
      },
      {
        id: 'approvalRate',
        label: 'Approval Rate',
        value: approvalRate,
        formattedValue: `${approvalRate.toFixed(1)}%`,
        delta: null,
        deltaLabel: 'orders approved/closed',
        trend: approvalRate > 80 ? 'up' : 'flat',
        icon: 'CheckCircle2',
        color: '#22c55e',
        helpText: `${approvedOrders} of ${totalOrderCount} orders`,
      },
    ]

    // ── Trend (monthly) ───────────────────────────────────────────────
    const trend = Object.entries(monthlyMap)
      .map(([month, d]) => ({
        month,
        label: format(parseISO(month + '-01'), 'MMM yy'),
        amount: d.amount,
        orders: d.orders,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // ── Leaderboard ───────────────────────────────────────────────────
    const leaderboard = Object.values(distMap)
      .map((d, _i) => {
        const prevRM = prevDistMap[d.id]?.rm || 0
        return {
          rank: 0,
          id: d.id,
          name: d.name,
          totalRM: d.rm,
          orders: d.orders,
          aov: d.orders > 0 ? d.rm / d.orders : 0,
          growthPct: prevRM > 0 ? ((d.rm - prevRM) / prevRM) * 100 : null,
          sharePct: totalAmount > 0 ? (d.rm / totalAmount) * 100 : 0,
          lastOrderDate: d.lastDate || null,
          outstandingBalance: 0, // TODO: integrate payment/balance data when available
        }
      })
      .sort((a, b) => b.totalRM - a.totalRM)
      .map((row, idx) => ({ ...row, rank: idx + 1 }))

    // ── Comparison (top 10 current vs previous) ───────────────────────
    const comparison = leaderboard.slice(0, 10).map((d) => ({
      name: d.name,
      current: d.totalRM,
      previous: prevDistMap[d.id]?.rm || 0,
      growthPct:
        prevDistMap[d.id]?.rm && prevDistMap[d.id].rm > 0
          ? ((d.totalRM - prevDistMap[d.id].rm) / prevDistMap[d.id].rm) * 100
          : 0,
    }))

    // ── Insights ──────────────────────────────────────────────────────
    const insights: any[] = []

    // Pareto 80/20
    const sortedByRM = [...leaderboard]
    const top20Count = Math.max(1, Math.ceil(sortedByRM.length * 0.2))
    const top20RM = sortedByRM.slice(0, top20Count).reduce((s, d) => s + d.totalRM, 0)
    const paretoShare = totalAmount > 0 ? (top20RM / totalAmount) * 100 : 0
    insights.push({
      type: 'pareto',
      title: 'Pareto 80/20',
      value: `${paretoShare.toFixed(0)}%`,
      description: `Top ${top20Count} distributor${top20Count > 1 ? 's' : ''} (${((top20Count / Math.max(sortedByRM.length, 1)) * 100).toFixed(0)}%) contribute ${paretoShare.toFixed(0)}% of total sales`,
      color: '#8b5cf6',
      icon: 'PieChart',
    })

    // Churn
    const currentDistIds = new Set(Object.keys(distMap))
    const churnedDists = [...prevDistIds].filter((id) => !currentDistIds.has(id))
    insights.push({
      type: 'churn',
      title: 'Churned / Dropped',
      value: churnedDists.length,
      description: `${churnedDists.length} distributor${churnedDists.length !== 1 ? 's' : ''} ordered previously but not in this period`,
      color: '#ef4444',
      icon: 'UserMinus',
    })

    // New
    const newDists = [...currentDistIds].filter((id) => !prevDistIds.has(id))
    insights.push({
      type: 'new',
      title: 'New Distributors',
      value: newDists.length,
      description: `${newDists.length} distributor${newDists.length !== 1 ? 's' : ''} with first order in this period`,
      color: '#22c55e',
      icon: 'UserPlus',
    })

    // Repeat summary
    const oneTimeDists = activeDistCount - repeatDists
    insights.push({
      type: 'repeat',
      title: 'Repeat Ordering',
      value: `${repeatDists} / ${activeDistCount}`,
      description: `${repeatDists} repeat, ${oneTimeDists} one-time distributor${oneTimeDists !== 1 ? 's' : ''}`,
      color: '#06b6d4',
      icon: 'Repeat',
    })

    // ── Distributors list (for filter dropdown) ─────────────────
    const { data: distributorsList } = await supabase
      .from('organizations')
      .select('id, org_name, org_type_code, status')
      .eq('org_type_code', 'DIST')
      .order('org_name')

    // Active = those with orders in current period, Inactive = rest
    const activeDistIds = new Set(Object.keys(distMap))
    const allDistributorsList = (distributorsList || []).map((d: any) => ({
      ...d,
      hasOrders: activeDistIds.has(d.id),
    }))

    return NextResponse.json({
      kpis,
      trend,
      leaderboard,
      comparison,
      insights,
      totalCount: totalOrderCount,
      filters: {
        dateRange,
        startDate: dates.start,
        endDate: dates.end,
        orderType,
        seller,
        status,
        search,
      },
      distributors: (distributorsList || []).map((d: any) => ({ id: d.id, org_name: d.org_name })),
      allDistributors: allDistributorsList,
      orders: orders.map((o: any) => ({
        id: o.id,
        order_no: o.order_no || o.display_doc_no || o.id,
        display_doc_no: o.display_doc_no,
        order_type: o.order_type,
        status: o.status,
        created_at: o.created_at,
        buyer_name: o.buyer?.org_name || 'Unknown',
        seller_name: o.seller?.org_name || 'Unknown',
        total: (o.order_items || []).reduce((s: number, i: any) => s + (Number(i.line_total) || 0), 0),
        items_count: (o.order_items || []).length,
      })),
    })
  } catch (error: any) {
    console.error('[Distributor Report API] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
