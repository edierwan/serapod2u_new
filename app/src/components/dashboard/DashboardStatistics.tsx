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
      description: 'Documents awaiting acknowledgment',
      trend: stats.pendingDocuments > 0 ? 'needs-attention' : 'ok',
      accent: true,
    },
    {
      title: 'Active Orders',
      value: stats.activeOrders,
      icon: Package,
      description: 'Orders in progress',
      trend: 'neutral',
      accent: false,
    },
    {
      title: 'Completed This Month',
      value: stats.completedThisMonth,
      icon: CheckCircle2,
      description: 'Successfully closed orders',
      trend: 'positive',
      accent: false,
    },
    {
      title: 'Documents Today',
      value: stats.documentsToday,
      icon: FileText,
      description: 'New documents generated',
      trend: 'neutral',
      accent: false,
    }
  ]

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-[var(--sera-line,#e5e7eb)] bg-white p-5 animate-pulse">
            <div className="flex items-center justify-between mb-4">
              <div className="h-10 w-10 bg-gray-100 rounded-lg" />
              <div className="h-4 w-16 bg-gray-100 rounded" />
            </div>
            <div className="h-8 w-12 bg-gray-100 rounded-lg mb-1" />
            <div className="h-3 w-24 bg-gray-50 rounded" />
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
          className="group relative overflow-hidden rounded-xl border border-[var(--sera-line,#e5e7eb)] bg-white p-5 transition-colors hover:border-[var(--sera-orange)]/35"
        >
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${stat.accent && stat.value > 0 ? 'bg-[var(--sera-orange)]/10 text-[var(--sera-orange)]' : 'bg-[var(--sera-ink)]/5 text-[var(--sera-ink)]'}`}>
                <stat.icon className="w-5 h-5" strokeWidth={1.75} />
              </div>
              {stat.trend === 'needs-attention' && stat.value > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--sera-orange)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--sera-orange-deep)] uppercase tracking-wider">
                  <span className="w-1 h-1 rounded-full bg-[var(--sera-orange)] animate-pulse" />
                  Action
                </span>
              )}
              {stat.trend === 'positive' && stat.value > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--sera-ink)]/5 px-2 py-0.5 text-[10px] font-semibold text-[var(--sera-ink)]">
                  <TrendingUp className="w-3 h-3" />
                </span>
              )}
            </div>

            <p className="font-display text-3xl font-semibold text-[var(--sera-ink)] tracking-tight mb-0.5">
              {stat.value}
            </p>

            <p className="text-sm font-medium text-[var(--sera-ink-soft)] mb-0.5">
              {stat.title}
            </p>

            <p className="text-xs text-[var(--sera-muted)] hidden sm:block">
              {stat.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
