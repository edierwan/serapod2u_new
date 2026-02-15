'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Clock,
  FileText,
  Package,
  CheckCircle2,
  TruckIcon
} from 'lucide-react'
import { getDocumentTypeLabel } from '@/lib/document-permissions'

interface Activity {
  id: string
  type: 'document_created' | 'document_acknowledged' | 'order_created' | 'order_status_changed'
  title: string
  description: string
  timestamp: string
  icon: 'document' | 'order' | 'check' | 'truck'
  color: string
}

interface UserProfile {
  id: string
  organization_id: string | null
  organizations: {
    org_type_code: string
  } | null
}

interface RecentActivitiesProps {
  userProfile: UserProfile
}

export default function RecentActivities({ userProfile }: RecentActivitiesProps) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadRecentActivities()
    // eslint-disable-next-line react-hooks/exhaustive-deps

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile.organization_id])

  async function loadRecentActivities() {
    if (!userProfile.organization_id) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)

      // Get recent documents
      const { data: docs, error: docsError } = await supabase
        .from('documents')
        .select(`
          id,
          doc_type,
          doc_no,
          status,
          created_at,
          acknowledged_at,
          issued_by_org:organizations!documents_issued_by_org_id_fkey(org_name),
          issued_to_org:organizations!documents_issued_to_org_id_fkey(org_name)
        `)
        .or(`issued_by_org_id.eq.${userProfile.organization_id},issued_to_org_id.eq.${userProfile.organization_id}`)
        .order('created_at', { ascending: false })
        .limit(5)

      if (docsError) throw docsError

      // Get recent orders
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select(`
          id,
          order_no,
          order_type,
          status,
          created_at,
          updated_at
        `)
        .or(`buyer_org_id.eq.${userProfile.organization_id},seller_org_id.eq.${userProfile.organization_id}`)
        .order('created_at', { ascending: false })
        .limit(5)

      if (ordersError) throw ordersError

      // Combine and sort activities
      const docActivities: Activity[] = (docs || []).flatMap((doc: any) => {
        const activities: Activity[] = []

        // Document created
        activities.push({
          id: `doc-created-${doc.id}`,
          type: 'document_created',
          title: `${getDocumentTypeLabel(doc.doc_type)} Created`,
          description: `${doc.doc_no}`,
          timestamp: doc.created_at,
          icon: 'document',
          color: getDocColorClass(doc.doc_type)
        })

        // Document acknowledged
        if (doc.acknowledged_at) {
          activities.push({
            id: `doc-ack-${doc.id}`,
            type: 'document_acknowledged',
            title: `${getDocumentTypeLabel(doc.doc_type)} Acknowledged`,
            description: `${doc.doc_no}`,
            timestamp: doc.acknowledged_at,
            icon: 'check',
            color: 'text-green-600'
          })
        }

        return activities
      })

      const orderActivities: Activity[] = (orders || []).map((order: any) => ({
        id: `order-${order.id}`,
        type: 'order_created',
        title: 'Order Created',
        description: `${order.order_no} - ${formatOrderType(order.order_type)}`,
        timestamp: order.created_at,
        icon: 'order',
        color: 'text-blue-600'
      }))

      const allActivities = [...docActivities, ...orderActivities]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10) // Keep track of up to 10 for determining if View More should show

      setActivities(allActivities)
    } catch (error) {
      console.error('Error loading activities:', error)
    } finally {
      setLoading(false)
    }
  }

  function getDocColorClass(docType: string): string {
    switch (docType) {
      case 'PO': return 'text-blue-600'
      case 'INVOICE': return 'text-green-600'
      case 'PAYMENT': return 'text-purple-600'
      case 'RECEIPT': return 'text-orange-600'
      default: return 'text-gray-600'
    }
  }

  function formatOrderType(orderType: string): string {
    switch (orderType) {
      case 'H2M': return 'HQ → Manufacturer'
      case 'D2H': return 'Distributor → HQ'
      case 'S2D': return 'Shop → Distributor'
      default: return orderType
    }
  }

  function formatTimeAgo(dateString: string): string {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  function getActivityIcon(icon: Activity['icon']) {
    switch (icon) {
      case 'document':
        return <FileText className="w-4 h-4" />
      case 'order':
        return <Package className="w-4 h-4" />
      case 'check':
        return <CheckCircle2 className="w-4 h-4" />
      case 'truck':
        return <TruckIcon className="w-4 h-4" />
      default:
        return <Clock className="w-4 h-4" />
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white">
        <div className="px-6 py-5 border-b border-gray-50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gray-100 animate-pulse" />
            <div className="h-5 w-36 bg-gray-100 rounded-lg animate-pulse" />
          </div>
        </div>
        <div className="p-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-lg bg-gray-50" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 bg-gray-100 rounded-full" />
                <div className="h-3 w-40 bg-gray-50 rounded-full" />
              </div>
              <div className="h-3 w-12 bg-gray-50 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100">
            <Clock className="w-4.5 h-4.5 text-slate-600" strokeWidth={1.75} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Recent Activities</h3>
            <p className="text-xs text-gray-400">Latest updates across your organization</p>
          </div>
        </div>
      </div>
      <div className="p-4">
        {activities.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
              <Clock className="w-6 h-6 text-gray-300" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium text-gray-500">No recent activities</p>
            <p className="text-xs text-gray-400 mt-0.5">Activities will appear here</p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              {activities.slice(0, 5).map((activity, idx) => (
                <div
                  key={activity.id}
                  className="group flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50/80 transition-colors"
                >
                  <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 ${
                    activity.icon === 'check' 
                      ? 'bg-emerald-50 text-emerald-600' 
                      : activity.icon === 'document'
                      ? 'bg-blue-50 text-blue-600'
                      : activity.icon === 'truck'
                      ? 'bg-indigo-50 text-indigo-600'
                      : 'bg-slate-50 text-slate-600'
                  }`}>
                    {getActivityIcon(activity.icon)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 leading-tight">
                      {activity.title}
                    </p>
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {activity.description}
                    </p>
                  </div>

                  <span className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 flex-shrink-0">
                    {formatTimeAgo(activity.timestamp)}
                  </span>
                </div>
              ))}
            </div>

            {/* View More Link */}
            {activities.length > 5 && (
              <div className="mt-3 pt-3 border-t border-gray-50 px-3">
                <a
                  href="/dashboard/activities"
                  className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
                >
                  View all activities
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
