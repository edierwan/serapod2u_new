import { BookOpen, MessageSquare, Map, Settings, BarChart3, QrCode, ClipboardList, Users } from 'lucide-react'

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
    id: 'rt-field',
    label: 'Field Operations',
    icon: ClipboardList,
    description: 'Track visits, manage surveys, and monitor field activity.',
    children: [
      { id: 'roadtour-visits', label: 'Visits', icon: Users },
      { id: 'roadtour-surveys', label: 'Surveys', icon: ClipboardList },
    ],
  },
  {
    id: 'rt-analytics',
    label: 'Analytics & Settings',
    icon: BarChart3,
    description: 'Monitor campaign performance, costs, and configure RoadTour settings.',
    children: [
      { id: 'roadtour-analytics', label: 'Analytics', icon: BarChart3 },
      { id: 'roadtour-settings', label: 'Settings', icon: Settings },
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
