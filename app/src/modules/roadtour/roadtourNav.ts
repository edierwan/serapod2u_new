import { BookOpen, MessageSquare, Map, Settings, BarChart3, QrCode, ClipboardList, Users, Smartphone, TrendingUp, Store, UserCheck, Flag, Target, CalendarCheck } from 'lucide-react'

export interface RoadtourNavChild {
    id: string
    label: string
    icon: any
    route?: string
    description?: string
}

export interface RoadtourNavGroup {
    id: string
    label: string
    icon: any
    description?: string
    children: RoadtourNavChild[]
}

export const roadtourNavGroups: RoadtourNavGroup[] = [
    {
        id: 'rt-campaigns',
        label: 'Campaign Management',
        icon: Map,
        description: 'Create and manage RoadTour campaigns, assign account managers, and track performance.',
        children: [
            { id: 'roadtour-campaigns', label: 'Campaigns', icon: Map, route: '/roadtour/campaigns' },
            { id: 'roadtour-qr', label: 'QR Management', icon: QrCode, route: '/roadtour/qr' },
        ],
    },
    {
        id: 'rt-analytics',
        label: 'Analytics',
        icon: BarChart3,
        description: 'Monitor campaign performance, post-visit shop impact, and account manager effectiveness.',
        children: [
            { id: 'roadtour-analytics', label: 'Analytics Overview', icon: BarChart3, route: '/roadtour/analytics' },
            { id: 'roadtour-visits', label: 'Visits', icon: Users, route: '/roadtour/visits' },
            { id: 'roadtour-post-visit-impact', label: 'Post-Visit Impact Report', icon: TrendingUp, route: '/roadtour/analytics/post-visit-impact' },
            { id: 'roadtour-shop-impact', label: 'Shop Impact Detail', icon: Store, route: '/roadtour/analytics/shop-impact' },
            { id: 'roadtour-am-impact', label: 'Account Manager Impact', icon: UserCheck, route: '/roadtour/analytics/am-impact' },
            { id: 'roadtour-follow-up-priority', label: 'Follow-Up Priority Queue', icon: Flag, route: '/roadtour/analytics/follow-up-priority' },
            { id: 'roadtour-monthly-kpi-report', label: 'Monthly KPI Performance Report', icon: CalendarCheck, route: '/roadtour/analytics/monthly-kpi' },
            { id: 'roadtour-whatsapp', label: 'WhatsApp Monitoring', icon: Smartphone, route: '/roadtour/whatsapp' },
        ],
    },
    {
        id: 'rt-settings',
        label: 'Settings',
        icon: Settings,
        description: 'Configure RoadTour module settings, surveys, user registration, and preferences.',
        children: [
            { id: 'roadtour-surveys', label: 'Surveys', icon: ClipboardList, route: '/roadtour/surveys' },
            { id: 'roadtour-kpi-settings', label: 'KPI & Incentive Settings', icon: Target, route: '/roadtour/settings/kpi' },
            { id: 'roadtour-settings', label: 'RoadTour Settings', icon: Settings, route: '/roadtour/settings' },
        ],
    },
]

const _allRoadtourViewIds = new Set<string>([
    'roadtour',
    ...roadtourNavGroups.flatMap((g) => g.children.map((c) => c.id)),
])

export function isRoadtourViewId(viewId: string): boolean {
    return _allRoadtourViewIds.has(viewId)
}

/**
 * Admin URL paths for RoadTour subviews.
 * Keep these as static first segments (never a 4-digit year) so they do not
 * collide with public consumer URLs: /roadtour/[year]/[campaignSlug]/[referenceSlug].
 */
export const roadtourViewToPath: Record<string, string> = {
    'roadtour-campaigns': 'campaigns',
    'roadtour-qr': 'qr',
    'roadtour-surveys': 'surveys',
    'roadtour-visits': 'visits',
    'roadtour-analytics': 'analytics',
    'roadtour-post-visit-impact': 'analytics/post-visit-impact',
    'roadtour-shop-impact': 'analytics/shop-impact',
    'roadtour-am-impact': 'analytics/am-impact',
    'roadtour-follow-up-priority': 'analytics/follow-up-priority',
    'roadtour-monthly-kpi-report': 'analytics/monthly-kpi',
    'roadtour-whatsapp': 'whatsapp',
    'roadtour-kpi-settings': 'settings/kpi',
    'roadtour-settings': 'settings',
}

export const roadtourPathToView: Record<string, string> = Object.fromEntries(
    Object.entries(roadtourViewToPath).map(([view, path]) => [path, view])
)

/** Full admin href for a RoadTour view id, or null if not URL-addressable here. */
export function roadtourHrefForView(viewId: string): string | null {
    if (viewId === 'roadtour') return '/roadtour'
    const path = roadtourViewToPath[viewId]
    return path ? `/roadtour/${path}` : null
}

export function resolveRoadtourAdminPath(path: string): string {
    return roadtourPathToView[path] || 'roadtour'
}

export function findRoadtourGroupForView(viewId: string): RoadtourNavGroup | undefined {
    return roadtourNavGroups.find((g) => g.children.some((c) => c.id === viewId))
}

export function getRoadtourBreadcrumb(viewId: string): { group?: string; item?: string } {
    const group = findRoadtourGroupForView(viewId)
    if (!group) return {}
    const child = group.children.find((c) => c.id === viewId)
    return { group: group.label, item: child?.label }
}
