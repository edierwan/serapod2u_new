'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Clock,
    FileText,
    Package,
    CheckCircle2,
    TruckIcon,
    Search,
    ArrowLeft,
    Filter
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
    organization_id: string
    organizations: {
        org_type_code: string
    }
}

interface AllActivitiesViewProps {
    userProfile: UserProfile
}

export default function AllActivitiesView({ userProfile }: AllActivitiesViewProps) {
    const [activities, setActivities] = useState<Activity[]>([])
    const [filteredActivities, setFilteredActivities] = useState<Activity[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [filterType, setFilterType] = useState<string>('all')
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        loadAllActivities()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userProfile.organization_id])

    useEffect(() => {
        filterActivities()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchQuery, filterType, activities])

    async function loadAllActivities() {
        try {
            setLoading(true)

            // Get ALL recent documents (no limit)
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
                .limit(100) // Get last 100 activities

            if (docsError) throw docsError

            // Get ALL recent orders (no limit)
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
                .limit(100) // Get last 100 orders

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

            setActivities(allActivities)
            setFilteredActivities(allActivities)
        } catch (error) {
            console.error('Error loading activities:', error)
        } finally {
            setLoading(false)
        }
    }

    function filterActivities() {
        let filtered = activities

        // Filter by type
        if (filterType !== 'all') {
            filtered = filtered.filter(a => a.type === filterType)
        }

        // Filter by search query
        if (searchQuery) {
            const query = searchQuery.toLowerCase()
            filtered = filtered.filter(a =>
                a.title.toLowerCase().includes(query) ||
                a.description.toLowerCase().includes(query)
            )
        }

        setFilteredActivities(filtered)
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
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Clock className="w-5 h-5" />
                        All Activities
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-center py-8 text-gray-500">
                        Loading activities...
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push('/dashboard')}
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Dashboard
                    </Button>
                    <h1 className="text-2xl font-bold">All Activities</h1>
                </div>
            </div>

            {/* Filters */}
            <Card>
                <CardContent className="pt-6">
                    <div className="flex flex-col md:flex-row gap-4">
                        {/* Search */}
                        <div className="flex-1">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input
                                    placeholder="Search activities..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-10"
                                />
                            </div>
                        </div>

                        {/* Filter by type */}
                        <div className="flex items-center gap-2">
                            <Filter className="w-4 h-4 text-gray-400" />
                            <select
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value)}
                                className="border rounded-md px-3 py-2 text-sm"
                            >
                                <option value="all">All Types</option>
                                <option value="document_created">Documents Created</option>
                                <option value="document_acknowledged">Documents Acknowledged</option>
                                <option value="order_created">Orders Created</option>
                            </select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Activities List */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                            <Clock className="w-5 h-5" />
                            Activities
                        </span>
                        <span className="text-sm font-normal text-gray-500">
                            {filteredActivities.length} {filteredActivities.length === 1 ? 'activity' : 'activities'}
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {filteredActivities.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            {searchQuery || filterType !== 'all'
                                ? 'No activities match your filters'
                                : 'No recent activities'
                            }
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {filteredActivities.map((activity) => (
                                <div key={activity.id} className="flex items-start gap-3 pb-3 border-b last:border-0">
                                    <div className={`p-2 rounded-lg ${activity.color} bg-opacity-10`}>
                                        {getActivityIcon(activity.icon)}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-gray-900 text-sm">
                                            {activity.title}
                                        </p>
                                        <p className="text-sm text-gray-600">
                                            {activity.description}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Clock className="w-3 h-3 text-gray-400" />
                                            <span className="text-xs text-gray-500">
                                                {formatTimeAgo(activity.timestamp)}
                                            </span>
                                            <span className="text-xs text-gray-400">•</span>
                                            <span className="text-xs text-gray-500">
                                                {new Date(activity.timestamp).toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
