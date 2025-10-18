'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  BarChart3,
  Download,
  Calendar,
  TrendingUp,
  TrendingDown,
  Package,
  DollarSign,
  Users,
  Building2,
  AlertTriangle,
  Eye,
  FileText,
  PieChart,
  Activity
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

interface ReportMetric {
  title: string
  value: string | number
  change: string
  trend: 'up' | 'down' | 'neutral'
  icon: React.ComponentType<any>
  color: string
}

interface Report {
  id: string
  title: string
  description: string
  category: string
  lastGenerated: string
  frequency: string
  icon: React.ComponentType<any>
  access_level: number
}

export default function ReportsView({ userProfile }: ReportsViewProps) {
  const [selectedPeriod, setSelectedPeriod] = useState('30d')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const { isReady, supabase } = useSupabaseAuth()

  useEffect(() => {
    // Simulate loading time for reports
    const timer = setTimeout(() => setLoading(false), 1000)
    return () => clearTimeout(timer)
  }, [])

  // Mock metrics data - In real implementation, this would come from API calls
  const metrics: ReportMetric[] = [
    {
      title: 'Total Revenue',
      value: 'RM 2,456,789',
      change: '+12.5%',
      trend: 'up',
      icon: DollarSign,
      color: 'text-green-600'
    },
    {
      title: 'Product Sales',
      value: '15,847',
      change: '+8.2%',
      trend: 'up',
      icon: Package,
      color: 'text-blue-600'
    },
    {
      title: 'Active Organizations',
      value: 89,
      change: '+5.7%',
      trend: 'up',
      icon: Building2,
      color: 'text-purple-600'
    },
    {
      title: 'Low Stock Items',
      value: 23,
      change: '+15.3%',
      trend: 'down',
      icon: AlertTriangle,
      color: 'text-red-600'
    }
  ]

  // Available reports based on user access level
  const availableReports: Report[] = [
    {
      id: 'sales-summary',
      title: 'Sales Summary Report',
      description: 'Comprehensive overview of sales performance and trends',
      category: 'sales',
      lastGenerated: '2024-01-15',
      frequency: 'Daily',
      icon: BarChart3,
      access_level: 60
    },
    {
      id: 'inventory-status',
      title: 'Inventory Status Report',
      description: 'Current stock levels, low stock alerts, and reorder recommendations',
      category: 'inventory',
      lastGenerated: '2024-01-15',
      frequency: 'Daily',
      icon: Package,
      access_level: 50
    },
    {
      id: 'financial-overview',
      title: 'Financial Overview',
      description: 'Revenue, profit margins, and financial performance metrics',
      category: 'financial',
      lastGenerated: '2024-01-14',
      frequency: 'Weekly',
      icon: DollarSign,
      access_level: 80
    },
    {
      id: 'distributor-performance',
      title: 'Distributor Performance',
      description: 'Analysis of distributor sales, commissions, and territory coverage',
      category: 'distributors',
      lastGenerated: '2024-01-13',
      frequency: 'Weekly',
      icon: Users,
      access_level: 70
    },
    {
      id: 'organization-analytics',
      title: 'Organization Analytics',
      description: 'Performance metrics across different organizational levels',
      category: 'organizations',
      lastGenerated: '2024-01-12',
      frequency: 'Monthly',
      icon: Building2,
      access_level: 80
    },
    {
      id: 'product-performance',
      title: 'Product Performance Report',
      description: 'Best and worst performing products, category analysis',
      category: 'products',
      lastGenerated: '2024-01-11',
      frequency: 'Weekly',
      icon: PieChart,
      access_level: 60
    },
    {
      id: 'user-activity',
      title: 'User Activity Report',
      description: 'User login patterns, feature usage, and system activity',
      category: 'system',
      lastGenerated: '2024-01-10',
      frequency: 'Monthly',
      icon: Activity,
      access_level: 80
    },
    {
      id: 'audit-trail',
      title: 'Audit Trail Report',
      description: 'Complete audit log of system changes and user actions',
      category: 'system',
      lastGenerated: '2024-01-09',
      frequency: 'Monthly',
      icon: FileText,
      access_level: 90
    }
  ]

  // Filter reports based on user access level and selected category
  const filteredReports = availableReports.filter(report => {
    const hasAccess = userProfile.roles.role_level >= report.access_level
    const matchesCategory = selectedCategory === 'all' || report.category === selectedCategory
    return hasAccess && matchesCategory
  })

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-MY', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const getCategoryColor = (category: string) => {
    const colors = {
      'sales': 'bg-green-100 text-green-700',
      'inventory': 'bg-blue-100 text-blue-700',
      'financial': 'bg-purple-100 text-purple-700',
      'distributors': 'bg-orange-100 text-orange-700',
      'organizations': 'bg-pink-100 text-pink-700',
      'products': 'bg-yellow-100 text-yellow-700',
      'system': 'bg-gray-100 text-gray-700'
    }
    return colors[category as keyof typeof colors] || 'bg-gray-100 text-gray-700'
  }

  const getFrequencyColor = (frequency: string) => {
    const colors = {
      'Daily': 'bg-green-50 text-green-600',
      'Weekly': 'bg-blue-50 text-blue-600',
      'Monthly': 'bg-purple-50 text-purple-600'
    }
    return colors[frequency as keyof typeof colors] || 'bg-gray-50 text-gray-600'
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Reports & Analytics</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-gray-200 rounded mb-4"></div>
                <div className="h-8 bg-gray-200 rounded mb-2"></div>
                <div className="h-4 bg-gray-200 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Reports & Analytics</h2>
          <p className="text-gray-600">Monitor performance and generate insights</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-32">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric, index) => {
          const Icon = metric.icon
          return (
            <Card key={index}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-lg bg-gray-50 flex items-center justify-center">
                    <Icon className={`w-6 h-6 ${metric.color}`} />
                  </div>
                  <div className={`flex items-center gap-1 text-sm ${
                    metric.trend === 'up' ? 'text-green-600' : 
                    metric.trend === 'down' ? 'text-red-600' : 'text-gray-600'
                  }`}>
                    {metric.trend === 'up' ? <TrendingUp className="w-4 h-4" /> : 
                     metric.trend === 'down' ? <TrendingDown className="w-4 h-4" /> : null}
                    <span>{metric.change}</span>
                  </div>
                </div>
                <p className="text-gray-600 text-sm mb-1">{metric.title}</p>
                <p className="text-2xl font-bold text-gray-900">{metric.value}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Report Filters */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <div className="flex-1">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Available Reports</h3>
              <p className="text-sm text-gray-600">Generate and download reports based on your access level</p>
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="inventory">Inventory</SelectItem>
                <SelectItem value="financial">Financial</SelectItem>
                <SelectItem value="distributors">Distributors</SelectItem>
                <SelectItem value="organizations">Organizations</SelectItem>
                <SelectItem value="products">Products</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Reports Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredReports.map((report) => {
          const Icon = report.icon
          return (
            <Card key={report.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="w-5 h-5 text-blue-600" />
                    <div>
                      <CardTitle className="text-lg">{report.title}</CardTitle>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(report.category)}`}>
                      {report.category}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getFrequencyColor(report.frequency)}`}>
                      {report.frequency}
                    </span>
                  </div>
                </div>
                <CardDescription className="mt-2">
                  {report.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Last Generated */}
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="w-4 h-4" />
                  <span>Last generated: {formatDate(report.lastGenerated)}</span>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" className="flex-1">
                    <Eye className="w-4 h-4 mr-2" />
                    View
                  </Button>
                  <Button size="sm" className="flex-1">
                    <Download className="w-4 h-4 mr-2" />
                    Generate
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {filteredReports.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No reports available</h3>
            <p className="text-gray-600 mb-4">
              {selectedCategory !== 'all' 
                ? 'No reports found in this category for your access level'
                : 'No reports available for your current access level'
              }
            </p>
            {selectedCategory !== 'all' && (
              <Button variant="outline" onClick={() => setSelectedCategory('all')}>
                View All Categories
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common reporting tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Button variant="outline" className="justify-start">
              <Download className="w-4 h-4 mr-2" />
              Export All Data
            </Button>
            <Button variant="outline" className="justify-start">
              <BarChart3 className="w-4 h-4 mr-2" />
              Custom Report
            </Button>
            <Button variant="outline" className="justify-start">
              <Calendar className="w-4 h-4 mr-2" />
              Schedule Report
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}