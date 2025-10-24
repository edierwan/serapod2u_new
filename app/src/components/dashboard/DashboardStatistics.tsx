'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { 
  FileText, 
  Package, 
  Clock, 
  CheckCircle2,
  AlertCircle,
  TrendingUp
} from 'lucide-react'

interface DashboardStats {
  pendingDocuments: number
  activeOrders: number
  completedThisMonth: number
  documentsToday: number
}

interface UserProfile {
  id: string
  organization_id: string
  organizations: {
    org_type_code: string
  }
}

interface DashboardStatsProps {
  userProfile: UserProfile
}

export default function DashboardStatistics({ userProfile }: DashboardStatsProps) {
  const [stats, setStats] = useState<DashboardStats>({
    pendingDocuments: 0,
    activeOrders: 0,
    completedThisMonth: 0,
    documentsToday: 0
  })
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadStatistics()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile.organization_id])

  async function loadStatistics() {
    try {
      setLoading(true)

      // Ensure user is authenticated before making queries
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        console.warn('No active session, skipping statistics load')
        setLoading(false)
        return
      }

      let pendingCount = 0

      // Get pending documents count
      const { count: pendingDocsCount, error: pendingError } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('issued_to_org_id', userProfile.organization_id)
        .eq('status', 'pending')

      if (pendingError) {
        console.error('Error loading pending documents:', pendingError)
      } else {
        pendingCount = pendingDocsCount || 0
      }

      // For distributors, add approved H2M orders to pending actions count
      if (userProfile.organizations.org_type_code === 'DIST') {
        try {
          // Get parent org (HQ) for this distributor
          const { data: orgData, error: orgError } = await supabase
            .from('organizations')
            .select('parent_org_id')
            .eq('id', userProfile.organization_id)
            .single()

          if (!orgError && orgData?.parent_org_id) {
            // Count approved H2M orders from parent HQ in last 30 days
            const thirtyDaysAgo = new Date()
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

            const { count: h2mCount, error: h2mError } = await supabase
              .from('orders')
              .select('*', { count: 'exact', head: true })
              .eq('order_type', 'H2M')
              .eq('status', 'approved')
              .eq('buyer_org_id', orgData.parent_org_id)
              .gte('approved_at', thirtyDaysAgo.toISOString())

            if (!h2mError) {
              pendingCount += (h2mCount || 0)
            }
          }
        } catch (error) {
          console.error('Error loading H2M orders for distributor:', error)
        }
      }

      // Get active orders count - using approved status instead of non-existent statuses
      const { count: activeOrdersCount, error: activeError } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .or(`buyer_org_id.eq.${userProfile.organization_id},seller_org_id.eq.${userProfile.organization_id}`)
        .in('status', ['submitted', 'approved'])

      if (activeError) {
        console.error('Error loading active orders:', activeError)
      }

      // Get completed orders this month
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)

      const { count: completedCount, error: completedError } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .or(`buyer_org_id.eq.${userProfile.organization_id},seller_org_id.eq.${userProfile.organization_id}`)
        .eq('status', 'closed')
        .gte('updated_at', startOfMonth.toISOString())

      if (completedError) {
        console.error('Error loading completed orders:', completedError)
      }

      // Get documents created today
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)

      const { count: todayDocsCount, error: todayError } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .or(`issued_by_org_id.eq.${userProfile.organization_id},issued_to_org_id.eq.${userProfile.organization_id}`)
        .gte('created_at', startOfDay.toISOString())

      if (todayError) {
        console.error('Error loading today documents:', todayError)
      }

      setStats({
        pendingDocuments: pendingCount,
        activeOrders: activeOrdersCount || 0,
        completedThisMonth: completedCount || 0,
        documentsToday: todayDocsCount || 0
      })
    } catch (error) {
      console.error('Error loading statistics:', error)
    } finally {
      setLoading(false)
    }
  }

  const statCards = [
    {
      title: 'Pending Actions',
      value: stats.pendingDocuments,
      icon: AlertCircle,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      description: 'Documents awaiting acknowledgment'
    },
    {
      title: 'Active Orders',
      value: stats.activeOrders,
      icon: Package,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      description: 'Orders in progress'
    },
    {
      title: 'Completed This Month',
      value: stats.completedThisMonth,
      icon: CheckCircle2,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      description: 'Successfully closed orders'
    },
    {
      title: 'Documents Today',
      value: stats.documentsToday,
      icon: FileText,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      description: 'New documents generated'
    }
  ]

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="h-20 bg-gray-200 rounded"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {statCards.map((stat, index) => (
        <Card key={index} className="hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">
                  {stat.title}
                </p>
                <p className="text-3xl font-bold text-gray-900 mb-1">
                  {stat.value}
                </p>
                <p className="text-xs text-gray-500">
                  {stat.description}
                </p>
              </div>
              <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
