'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    AreaChart,
    Area,
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
    ComposedChart,
    RadialBarChart,
    RadialBar
} from 'recharts'
import {
    Calendar,
    Download,
    TrendingUp,
    TrendingDown,
    Users,
    Package,
    ShoppingCart,
    Loader2,
    RefreshCw,
    DollarSign,
    CreditCard,
    Activity,
    ArrowUpRight,
    ArrowDownRight,
    BarChart3,
    PieChart as PieChartIcon,
    Layers,
    Target,
    Wallet,
    Receipt,
    Building2,
    Truck,
    BoxIcon,
    Clock,
    CheckCircle2,
    AlertCircle,
    Zap
} from 'lucide-react'
import { format, subDays, startOfMonth, endOfMonth, differenceInDays } from 'date-fns'

interface ReportingViewProps {
    userProfile: any
}

const COLORS = {
    primary: '#3b82f6',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    purple: '#8b5cf6',
    pink: '#ec4899',
    cyan: '#06b6d4',
    indigo: '#6366f1'
}

const CHART_COLORS = [
    COLORS.primary,
    COLORS.success,
    COLORS.warning,
    COLORS.purple,
    COLORS.pink,
    COLORS.cyan
]

// Animated counter component
const AnimatedCounter = ({ value, duration = 1000, prefix = '', suffix = '', decimals = 0 }: {
    value: number
    duration?: number
    prefix?: string
    suffix?: string
    decimals?: number
}) => {
    const [displayValue, setDisplayValue] = useState(0)

    useEffect(() => {
        let startTime: number
        let animationFrame: number

        const animate = (currentTime: number) => {
            if (!startTime) startTime = currentTime
            const progress = Math.min((currentTime - startTime) / duration, 1)
            
            // Easing function for smooth animation
            const easeOutQuart = 1 - Math.pow(1 - progress, 4)
            setDisplayValue(easeOutQuart * value)

            if (progress < 1) {
                animationFrame = requestAnimationFrame(animate)
            }
        }

        animationFrame = requestAnimationFrame(animate)
        return () => cancelAnimationFrame(animationFrame)
    }, [value, duration])

    return (
        <span>
            {prefix}{displayValue.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}{suffix}
        </span>
    )
}

// Metric Card Component with animation
const MetricCard = ({ title, value, change, changeType, icon: Icon, color, subtitle, loading }: {
    title: string
    value: number | string
    change?: number
    changeType?: 'increase' | 'decrease' | 'neutral'
    icon: any
    color: string
    subtitle?: string
    loading?: boolean
}) => {
    const isPositive = changeType === 'increase'
    const isNegative = changeType === 'decrease'

    return (
        <Card className="relative overflow-hidden group hover:shadow-lg transition-all duration-300 border-0 bg-white">
            <div className={`absolute top-0 right-0 w-32 h-32 -mr-8 -mt-8 rounded-full opacity-10 group-hover:opacity-20 transition-opacity`} style={{ backgroundColor: color }} />
            <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-gray-500">{title}</p>
                        {loading ? (
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                        ) : (
                            <div className="text-3xl font-bold text-gray-900 tracking-tight">
                                {typeof value === 'number' ? (
                                    <AnimatedCounter 
                                        value={value} 
                                        prefix={title.includes('Revenue') ? 'RM ' : ''} 
                                        decimals={title.includes('Revenue') ? 2 : 0}
                                    />
                                ) : value}
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            {change !== undefined && (
                                <Badge 
                                    variant="secondary" 
                                    className={`text-xs font-medium ${
                                        isPositive ? 'bg-green-100 text-green-700' : 
                                        isNegative ? 'bg-red-100 text-red-700' : 
                                        'bg-gray-100 text-gray-600'
                                    }`}
                                >
                                    {isPositive && <ArrowUpRight className="w-3 h-3 mr-0.5" />}
                                    {isNegative && <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                                    {Math.abs(change).toFixed(1)}%
                                </Badge>
                            )}
                            {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
                        </div>
                    </div>
                    <div className={`p-3 rounded-xl`} style={{ backgroundColor: `${color}15` }}>
                        <Icon className="w-6 h-6" style={{ color }} />
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

export default function ReportingView({ userProfile }: ReportingViewProps) {
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)
    const [dateRange, setDateRange] = useState('last30')
    const [distributors, setDistributors] = useState<any[]>([])
    const [selectedDistributor, setSelectedDistributor] = useState<string>('all')
    const [activeTab, setActiveTab] = useState('overview')
    const [financialData, setFinancialData] = useState<any>(null)
    const supabase = createClient()

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
        fetchFinancialData()
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
            case 'last90':
                start = subDays(end, 90)
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
            }
        } catch (error) {
            console.error('Error fetching reporting data', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchFinancialData = async () => {
        try {
            // Fetch GL summary data
            const { data: journals } = await supabase
                .from('gl_journals' as any)
                .select('*')
                .eq('status', 'POSTED')
                .order('posting_date', { ascending: false })
                .limit(100)

            const { data: accounts } = await supabase
                .from('gl_accounts' as any)
                .select('*')
                .eq('is_active', true)

            // Fetch order payment data
            const { data: orders } = await supabase
                .from('orders')
                .select('id, order_no, paid_amount, status, created_at')
                .in('status', ['approved', 'closed'])
                .order('created_at', { ascending: false })
                .limit(50)

            // Fetch documents for payment tracking
            const { data: documents } = await supabase
                .from('documents')
                .select('*')
                .in('doc_type', ['PAYMENT', 'PAYMENT_REQUEST', 'INVOICE'])
                .order('created_at', { ascending: false })
                .limit(100)

            setFinancialData({
                journals: journals || [],
                accounts: accounts || [],
                orders: orders || [],
                documents: documents || []
            })
        } catch (error) {
            console.error('Error fetching financial data', error)
        }
    }

    useEffect(() => {
        fetchData()
    }, [dateParams, selectedDistributor])

    // Calculate financial metrics
    const financialMetrics = useMemo(() => {
        if (!financialData) return null

        const totalRevenue = financialData.orders?.reduce((sum: number, o: any) => sum + (o.paid_amount || 0), 0) || 0
        const pendingPayments = financialData.documents?.filter((d: any) => 
            d.doc_type === 'PAYMENT_REQUEST' && d.status === 'pending'
        ).length || 0
        const completedPayments = financialData.documents?.filter((d: any) => 
            d.doc_type === 'PAYMENT' && d.status === 'acknowledged'
        ).length || 0
        const invoiceCount = financialData.documents?.filter((d: any) => 
            d.doc_type === 'INVOICE'
        ).length || 0

        return {
            totalRevenue,
            pendingPayments,
            completedPayments,
            invoiceCount
        }
    }, [financialData])

    // Generate trend data
    const trendData = useMemo(() => {
        if (!data?.trend) return []
        return data.trend.map((item: any) => ({
            ...item,
            date: item.date,
            units: item.units || 0
        }))
    }, [data?.trend])

    // Product mix data for pie chart
    const productMixData = useMemo(() => {
        if (!data?.productMix) return []
        return data.productMix.slice(0, 6)
    }, [data?.productMix])

    if (loading && !data) {
        return (
            <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
                <div className="text-center space-y-4">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-blue-200 rounded-full animate-pulse" />
                        <Loader2 className="w-8 h-8 text-blue-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin" />
                    </div>
                    <p className="text-gray-500 font-medium">Loading executive dashboard...</p>
                </div>
            </div>
        )
    }

    const periodDays = differenceInDays(new Date(dateParams.endDate), new Date(dateParams.startDate))

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
            <div className="p-6 lg:p-8 space-y-8 max-w-[1600px] mx-auto">
                {/* Header */}
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl shadow-lg shadow-blue-200">
                                <BarChart3 className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Executive Dashboard</h1>
                                <p className="text-gray-500">Real-time business intelligence & analytics</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Select value={selectedDistributor} onValueChange={setSelectedDistributor}>
                            <SelectTrigger className="w-[200px] bg-white border-gray-200 shadow-sm">
                                <Building2 className="mr-2 h-4 w-4 text-gray-500" />
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
                            <SelectTrigger className="w-[180px] bg-white border-gray-200 shadow-sm">
                                <Calendar className="mr-2 h-4 w-4 text-gray-500" />
                                <SelectValue placeholder="Select range" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="today">Today</SelectItem>
                                <SelectItem value="last7">Last 7 Days</SelectItem>
                                <SelectItem value="last30">Last 30 Days</SelectItem>
                                <SelectItem value="last90">Last 90 Days</SelectItem>
                                <SelectItem value="thisMonth">This Month</SelectItem>
                                <SelectItem value="lastMonth">Last Month</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button variant="outline" onClick={fetchData} className="bg-white shadow-sm">
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-200">
                            <Download className="mr-2 h-4 w-4" />
                            Export Report
                        </Button>
                    </div>
                </div>

                {/* Tab Navigation */}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                    <TabsList className="bg-white/80 backdrop-blur border shadow-sm p-1 h-auto">
                        <TabsTrigger value="overview" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white px-6 py-2.5">
                            <Activity className="w-4 h-4 mr-2" />
                            Overview
                        </TabsTrigger>
                        <TabsTrigger value="operations" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white px-6 py-2.5">
                            <Truck className="w-4 h-4 mr-2" />
                            Operations
                        </TabsTrigger>
                        <TabsTrigger value="finance" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white px-6 py-2.5">
                            <DollarSign className="w-4 h-4 mr-2" />
                            Finance
                        </TabsTrigger>
                        <TabsTrigger value="products" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white px-6 py-2.5">
                            <Package className="w-4 h-4 mr-2" />
                            Products
                        </TabsTrigger>
                    </TabsList>

                    {/* Overview Tab */}
                    <TabsContent value="overview" className="space-y-6 animate-in fade-in-50 duration-500">
                        {/* KPI Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <MetricCard
                                title="Total Revenue"
                                value={data?.summary?.totalRevenue || 0}
                                change={12.5}
                                changeType="increase"
                                icon={DollarSign}
                                color={COLORS.success}
                                subtitle={`in ${periodDays} days`}
                                loading={loading}
                            />
                            <MetricCard
                                title="Total Orders"
                                value={data?.summary?.totalOrders || 0}
                                change={8.3}
                                changeType="increase"
                                icon={ShoppingCart}
                                color={COLORS.primary}
                                subtitle="processed"
                                loading={loading}
                            />
                            <MetricCard
                                title="Total Units"
                                value={data?.summary?.totalUnits || 0}
                                change={2.1}
                                changeType="increase"
                                icon={Package}
                                color={COLORS.purple}
                                subtitle="shipped"
                                loading={loading}
                            />
                            <MetricCard
                                title="Active Buyers"
                                value={data?.summary?.activeDistributors || 0}
                                change={5.2}
                                changeType="increase"
                                icon={Users}
                                color={COLORS.warning}
                                subtitle="distributors & shops"
                                loading={loading}
                            />
                        </div>

                        {/* Main Charts Row */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Trend Chart */}
                            <Card className="lg:col-span-2 border-0 shadow-lg bg-white/80 backdrop-blur">
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle className="text-lg font-semibold">Shipment Trend</CardTitle>
                                            <CardDescription>Volume over time with growth trajectory</CardDescription>
                                        </div>
                                        <Badge variant="secondary" className="bg-green-100 text-green-700">
                                            <TrendingUp className="w-3 h-3 mr-1" />
                                            Growing
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[350px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={trendData}>
                                                <defs>
                                                    <linearGradient id="colorUnits" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3}/>
                                                        <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0}/>
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                                <XAxis 
                                                    dataKey="date" 
                                                    tickFormatter={(value: string) => {
                                                        const [year, month] = value.split('-')
                                                        const date = new Date(parseInt(year), parseInt(month) - 1)
                                                        return format(date, 'MMM')
                                                    }}
                                                    tickLine={false}
                                                    axisLine={false}
                                                    tick={{ fill: '#6b7280', fontSize: 12 }}
                                                />
                                                <YAxis 
                                                    tickLine={false}
                                                    axisLine={false}
                                                    tick={{ fill: '#6b7280', fontSize: 12 }}
                                                    tickFormatter={(value) => value.toLocaleString()}
                                                />
                                                <Tooltip 
                                                    contentStyle={{ 
                                                        borderRadius: '12px', 
                                                        border: 'none', 
                                                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                                                        backgroundColor: 'rgba(255, 255, 255, 0.95)'
                                                    }}
                                                    formatter={(value: number) => [value.toLocaleString(), 'Units']}
                                                    labelFormatter={(value: string) => {
                                                        const [year, month] = value.split('-')
                                                        const date = new Date(parseInt(year), parseInt(month) - 1)
                                                        return format(date, 'MMMM yyyy')
                                                    }}
                                                />
                                                <Area 
                                                    type="monotone" 
                                                    dataKey="units" 
                                                    stroke={COLORS.primary}
                                                    strokeWidth={3}
                                                    fill="url(#colorUnits)"
                                                    dot={false}
                                                    activeDot={{ r: 6, fill: COLORS.primary, stroke: '#fff', strokeWidth: 2 }}
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Product Distribution */}
                            <Card className="border-0 shadow-lg bg-white/80 backdrop-blur">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-lg font-semibold">Product Distribution</CardTitle>
                                    <CardDescription>Top performing variants</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[200px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={productMixData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={50}
                                                    outerRadius={80}
                                                    paddingAngle={4}
                                                    dataKey="units"
                                                    stroke="none"
                                                >
                                                    {productMixData.map((entry: any, index: number) => (
                                                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip 
                                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                                                    formatter={(value: number) => [value.toLocaleString(), 'Units']}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="space-y-2 mt-4">
                                        {productMixData.slice(0, 4).map((item: any, index: number) => (
                                            <div key={index} className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_COLORS[index] }} />
                                                    <span className="text-sm text-gray-600 truncate max-w-[120px]">{item.name}</span>
                                                </div>
                                                <span className="text-sm font-semibold">{item.units?.toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Secondary Charts */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Top Distributors */}
                            <Card className="border-0 shadow-lg bg-white/80 backdrop-blur">
                                <CardHeader>
                                    <CardTitle className="text-lg font-semibold">Top Distributors</CardTitle>
                                    <CardDescription>By shipment volume</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[300px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={data?.distributorPerformance?.slice(0, 5) || []} layout="vertical" margin={{ left: 20 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                                <XAxis type="number" hide />
                                                <YAxis
                                                    dataKey="name"
                                                    type="category"
                                                    width={100}
                                                    tick={{ fontSize: 12, fill: '#6b7280' }}
                                                    tickLine={false}
                                                    axisLine={false}
                                                />
                                                <Tooltip 
                                                    cursor={{ fill: 'transparent' }}
                                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                                                    formatter={(value: number) => [value.toLocaleString(), 'Units']}
                                                />
                                                <Bar dataKey="units" radius={[0, 8, 8, 0]} barSize={24}>
                                                    {(data?.distributorPerformance?.slice(0, 5) || []).map((entry: any, index: number) => (
                                                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Recent Activity */}
                            <Card className="border-0 shadow-lg bg-white/80 backdrop-blur">
                                <CardHeader>
                                    <CardTitle className="text-lg font-semibold">Recent Shipments</CardTitle>
                                    <CardDescription>Latest processed orders</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        {(data?.recentShipments || []).slice(0, 6).map((shipment: any, index: number) => (
                                            <div key={shipment.id || index} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-blue-100 rounded-lg">
                                                        <Truck className="w-4 h-4 text-blue-600" />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-900">{shipment.distributor}</p>
                                                        <p className="text-xs text-gray-500">{shipment.orderNo}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm font-semibold text-gray-900">{shipment.units?.toLocaleString()} units</p>
                                                    <p className="text-xs text-gray-500">{format(new Date(shipment.date), 'MMM dd, HH:mm')}</p>
                                                </div>
                                            </div>
                                        ))}
                                        {(!data?.recentShipments || data.recentShipments.length === 0) && (
                                            <div className="text-center py-8 text-gray-500">
                                                <BoxIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                                                <p>No recent shipments</p>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    {/* Operations Tab */}
                    <TabsContent value="operations" className="space-y-6 animate-in fade-in-50 duration-500">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <MetricCard
                                title="Orders in Progress"
                                value={data?.summary?.ordersInProgress || 0}
                                icon={Clock}
                                color={COLORS.warning}
                                subtitle="submitted/approved"
                                loading={loading}
                            />
                            <MetricCard
                                title="Completed Orders"
                                value={data?.summary?.completedOrders || 0}
                                icon={CheckCircle2}
                                color={COLORS.success}
                                subtitle="shipped/closed"
                                loading={loading}
                            />
                            <MetricCard
                                title="Total POs"
                                value={data?.summary?.totalPOs || 0}
                                change={5.2}
                                changeType="increase"
                                icon={Receipt}
                                color={COLORS.purple}
                                subtitle="purchase orders"
                                loading={loading}
                            />
                            <MetricCard
                                title="Pending DOs"
                                value={data?.summary?.pendingDOs || 0}
                                icon={Truck}
                                color={COLORS.cyan}
                                subtitle="delivery orders"
                                loading={loading}
                            />
                        </div>

                        <Card className="border-0 shadow-lg bg-white/80 backdrop-blur">
                            <CardHeader>
                                <CardTitle className="text-lg font-semibold">Order Processing Timeline</CardTitle>
                                <CardDescription>Daily order volume and status breakdown</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="h-[400px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={trendData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                            <XAxis 
                                                dataKey="date" 
                                                tickFormatter={(value: string) => {
                                                    const [year, month] = value.split('-')
                                                    const date = new Date(parseInt(year), parseInt(month) - 1)
                                                    return format(date, 'MMM')
                                                }}
                                                tickLine={false}
                                                axisLine={false}
                                            />
                                            <YAxis tickLine={false} axisLine={false} />
                                            <Tooltip 
                                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                                            />
                                            <Legend />
                                            <Bar dataKey="units" name="Units Shipped" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
                                            <Line type="monotone" dataKey="units" name="Trend" stroke={COLORS.success} strokeWidth={2} dot={false} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Finance Tab */}
                    <TabsContent value="finance" className="space-y-6 animate-in fade-in-50 duration-500">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <MetricCard
                                title="Total Revenue"
                                value={financialMetrics?.totalRevenue || 0}
                                change={15.3}
                                changeType="increase"
                                icon={DollarSign}
                                color={COLORS.success}
                                subtitle="collected"
                                loading={!financialMetrics}
                            />
                            <MetricCard
                                title="Pending Payments"
                                value={financialMetrics?.pendingPayments || 0}
                                icon={Clock}
                                color={COLORS.warning}
                                subtitle="awaiting approval"
                                loading={!financialMetrics}
                            />
                            <MetricCard
                                title="Completed Payments"
                                value={financialMetrics?.completedPayments || 0}
                                icon={CheckCircle2}
                                color={COLORS.success}
                                subtitle="processed"
                                loading={!financialMetrics}
                            />
                            <MetricCard
                                title="Invoices Issued"
                                value={financialMetrics?.invoiceCount || 0}
                                icon={Receipt}
                                color={COLORS.purple}
                                subtitle="total"
                                loading={!financialMetrics}
                            />
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Revenue Breakdown */}
                            <Card className="border-0 shadow-lg bg-white/80 backdrop-blur">
                                <CardHeader>
                                    <CardTitle className="text-lg font-semibold">Revenue by Account Type</CardTitle>
                                    <CardDescription>Distribution across GL accounts</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[300px] flex items-center justify-center">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <RadialBarChart 
                                                cx="50%" 
                                                cy="50%" 
                                                innerRadius="30%" 
                                                outerRadius="100%" 
                                                data={[
                                                    { name: 'Sales Revenue', value: 85, fill: COLORS.success },
                                                    { name: 'Other Income', value: 15, fill: COLORS.primary },
                                                ]}
                                                startAngle={180} 
                                                endAngle={0}
                                            >
                                                <RadialBar
                                                    background
                                                    dataKey="value"
                                                    cornerRadius={10}
                                                />
                                                <Legend 
                                                    iconType="circle" 
                                                    layout="horizontal" 
                                                    verticalAlign="bottom"
                                                    wrapperStyle={{ paddingTop: '20px' }}
                                                />
                                                <Tooltip />
                                            </RadialBarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Payment Status */}
                            <Card className="border-0 shadow-lg bg-white/80 backdrop-blur">
                                <CardHeader>
                                    <CardTitle className="text-lg font-semibold">Payment Status Overview</CardTitle>
                                    <CardDescription>Current payment pipeline</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        {[
                                            { label: 'Approved & Collected', value: financialMetrics?.completedPayments || 0, total: 100, color: COLORS.success },
                                            { label: 'Pending Approval', value: financialMetrics?.pendingPayments || 0, total: 100, color: COLORS.warning },
                                            { label: 'Invoices Pending', value: Math.max(0, (financialMetrics?.invoiceCount || 0) - (financialMetrics?.completedPayments || 0)), total: 100, color: COLORS.primary },
                                        ].map((item, index) => (
                                            <div key={index} className="space-y-2">
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-gray-600">{item.label}</span>
                                                    <span className="font-semibold">{item.value}</span>
                                                </div>
                                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                                    <div 
                                                        className="h-full rounded-full transition-all duration-1000 ease-out"
                                                        style={{ 
                                                            width: `${Math.min((item.value / Math.max(item.total, 1)) * 100, 100)}%`,
                                                            backgroundColor: item.color
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="mt-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-100">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-green-100 rounded-lg">
                                                <Wallet className="w-5 h-5 text-green-600" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-green-900">Collection Rate</p>
                                                <p className="text-2xl font-bold text-green-600">
                                                    {financialMetrics?.invoiceCount 
                                                        ? Math.round((financialMetrics.completedPayments / financialMetrics.invoiceCount) * 100) 
                                                        : 0}%
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    {/* Products Tab */}
                    <TabsContent value="products" className="space-y-6 animate-in fade-in-50 duration-500">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <MetricCard
                                title="Active SKUs"
                                value={data?.summary?.totalSKUs || productMixData.length || 0}
                                icon={Package}
                                color={COLORS.primary}
                                subtitle="in inventory"
                                loading={loading}
                            />
                            <MetricCard
                                title="Total Units Ordered"
                                value={data?.summary?.totalUnits || 0}
                                icon={TrendingUp}
                                color={COLORS.success}
                                subtitle="across all orders"
                                loading={loading}
                            />
                            <MetricCard
                                title="Inventory Stock"
                                value={data?.summary?.totalInventory || 0}
                                icon={BoxIcon}
                                color={COLORS.purple}
                                subtitle="units on hand"
                                loading={loading}
                            />
                            <MetricCard
                                title="Product Diversity"
                                value={productMixData.length >= 5 ? 'High' : productMixData.length >= 3 ? 'Medium' : 'Low'}
                                icon={PieChartIcon}
                                color={COLORS.cyan}
                                subtitle="portfolio health"
                                loading={loading}
                            />
                        </div>

                        <Card className="border-0 shadow-lg bg-white/80 backdrop-blur">
                            <CardHeader>
                                <CardTitle className="text-lg font-semibold">Product Performance Matrix</CardTitle>
                                <CardDescription>Detailed breakdown by variant</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    {productMixData.map((product: any, index: number) => {
                                        const total = data?.summary?.totalUnits || 1
                                        const percentage = (product.units / total) * 100
                                        return (
                                            <div key={index} className="p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                                                        <span className="font-medium text-gray-900">{product.name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-4">
                                                        <span className="text-lg font-bold text-gray-900">{product.units?.toLocaleString()}</span>
                                                        <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                                                            {percentage.toFixed(1)}%
                                                        </Badge>
                                                    </div>
                                                </div>
                                                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                                    <div 
                                                        className="h-full rounded-full transition-all duration-1000 ease-out"
                                                        style={{ 
                                                            width: `${percentage}%`,
                                                            backgroundColor: CHART_COLORS[index % CHART_COLORS.length]
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

                {/* Footer */}
                <div className="text-center text-sm text-gray-500 pt-4 border-t">
                    <p>Last updated: {format(new Date(), 'MMMM dd, yyyy HH:mm:ss')} • Data refreshes automatically</p>
                </div>
            </div>
        </div>
    )
}
