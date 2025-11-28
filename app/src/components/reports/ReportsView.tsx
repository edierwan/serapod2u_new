'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  BarChart3,
  Download,
  Calendar,
  TrendingUp,
  Package,
  DollarSign,
  Users,
  Building2,
  AlertTriangle,
  Loader2,
  ShoppingCart,
  TrendingDown,
  Award,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  CalendarDays
} from 'lucide-react'

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string
  is_active: boolean
  organizations: {
    id: string
    org_name: string
    org_type_code: string
    org_code: string
  }
  roles: {
    role_name: string
    role_level: number
  }
}

interface ReportsViewProps {
  userProfile: UserProfile
}

interface MetricData {
  title: string
  value: string | number
  previousValue?: number
  change?: number
  changePercent?: string
  trend?: 'up' | 'down' | 'neutral'
  icon: React.ComponentType<any>
  color: string
}

interface TopProduct {
  product_name: string
  product_code: string
  brand_name: string
  total_quantity: number
  total_orders: number
  total_revenue: number
  previous_quantity?: number
  growth_percent?: number
}

interface TopDistributor {
  org_name: string
  org_code: string
  total_orders: number
  total_revenue: number
  total_products: number
  previous_orders?: number
  growth_percent?: number
}

interface ComparisonPeriod {
  label: string
  currentStart: Date
  currentEnd: Date
  previousStart: Date
  previousEnd: Date
}

export default function ReportsView({ userProfile }: ReportsViewProps) {
  const [selectedPeriod, setSelectedPeriod] = useState('30')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth().toString())
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString())
  const [comparisonMode, setComparisonMode] = useState<'quick' | 'monthly'>('quick')
  const [enableComparison, setEnableComparison] = useState(true)
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<MetricData[]>([])
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [topDistributors, setTopDistributors] = useState<TopDistributor[]>([])
  const [loadingTopProducts, setLoadingTopProducts] = useState(false)
  const [loadingTopDistributors, setLoadingTopDistributors] = useState(false)
  const { toast } = useToast()
  const supabase = createClient()

  const months = [
    { value: '0', label: 'January' },
    { value: '1', label: 'February' },
    { value: '2', label: 'March' },
    { value: '3', label: 'April' },
    { value: '4', label: 'May' },
    { value: '5', label: 'June' },
    { value: '6', label: 'July' },
    { value: '7', label: 'August' },
    { value: '8', label: 'September' },
    { value: '9', label: 'October' },
    { value: '10', label: 'November' },
    { value: '11', label: 'December' }
  ]

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 5 }, (_, i) => ({
    value: (currentYear - i).toString(),
    label: (currentYear - i).toString()
  }))

  useEffect(() => {
    loadMetrics()
    loadTopProducts()
    loadTopDistributors()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriod, selectedMonth, selectedYear, comparisonMode, enableComparison])

  const getComparisonPeriods = (): ComparisonPeriod => {
    if (comparisonMode === 'monthly') {
      const month = parseInt(selectedMonth)
      const year = parseInt(selectedYear)
      
      const currentStart = new Date(year, month, 1)
      const currentEnd = new Date(year, month + 1, 0, 23, 59, 59)
      
      const previousStart = new Date(year, month - 1, 1)
      const previousEnd = new Date(year, month, 0, 23, 59, 59)
      
      return {
        label: `${months[month].label} ${year}`,
        currentStart,
        currentEnd,
        previousStart,
        previousEnd
      }
    } else {
      const daysAgo = parseInt(selectedPeriod)
      const currentEnd = new Date()
      const currentStart = new Date()
      currentStart.setDate(currentStart.getDate() - daysAgo)
      
      const previousEnd = new Date(currentStart)
      previousEnd.setSeconds(previousEnd.getSeconds() - 1)
      const previousStart = new Date(previousEnd)
      previousStart.setDate(previousStart.getDate() - daysAgo)
      
      return {
        label: `Last ${daysAgo} days`,
        currentStart,
        currentEnd,
        previousStart,
        previousEnd
      }
    }
  }

  const calculateGrowth = (current: number, previous: number): { percent: string, trend: 'up' | 'down' | 'neutral' } => {
    if (previous === 0) {
      return { percent: current > 0 ? '+100%' : '0%', trend: current > 0 ? 'up' : 'neutral' }
    }
    const change = ((current - previous) / previous) * 100
    const trend = change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'
    return {
      percent: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
      trend
    }
  }

  const loadMetrics = async () => {
    try {
      setLoading(true)
      const periods = getComparisonPeriods()

      // Current period revenue and sales from stock movements (Warehouse -> Distributor)
      const { data: currentMovements } = await supabase
        .from('stock_movements')
        .select(`
          quantity_change,
          product_variants!inner(
            base_cost,
            distributor_price
          ),
          from_org:organizations!stock_movements_from_organization_id_fkey!inner(org_type_code),
          to_org:organizations!stock_movements_to_organization_id_fkey!inner(org_type_code)
        `)
        .eq('movement_type', 'order_fulfillment')
        .eq('from_org.org_type_code', 'WH')
        .eq('to_org.org_type_code', 'DIST')
        .gte('created_at', periods.currentStart.toISOString())
        .lte('created_at', periods.currentEnd.toISOString())

      let currentRevenue = 0
      let currentSales = 0

      currentMovements?.forEach((m: any) => {
        const qty = Math.abs(m.quantity_change || 0)
        const price = m.product_variants?.distributor_price || 0
        const cost = m.product_variants?.base_cost || 0
        
        currentSales += qty
        currentRevenue += (price - cost) * qty
      })

      // Previous period data (for comparison)
      let previousRevenue = 0
      let previousSales = 0

      if (enableComparison) {
        const { data: prevMovements } = await supabase
          .from('stock_movements')
          .select(`
            quantity_change,
            product_variants!inner(
              base_cost,
              distributor_price
            ),
            from_org:organizations!stock_movements_from_organization_id_fkey!inner(org_type_code),
            to_org:organizations!stock_movements_to_organization_id_fkey!inner(org_type_code)
          `)
          .eq('movement_type', 'order_fulfillment')
          .eq('from_org.org_type_code', 'WH')
          .eq('to_org.org_type_code', 'DIST')
          .gte('created_at', periods.previousStart.toISOString())
          .lte('created_at', periods.previousEnd.toISOString())

        prevMovements?.forEach((m: any) => {
          const qty = Math.abs(m.quantity_change || 0)
          const price = m.product_variants?.distributor_price || 0
          const cost = m.product_variants?.base_cost || 0
          
          previousSales += qty
          previousRevenue += (price - cost) * qty
        })
      }

      const { count: orgCount } = await supabase
        .from('organizations')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)

      const { count: lowStockCount } = await supabase
        .from('product_inventory')
        .select('*', { count: 'exact', head: true })
        .or('quantity_on_hand.lt.10,quantity_on_hand.is.null')

      const revenueGrowth = calculateGrowth(currentRevenue, previousRevenue)
      const salesGrowth = calculateGrowth(currentSales, previousSales)

      setMetrics([
        {
          title: 'Total Revenue',
          value: `RM ${currentRevenue.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          previousValue: previousRevenue,
          changePercent: enableComparison ? revenueGrowth.percent : undefined,
          trend: enableComparison ? revenueGrowth.trend : undefined,
          icon: DollarSign,
          color: 'text-green-600',
        },
        {
          title: 'Product Sales',
          value: currentSales.toLocaleString(),
          previousValue: previousSales,
          changePercent: enableComparison ? salesGrowth.percent : undefined,
          trend: enableComparison ? salesGrowth.trend : undefined,
          icon: Package,
          color: 'text-blue-600',
        },
        {
          title: 'Active Organizations',
          value: orgCount || 0,
          icon: Building2,
          color: 'text-purple-600',
        },
        {
          title: 'Low Stock Items',
          value: lowStockCount || 0,
          icon: AlertTriangle,
          color: 'text-red-600',
        }
      ])
    } catch (error: any) {
      console.error('Error loading metrics:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadTopProducts = async () => {
    try {
      setLoadingTopProducts(true)
      const periods = getComparisonPeriods()

      // Current period data from stock movements
      const { data: currentData } = await supabase
        .from('stock_movements')
        .select(`
          quantity_change,
          product_variants!inner(
            product_id,
            base_cost,
            distributor_price,
            products!inner(
              product_name,
              product_code,
              brand_name
            )
          ),
          from_org:organizations!stock_movements_from_organization_id_fkey!inner(org_type_code),
          to_org:organizations!stock_movements_to_organization_id_fkey!inner(org_type_code)
        `)
        .eq('movement_type', 'order_fulfillment')
        .eq('from_org.org_type_code', 'WH')
        .eq('to_org.org_type_code', 'DIST')
        .gte('created_at', periods.currentStart.toISOString())
        .lte('created_at', periods.currentEnd.toISOString())

      const productMap = new Map<string, TopProduct>()
      
      currentData?.forEach((item: any) => {
        const product = item.product_variants?.products
        if (!product) return

        const key = product.product_code
        const existing = productMap.get(key)
        
        const qty = Math.abs(item.quantity_change || 0)
        const baseCost = item.product_variants?.base_cost || 0
        const distPrice = item.product_variants?.distributor_price || 0
        const revenue = (distPrice - baseCost) * qty
        
        if (existing) {
          existing.total_quantity += qty
          existing.total_orders += 1
          existing.total_revenue += revenue
        } else {
          productMap.set(key, {
            product_name: product.product_name,
            product_code: product.product_code,
            brand_name: product.brand_name,
            total_quantity: qty,
            total_orders: 1,
            total_revenue: revenue,
            previous_quantity: 0,
            growth_percent: 0
          })
        }
      })

      // Previous period data for comparison
      if (enableComparison) {
        const { data: previousData } = await supabase
          .from('stock_movements')
          .select(`
            quantity_change,
            product_variants!inner(
              product_id,
              products!inner(
                product_code
              )
            ),
            from_org:organizations!stock_movements_from_organization_id_fkey!inner(org_type_code),
            to_org:organizations!stock_movements_to_organization_id_fkey!inner(org_type_code)
          `)
          .eq('movement_type', 'order_fulfillment')
          .eq('from_org.org_type_code', 'WH')
          .eq('to_org.org_type_code', 'DIST')
          .gte('created_at', periods.previousStart.toISOString())
          .lte('created_at', periods.previousEnd.toISOString())

        const previousMap = new Map<string, number>()
        previousData?.forEach((item: any) => {
          const code = item.product_variants?.products?.product_code
          if (code) {
            const qty = Math.abs(item.quantity_change || 0)
            previousMap.set(code, (previousMap.get(code) || 0) + qty)
          }
        })

        // Calculate growth for each product
        productMap.forEach((product) => {
          const prevQty = previousMap.get(product.product_code) || 0
          product.previous_quantity = prevQty
          if (prevQty > 0) {
            product.growth_percent = ((product.total_quantity - prevQty) / prevQty) * 100
          } else if (product.total_quantity > 0) {
            product.growth_percent = 100
          }
        })
      }

      const sortedProducts = Array.from(productMap.values())
        .sort((a, b) => b.total_quantity - a.total_quantity)
        .slice(0, 10)

      setTopProducts(sortedProducts)
    } catch (error: any) {
      console.error('Error loading top products:', error)
    } finally {
      setLoadingTopProducts(false)
    }
  }

  const loadTopDistributors = async () => {
    try {
      setLoadingTopDistributors(true)
      const periods = getComparisonPeriods()

      // Current period data
      const { data: currentData } = await supabase
        .from('orders')
        .select(`
          total_amount,
          seller_org_id,
          organizations!orders_seller_org_id_fkey(
            org_name,
            org_code,
            org_type_code
          )
        `)
        .eq('status', 'approved')
        .gte('created_at', periods.currentStart.toISOString())
        .lte('created_at', periods.currentEnd.toISOString())

      const distMap = new Map<string, TopDistributor>()
      
      currentData?.forEach((order: any) => {
        const org = order.organizations
        if (!org || org.org_type_code !== 'DIST') return

        const key = org.org_code
        const existing = distMap.get(key)
        
        if (existing) {
          existing.total_orders += 1
          existing.total_revenue += order.total_amount || 0
        } else {
          distMap.set(key, {
            org_name: org.org_name,
            org_code: org.org_code,
            total_orders: 1,
            total_revenue: order.total_amount || 0,
            total_products: 0,
            previous_orders: 0,
            growth_percent: 0
          })
        }
      })

      // Previous period data for comparison
      if (enableComparison) {
        const { data: previousData } = await supabase
          .from('orders')
          .select(`
            organizations!orders_seller_org_id_fkey(
              org_code,
              org_type_code
            )
          `)
          .eq('status', 'approved')
          .gte('created_at', periods.previousStart.toISOString())
          .lte('created_at', periods.previousEnd.toISOString())

        const previousMap = new Map<string, number>()
        previousData?.forEach((order: any) => {
          const org = order.organizations
          if (org && org.org_type_code === 'DIST') {
            previousMap.set(org.org_code, (previousMap.get(org.org_code) || 0) + 1)
          }
        })

        // Calculate growth for each distributor
        distMap.forEach((dist) => {
          const prevOrders = previousMap.get(dist.org_code) || 0
          dist.previous_orders = prevOrders
          if (prevOrders > 0) {
            dist.growth_percent = ((dist.total_orders - prevOrders) / prevOrders) * 100
          } else if (dist.total_orders > 0) {
            dist.growth_percent = 100
          }
        })
      }

      // Get product counts
      const distArray = Array.from(distMap.entries())
      for (let i = 0; i < distArray.length; i++) {
        const [key, dist] = distArray[i]
        const { data: orgData } = await supabase
          .from('organizations')
          .select('id')
          .eq('org_code', key)
          .single() as { data: any; error: any }

        if (orgData) {
          const { count } = await supabase
            .from('distributor_products')
            .select('*', { count: 'exact', head: true })
            .eq('distributor_id', orgData.id)
            .eq('is_active', true)

          dist.total_products = count || 0
        }
      }

      const sortedDistributors = Array.from(distMap.values())
        .sort((a, b) => b.total_orders - a.total_orders)
        .slice(0, 10)

      setTopDistributors(sortedDistributors)
    } catch (error: any) {
      console.error('Error loading top distributors:', error)
    } finally {
      setLoadingTopDistributors(false)
    }
  }

  const exportData = (type: 'products' | 'distributors') => {
    try {
      const csvContent = type === 'products'
        ? 'Product Name,Product Code,Brand,Total Quantity,Total Orders,Total Revenue\n' +
          topProducts.map(p => 
            `"${p.product_name}","${p.product_code}","${p.brand_name}",${p.total_quantity},${p.total_orders},${p.total_revenue}`
          ).join('\n')
        : 'Distributor Name,Distributor Code,Total Orders,Total Revenue,Total Products\n' +
          topDistributors.map(d => 
            `"${d.org_name}","${d.org_code}",${d.total_orders},${d.total_revenue},${d.total_products}`
          ).join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', `top_${type}_${selectedPeriod}days.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      toast({
        title: "Success",
        description: `${type === 'products' ? 'Products' : 'Distributors'} data exported successfully`,
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to export data",
        variant: "destructive",
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Reports & Analytics</h2>
            <p className="text-gray-600">Monitor performance and generate insights</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={enableComparison ? "default" : "outline"}
              size="sm"
              onClick={() => setEnableComparison(!enableComparison)}
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              {enableComparison ? 'Comparison ON' : 'Comparison OFF'}
            </Button>
          </div>
        </div>

        {/* Time Period Selection Tabs */}
        <Tabs value={comparisonMode} onValueChange={(v) => setComparisonMode(v as 'quick' | 'monthly')}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="quick">Quick Period</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>

          <TabsContent value="quick" className="mt-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-500" />
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                  <SelectItem value="180">Last 6 months</SelectItem>
                  <SelectItem value="365">Last year</SelectItem>
                </SelectContent>
              </Select>
              {enableComparison && (
                <Badge variant="outline" className="ml-2">
                  vs Previous {selectedPeriod} days
                </Badge>
              )}
            </div>
          </TabsContent>

          <TabsContent value="monthly" className="mt-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-gray-500" />
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year.value} value={year.value}>
                      {year.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {enableComparison && (
                <Badge variant="outline" className="ml-2">
                  vs Previous Month
                </Badge>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Key Metrics with Comparison */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
        {metrics.map((metric, index) => {
          const Icon = metric.icon
          const TrendIcon = metric.trend === 'up' ? ArrowUpRight : metric.trend === 'down' ? ArrowDownRight : Minus
          return (
            <Card key={index} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-3 sm:p-4 lg:p-6">
                <div className="flex items-start justify-between mb-2 sm:mb-4">
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-gradient-to-br ${
                    metric.color === 'text-green-600' ? 'from-green-50 to-green-100' :
                    metric.color === 'text-blue-600' ? 'from-blue-50 to-blue-100' :
                    metric.color === 'text-purple-600' ? 'from-purple-50 to-purple-100' :
                    'from-red-50 to-red-100'
                  } flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${metric.color}`} />
                  </div>
                  {metric.changePercent && (
                    <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
                      metric.trend === 'up' ? 'bg-green-100 text-green-700' :
                      metric.trend === 'down' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      <TrendIcon className="w-3 h-3" />
                      <span className="hidden sm:inline">{metric.changePercent}</span>
                    </div>
                  )}
                </div>
                <p className="text-gray-600 text-xs sm:text-sm font-medium mb-1 line-clamp-1">{metric.title}</p>
                <p className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 mb-1">{metric.value}</p>
                {metric.previousValue !== undefined && enableComparison && (
                  <p className="text-xs text-gray-500">
                    Previous: {metric.title === 'Total Revenue' 
                      ? `RM ${metric.previousValue.toLocaleString('en-MY', { minimumFractionDigits: 2 })}`
                      : metric.previousValue.toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-yellow-600" />
                Top 10 Products Ordered
              </CardTitle>
              <CardDescription>Most ordered products in the last {selectedPeriod} days</CardDescription>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => exportData('products')}
              disabled={loadingTopProducts || topProducts.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingTopProducts ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : topProducts.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No products data available</h3>
              <p className="text-gray-600">No approved orders found in the selected period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Brand</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Orders</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                    {enableComparison && (
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Growth</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {topProducts.map((product, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap">
                        <Badge variant={index < 3 ? "default" : "secondary"} className={
                          index === 0 ? "bg-yellow-500 hover:bg-yellow-600" :
                          index === 1 ? "bg-gray-400 hover:bg-gray-500" :
                          index === 2 ? "bg-orange-600 hover:bg-orange-700" :
                          ""
                        }>
                          #{index + 1}
                        </Badge>
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-sm font-medium text-gray-900">{product.product_name}</div>
                        <div className="text-xs text-gray-500">{product.product_code}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600">{product.brand_name}</td>
                      <td className="px-4 py-4 text-right">
                        <div className="text-sm font-medium text-gray-900">
                          {product.total_quantity.toLocaleString()}
                        </div>
                        {enableComparison && product.previous_quantity !== undefined && (
                          <div className="text-xs text-gray-500">
                            was {product.previous_quantity.toLocaleString()}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-gray-600">
                        {product.total_orders.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-medium text-green-600">
                        RM {product.total_revenue.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      {enableComparison && (
                        <td className="px-4 py-4 text-right">
                          {product.growth_percent !== undefined && product.growth_percent !== 0 && (
                            <Badge variant="outline" className={`${
                              product.growth_percent > 0 
                                ? 'bg-green-50 text-green-700 border-green-200' 
                                : 'bg-red-50 text-red-700 border-red-200'
                            }`}>
                              {product.growth_percent > 0 ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
                              {product.growth_percent > 0 ? '+' : ''}{product.growth_percent.toFixed(1)}%
                            </Badge>
                          )}
                          {product.growth_percent === 0 && (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600" />
                Top 10 Distributors by Orders
              </CardTitle>
              <CardDescription>Most active distributors in the last {selectedPeriod} days</CardDescription>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => exportData('distributors')}
              disabled={loadingTopDistributors || topDistributors.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingTopDistributors ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : topDistributors.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No distributors data available</h3>
              <p className="text-gray-600">No distributor orders found in the selected period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Distributor</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Orders</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Products</th>
                    {enableComparison && (
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Growth</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {topDistributors.map((distributor, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-4 py-4 whitespace-nowrap">
                        <Badge variant={index < 3 ? "default" : "secondary"} className={`
                          ${index === 0 ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : ''}
                          ${index === 1 ? 'bg-gray-400 hover:bg-gray-500 text-white' : ''}
                          ${index === 2 ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}
                        `}>
                          <Award className="w-3 h-3 inline mr-1" />
                          #{index + 1}
                        </Badge>
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-sm font-medium text-gray-900">{distributor.org_name}</div>
                        <div className="text-xs text-gray-500">{distributor.org_code}</div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="text-sm font-medium text-gray-900">{distributor.total_orders.toLocaleString()}</div>
                        {enableComparison && distributor.previous_orders !== undefined && (
                          <div className="text-xs text-gray-500">was {distributor.previous_orders.toLocaleString()}</div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-medium text-green-600">
                        RM {distributor.total_revenue.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-gray-600">
                        {distributor.total_products.toLocaleString()}
                      </td>
                      {enableComparison && (
                        <td className="px-4 py-4 text-right">
                          {distributor.growth_percent !== undefined && distributor.growth_percent !== 0 && (
                            <Badge variant="outline" className={`${
                              distributor.growth_percent > 0 
                                ? 'bg-green-50 text-green-700 border-green-200' 
                                : 'bg-red-50 text-red-700 border-red-200'
                            }`}>
                              {distributor.growth_percent > 0 ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
                              {distributor.growth_percent > 0 ? '+' : ''}{distributor.growth_percent.toFixed(1)}%
                            </Badge>
                          )}
                          {distributor.growth_percent === 0 && (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common reporting tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Button variant="outline" className="justify-start" onClick={() => {
              const allData = { metrics, topProducts, topDistributors }
              const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' })
              const link = document.createElement('a')
              const url = URL.createObjectURL(blob)
              link.setAttribute('href', url)
              link.setAttribute('download', `all_reports_${selectedPeriod}days.json`)
              link.style.visibility = 'hidden'
              document.body.appendChild(link)
              link.click()
              document.body.removeChild(link)
            }}>
              <Download className="w-4 h-4 mr-2" />
              Export All Data
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => {
              toast({ title: "Coming Soon", description: "Custom report builder will be available soon" })
            }}>
              <BarChart3 className="w-4 h-4 mr-2" />
              Custom Report
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => {
              toast({ title: "Coming Soon", description: "Schedule report feature will be available soon" })
            }}>
              <Calendar className="w-4 h-4 mr-2" />
              Schedule Report
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
