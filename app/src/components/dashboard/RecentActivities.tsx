'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Clock,
  FileText,
  Package,
  CheckCircle2,
  TruckIcon,
  ChevronRight,
} from 'lucide-react'
import { getDocumentTypeLabel } from '@/lib/document-permissions'

interface Activity {
  id: string
  type: 'document_created' | 'document_acknowledged' | 'order_created' | 'order_status_changed'
  title: string
  description: string
  timestamp: string
  icon: 'document' | 'order' | 'check' | 'truck'
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
  }, [userProfile.organization_id])

  async function loadRecentActivities() {
    if (!userProfile.organization_id) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)

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

      const docActivities: Activity[] = (docs || []).flatMap((doc: any) => {
        const items: Activity[] = []

        items.push({
          id: `doc-created-${doc.id}`,
          type: 'document_created',
          title: `${getDocumentTypeLabel(doc.doc_type)} created`,
          description: doc.doc_no,
          timestamp: doc.created_at,
          icon: 'document',
        })

        if (doc.acknowledged_at) {
          items.push({
            id: `doc-ack-${doc.id}`,
            type: 'document_acknowledged',
            title: `${getDocumentTypeLabel(doc.doc_type)} acknowledged`,
            description: doc.doc_no,
            timestamp: doc.acknowledged_at,
            icon: 'check',
          })
        }

        return items
      })

      const orderActivities: Activity[] = (orders || []).map((order: any) => ({
        id: `order-${order.id}`,
        type: 'order_created',
        title: 'Order created',
        description: `${order.order_no} · ${formatOrderType(order.order_type)}`,
        timestamp: order.created_at,
        icon: 'order',
      }))

      const allActivities = [...docActivities, ...orderActivities]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10)

      setActivities(allActivities)
    } catch (error) {
      console.error('Error loading activities:', error)
    } finally {
      setLoading(false)
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

  function getDotClass(icon: Activity['icon']) {
    switch (icon) {
      case 'check':
        return 'bg-emerald-50 text-emerald-600'
      case 'document':
        return 'bg-[var(--sera-orange)]/10 text-[var(--sera-orange)]'
      case 'truck':
        return 'bg-[var(--sera-ink)]/5 text-[var(--sera-ink)]'
      default:
        return 'bg-[var(--sera-ink)]/5 text-[var(--sera-muted)]'
    }
  }

  if (loading) {
    return (
      <div className="sera-sc-panel overflow-hidden min-h-[280px] h-full">
        <div className="sera-sc-panel__head">
          <div className="h-5 w-40 bg-[var(--sera-ink)]/5 rounded animate-pulse" />
        </div>
        <div className="sera-sc-panel__body space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-[var(--sera-ink)]/5 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="sera-sc-panel overflow-hidden h-full">
      <div className="sera-sc-panel__head">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--sera-ink)]/5">
            <Clock className="w-4.5 h-4.5 text-[var(--sera-ink)]" strokeWidth={1.75} />
          </div>
          <div>
            <h3 className="sera-sc-panel__title font-display">Recent Activities</h3>
            <p className="text-xs text-[var(--sera-muted)]">Latest updates across your organization</p>
          </div>
        </div>
      </div>

      <div className="sera-sc-panel__body">
        {activities.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 rounded-xl bg-[var(--sera-ink)]/5 flex items-center justify-center mx-auto mb-3">
              <Clock className="w-6 h-6 text-[var(--sera-muted)]" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium text-[var(--sera-ink-soft)]">No recent activities</p>
            <p className="text-xs text-[var(--sera-muted)] mt-0.5">Updates will appear here as they happen</p>
          </div>
        ) : (
          <>
            <div className="sera-dashboard-timeline">
              {activities.slice(0, 5).map((activity) => (
                <div key={activity.id} className="sera-dashboard-timeline__item">
                  <div className={`sera-dashboard-timeline__dot ${getDotClass(activity.icon)}`}>
                    {getActivityIcon(activity.icon)}
                  </div>

                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-sm font-medium text-[var(--sera-ink)] leading-tight">
                      {activity.title}
                    </p>
                    <p className="text-xs text-[var(--sera-muted)] truncate mt-0.5">
                      {activity.description}
                    </p>
                  </div>

                  <span className="text-[11px] text-[var(--sera-muted)] whitespace-nowrap pt-1 flex-shrink-0">
                    {formatTimeAgo(activity.timestamp)}
                  </span>
                </div>
              ))}
            </div>

            {activities.length > 5 && (
              <div className="mt-4 pt-3 border-t border-[var(--sera-line)]">
                <a
                  href="/dashboard/activities"
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--sera-muted)] hover:text-[var(--sera-orange)] transition-colors"
                >
                  View all activities
                  <ChevronRight className="w-3 h-3" />
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
