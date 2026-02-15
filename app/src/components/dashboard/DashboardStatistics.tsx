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
  organization_id: string | null
  organizations: {
    org_type_code: string
  } | null
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

      if (!userProfile.organization_id) {
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
      if (userProfile.organizations?.org_type_code === 'DIST') {
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
      color: 'text-amber-600',
      bgColor: 'bg-gradient-to-br from-amber-50 to-orange-50',
      iconBg: 'bg-amber-100',
      borderColor: 'border-amber-100',
      description: 'Documents awaiting acknowledgment',
      trend: stats.pendingDocuments > 0 ? 'needs-attention' : 'ok'
    },
    {
      title: 'Active Orders',
      value: stats.activeOrders,
      icon: Package,
      color: 'text-blue-600',
      bgColor: 'bg-gradient-to-br from-blue-50 to-indigo-50',
      iconBg: 'bg-blue-100',
      borderColor: 'border-blue-100',
      description: 'Orders in progress',
      trend: 'neutral'
    },
    {
      title: 'Completed This Month',
      value: stats.completedThisMonth,
      icon: CheckCircle2,
      color: 'text-emerald-600',
      bgColor: 'bg-gradient-to-br from-emerald-50 to-teal-50',
      iconBg: 'bg-emerald-100',
      borderColor: 'border-emerald-100',
      description: 'Successfully closed orders',
      trend: 'positive'
    },
    {
      title: 'Documents Today',
      value: stats.documentsToday,
      icon: FileText,
      color: 'text-violet-600',
      bgColor: 'bg-gradient-to-br from-violet-50 to-purple-50',
      iconBg: 'bg-violet-100',
      borderColor: 'border-violet-100',
      description: 'New documents generated',
      trend: 'neutral'
    }
  ]

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl border bg-white p-5 animate-pulse">
            <div className="flex items-center justify-between mb-4">
              <div className="h-10 w-10 bg-gray-100 rounded-xl" />
              <div className="h-4 w-16 bg-gray-100 rounded-full" />
            </div>
            <div className="h-8 w-12 bg-gray-100 rounded-lg mb-1" />
            <div className="h-3 w-24 bg-gray-50 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {statCards.map((stat, index) => (
        <div
          key={index}
          className={`group relative overflow-hidden rounded-2xl border ${stat.borderColor} ${stat.bgColor} p-5 transition-all duration-300 hover:shadow-lg hover:shadow-gray-200/50 hover:-translate-y-0.5`}
        >
          {/* Subtle radial glow on hover */}
          <div className="absolute inset-0 bg-white/0 group-hover:bg-white/30 transition-colors duration-300" />
          
          <div className="relative z-10">
            {/* Top row: icon + trend indicator */}
            <div className="flex items-center justify-between mb-4">
              <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${stat.iconBg} transition-transform duration-300 group-hover:scale-110`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} strokeWidth={1.75} />
              </div>
              {stat.trend === 'needs-attention' && stat.value > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
                  <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
                  Action
                </span>
              )}
              {stat.trend === 'positive' && stat.value > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  <TrendingUp className="w-3 h-3" />
                </span>
              )}
            </div>

            {/* Value */}
            <p className="text-3xl font-bold text-gray-900 tracking-tight mb-0.5">
              {stat.value}
            </p>
            
            {/* Title */}
            <p className="text-sm font-medium text-gray-600 mb-0.5">
              {stat.title}
            </p>
            
            {/* Description — hidden on mobile */}
            <p className="text-xs text-gray-400 hidden sm:block">
              {stat.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
