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
            { id: 'roadtour-campaigns', label: 'Campaigns', icon: Map },
            { id: 'roadtour-qr', label: 'QR Management', icon: QrCode },
        ],
    },
    {
        id: 'rt-analytics',
        label: 'Analytics',
        icon: BarChart3,
        description: 'Monitor campaign performance, post-visit shop impact, and account manager effectiveness.',
        children: [
            { id: 'roadtour-analytics', label: 'Analytics Overview', icon: BarChart3 },
            { id: 'roadtour-visits', label: 'Visits', icon: Users },
            { id: 'roadtour-post-visit-impact', label: 'Post-Visit Impact Report', icon: TrendingUp },
            { id: 'roadtour-shop-impact', label: 'Shop Impact Detail', icon: Store },
            { id: 'roadtour-am-impact', label: 'Account Manager Impact', icon: UserCheck },
            { id: 'roadtour-follow-up-priority', label: 'Follow-Up Priority Queue', icon: Flag },
            { id: 'roadtour-monthly-kpi-report', label: 'Monthly KPI Performance Report', icon: CalendarCheck },
            { id: 'roadtour-whatsapp', label: 'WhatsApp Monitoring', icon: Smartphone },
        ],
    },
    {
        id: 'rt-settings',
        label: 'Settings',
        icon: Settings,
        description: 'Configure RoadTour module settings, surveys, user registration, and preferences.',
        children: [
            { id: 'roadtour-surveys', label: 'Surveys', icon: ClipboardList },
            { id: 'roadtour-kpi-settings', label: 'KPI & Incentive Settings', icon: Target },
            { id: 'roadtour-settings', label: 'RoadTour Settings', icon: Settings },
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

export function findRoadtourGroupForView(viewId: string): RoadtourNavGroup | undefined {
    return roadtourNavGroups.find((g) => g.children.some((c) => c.id === viewId))
}

export function getRoadtourBreadcrumb(viewId: string): { group?: string; item?: string } {
    const group = findRoadtourGroupForView(viewId)
    if (!group) return {}
    const child = group.children.find((c) => c.id === viewId)
    return { group: group.label, item: child?.label }
}
