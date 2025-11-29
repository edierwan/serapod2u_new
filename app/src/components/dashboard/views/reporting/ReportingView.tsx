'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  PieChart,
  Pie,
  Cell,
  Sector
} from 'recharts'
import { 
  Calendar, 
  Download, 
  TrendingUp, 
  Users, 
  Package, 
  ShoppingCart,
  Loader2,
  RefreshCw,
  ArrowUpRight,
  MoreHorizontal
} from 'lucide-react'
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns'

interface ReportingViewProps {
  userProfile: any
}

const COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
]

// Custom Active Shape for Option 4
const renderActiveShape = (props: any) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
  const sin = Math.sin(-RADIAN * midAngle);
  const cos = Math.cos(-RADIAN * midAngle);
  const sx = cx + (outerRadius + 10) * cos;
  const sy = cy + (outerRadius + 10) * sin;
  const mx = cx + (outerRadius + 30) * cos;
  const my = cy + (outerRadius + 30) * sin;
  const ex = mx + (cos >= 0 ? 1 : -1) * 22;
  const ey = my;
  const textAnchor = cos >= 0 ? 'start' : 'end';

  return (
    <g>
      <text x={cx} y={cy} dy={8} textAnchor="middle" fill="#1f2937" className="text-xl font-bold">
        {payload.name}
      </text>
      <text x={cx} y={cy + 24} dy={8} textAnchor="middle" fill="#6b7280" className="text-sm">
        {`${(percent * 100).toFixed(0)}%`}
      </text>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        startAngle={startAngle}
        endAngle={endAngle}
        innerRadius={outerRadius + 8}
        outerRadius={outerRadius + 12}
        fill={fill}
      />
    </g>
  );
};

const RADIAN = Math.PI / 180;

export default function ReportingView({ userProfile }: ReportingViewProps) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [dateRange, setDateRange] = useState('last30')
  const [distributors, setDistributors] = useState<any[]>([])
  const [selectedDistributor, setSelectedDistributor] = useState<string>('all')
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  const supabase = createClient()

  const onPieEnter = (_: any, index: number) => {
    setActiveIndex(index);
  };

  const onPieClick = (data: any) => {
    setSelectedProduct(data);
  };

  useEffect(() => {
    const fetchDistributors = async () => {
      const { data } = await supabase
        .from('organizations')
        .select('id, org_name')
        .eq('org_type_code', 'DIST')
        .order('org_name')
      
      if (data) setDistributors(data)
    }
    fetchDistributors()
  }, [])
  
  const dateParams = useMemo(() => {
    const end = new Date()
    let start = new Date()
    
    switch (dateRange) {
      case 'today':
        start.setHours(0, 0, 0, 0)
        break
      case 'last7':
        start = subDays(end, 7)
        break
      case 'last30':
        start = subDays(end, 30)
        break
      case 'thisMonth':
        start = startOfMonth(end)
        break
      case 'lastMonth':
        start = startOfMonth(subDays(startOfMonth(end), 1))
        end.setTime(endOfMonth(start).getTime())
        break
      default:
        start = subDays(end, 30)
    }
    
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString()
    }
  }, [dateRange])

  const fetchData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        startDate: dateParams.startDate,
        endDate: dateParams.endDate
      })

      if (selectedDistributor && selectedDistributor !== 'all') {
        params.append('distributorId', selectedDistributor)
      }
      
      const res = await fetch(`/api/reporting/stats?${params}`)
      const json = await res.json()
      
      if (res.ok) {
        setData(json)
      } else {
        console.error('Failed to fetch reporting data', json)
      }
    } catch (error) {
      console.error('Error fetching reporting data', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [dateParams, selectedDistributor])

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Executive Reporting</h2>
          <p className="text-muted-foreground">
            Overview of warehouse performance and shipment metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedDistributor} onValueChange={setSelectedDistributor}>
            <SelectTrigger className="w-[200px]">
              <Users className="mr-2 h-4 w-4" />
              <SelectValue placeholder="All Distributors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Distributors</SelectItem>
              {distributors.map(d => (
                <SelectItem key={d.id} value={d.id}>{d.org_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[180px]">
              <Calendar className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="last7">Last 7 Days</SelectItem>
              <SelectItem value="last30">Last 30 Days</SelectItem>
              <SelectItem value="thisMonth">This Month</SelectItem>
              <SelectItem value="lastMonth">Last Month</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="default">
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Units Shipped</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.summary?.totalUnits?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground">
              In selected period
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.summary?.totalOrders?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground">
              Processed orders
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Distributors</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.summary?.activeDistributors || 0}</div>
            <p className="text-xs text-muted-foreground">
              Receiving shipments
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Growth Trend</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">+12.5%</div>
            <p className="text-xs text-muted-foreground">
              vs previous period
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Design Option 1: Executive Minimalist */}
      <div className="grid gap-4 md:grid-cols-1">
        <Card className="border-none shadow-sm bg-white overflow-hidden">
          <CardHeader className="border-b bg-slate-50/50 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-semibold text-slate-900">Product Portfolio</CardTitle>
                <CardDescription className="text-slate-500">Volume distribution by variant</CardDescription>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4 text-slate-400" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row items-center gap-8">
              {/* Chart Section */}
              <div className="relative w-full lg:w-1/3 h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data?.productMix || []}
                      cx="50%"
                      cy="50%"
                      innerRadius={85}
                      outerRadius={110}
                      paddingAngle={4}
                      dataKey="units"
                      stroke="none"
                      onClick={onPieClick}
                    >
                      {(data?.productMix || []).map((entry: any, index: number) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={COLORS[index % COLORS.length]} 
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                        />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                      itemStyle={{ color: '#1f2937', fontWeight: 600 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center Text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-3xl font-bold text-slate-900 tracking-tight">
                    {data?.summary?.totalUnits?.toLocaleString() || 0}
                  </span>
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider mt-1">Total Units</span>
                </div>
              </div>

              {/* Legend Section */}
              <div className="w-full lg:w-2/3 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                {(data?.productMix || []).map((entry: any, index: number) => {
                  const total = data?.summary?.totalUnits || 1;
                  const percentage = ((entry.units / total) * 100).toFixed(1);
                  return (
                    <div 
                      key={index} 
                      className="group flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() => onPieClick(entry)}
                    >
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-2.5 h-10 rounded-full" 
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{entry.name}</p>
                          <p className="text-xs text-slate-500">{percentage}% share</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-slate-900">{entry.units.toLocaleString()}</p>
                        <p className="text-xs text-slate-400">units</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Product Detail Dialog */}
      <Dialog open={!!selectedProduct} onOpenChange={(open) => !open && setSelectedProduct(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-600" />
              {selectedProduct?.name}
            </DialogTitle>
            <DialogDescription>
              Detailed performance metrics for this product variant.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col p-4 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs font-medium text-slate-500 uppercase">Total Volume</span>
                <span className="text-2xl font-bold text-slate-900 mt-1">
                  {selectedProduct?.units?.toLocaleString()}
                </span>
                <span className="text-xs text-slate-400 mt-1">units shipped</span>
              </div>
              <div className="flex flex-col p-4 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs font-medium text-slate-500 uppercase">Market Share</span>
                <span className="text-2xl font-bold text-slate-900 mt-1">
                  {selectedProduct && data?.summary?.totalUnits 
                    ? ((selectedProduct.units / data.summary.totalUnits) * 100).toFixed(1) 
                    : 0}%
                </span>
                <span className="text-xs text-slate-400 mt-1">of total volume</span>
              </div>
            </div>
            
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">Performance Insight</h4>
              <p className="text-sm text-blue-700">
                This product accounts for a significant portion of your shipment volume. 
                Consider analyzing distributor demand specifically for {selectedProduct?.name} to optimize inventory.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>



      {/* Shipment Trend Chart - Full Width Row */}
      <div className="grid gap-4 md:grid-cols-1">
        <Card>
          <CardHeader>
            <CardTitle>Shipment Volume Trend</CardTitle>
            <CardDescription>Monthly units shipped over time</CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.trend || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value: string) => {
                      // Handle YYYY-MM format
                      const [year, month] = value.split('-');
                      const date = new Date(parseInt(year), parseInt(month) - 1);
                      return format(date, 'MMM yyyy');
                    }}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={32}
                  />
                  <YAxis 
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => `${value}`}
                  />
                  <Tooltip 
                    labelFormatter={(value: string) => {
                      const [year, month] = value.split('-');
                      const date = new Date(parseInt(year), parseInt(month) - 1);
                      return format(date, 'MMMM yyyy');
                    }}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="units" 
                    stroke="#2563eb" 
                    strokeWidth={2} 
                    dot={false}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Top Distributors Bar Chart */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Top Distributors</CardTitle>
            <CardDescription>By shipment volume</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.distributorPerformance || []} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    width={100} 
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="units" fill="#8884d8" radius={[0, 4, 4, 0]} barSize={20}>
                    {
                      (data?.distributorPerformance || []).map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))
                    }
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent Shipments Table */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Recent Shipments</CardTitle>
            <CardDescription>Latest processed orders</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(data?.recentShipments || []).map((shipment: any) => (
                <div key={shipment.id} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{shipment.distributor}</p>
                    <p className="text-xs text-muted-foreground">{shipment.orderNo}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-sm font-medium">{shipment.units} units</div>
                    <div className="text-xs text-muted-foreground">{format(new Date(shipment.date), 'MMM dd')}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
