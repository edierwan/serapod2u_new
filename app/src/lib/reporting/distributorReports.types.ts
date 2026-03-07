// ============================================================
// Distributor Reports — Types
// ============================================================

export interface DateRangePreset {
  label: string
  value: string
  days: number // 0 means custom
}

export const DATE_PRESETS: DateRangePreset[] = [
  { label: 'This Month', value: 'thisMonth', days: 0 },
  { label: 'Last Month', value: 'lastMonth', days: 0 },
  { label: 'Last 3 Months', value: 'last3Months', days: 90 },
  { label: 'Last 6 Months', value: 'last6Months', days: 180 },
  { label: 'Last 12 Months', value: 'last12Months', days: 365 },
]

export interface DistributorReportFilters {
  dateRange: string
  startDate: string
  endDate: string
  orderType: string
  seller: string
  status: string
  search: string
  region?: string
  tier?: string
}

export interface KPICard {
  id: string
  label: string
  value: number | string
  formattedValue: string
  delta: number | null
  deltaLabel: string
  trend: 'up' | 'down' | 'flat'
  icon: string
  color: string
  helpText: string
}

export interface DistributorLeaderboardRow {
  rank: number
  id: string
  name: string
  totalRM: number
  orders: number
  aov: number
  growthPct: number | null
  sharePct: number
  lastOrderDate: string | null
  outstandingBalance: number
}

export interface MonthlyTrendPoint {
  month: string // YYYY-MM
  label: string // Jan, Feb ...
  amount: number
  orders: number
}

export interface ComparisonItem {
  name: string
  current: number
  previous: number
  growthPct: number
}

export interface InsightCard {
  type: 'pareto' | 'churn' | 'new' | 'reactivated' | 'repeat'
  title: string
  value: string | number
  description: string
  color: string
  icon: string
}

export interface DistributorDetail {
  id: string
  name: string
  totalRM: number
  totalOrders: number
  aov: number
  growthPct: number | null
  lastOrderDate: string | null
  trend: MonthlyTrendPoint[]
  topProducts: { name: string; qty: number; amount: number }[]
  recentOrders: {
    orderNo: string
    date: string
    status: string
    amount: number
    balance: number
  }[]
  agingBuckets: {
    current: number   // 0-30
    days31_60: number
    days61_90: number
    days90plus: number
  } | null
}

export interface DistributorReportData {
  kpis: KPICard[]
  trend: MonthlyTrendPoint[]
  leaderboard: DistributorLeaderboardRow[]
  comparison: ComparisonItem[]
  insights: InsightCard[]
  totalCount: number
  filters: DistributorReportFilters
}
