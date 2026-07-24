/**
 * CRM Module Navigation Configuration
 *
 * Single source of truth for CRM navigation.
 * Mirrors the pattern used by Supply Chain and Finance modules.
 *
 * Groups:
 *  - Support & Insights: customer support + activity tracking
 */

import {
    Inbox,
    Scan,
    HeadphonesIcon,
    type LucideIcon,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────

export interface CrmNavChild {
    /** View id – maps to currentView in DashboardContent */
    id: string
    label: string
    icon: LucideIcon
}

export interface CrmNavGroup {
    id: string
    label: string
    icon: LucideIcon
    description: string
    children: CrmNavChild[]
}

// ── Navigation tree ──────────────────────────────────────────────

export const crmNavGroups: CrmNavGroup[] = [
    {
        id: 'crm-support',
        label: 'Support & Insights',
        icon: HeadphonesIcon,
        description: 'Handle customer conversations and track consumer engagement activity.',
        children: [
            { id: 'consumer-activations', label: 'Customer Activity', icon: Scan },
            { id: 'support-inbox', label: 'Support Inbox', icon: Inbox },
        ],
    },
]

// ── Flat list helpers ────────────────────────────────────────────

export function getAllCrmNavItems(): CrmNavChild[] {
    return crmNavGroups.flatMap((g) => g.children)
}

const _allCrmViewIds = new Set<string>([
    'crm',
    ...crmNavGroups.flatMap((g) => g.children.map((c) => c.id)),
])

export function isCrmViewId(viewId: string): boolean {
    return _allCrmViewIds.has(viewId)
}

/** Admin URL paths for CRM subviews under /crm/... */
export const crmViewToPath: Record<string, string> = {
    'consumer-activations': 'activity',
    'support-inbox': 'support-inbox',
}

export const crmPathToView: Record<string, string> = Object.fromEntries(
    Object.entries(crmViewToPath).map(([view, path]) => [path, view])
)

export function crmHrefForView(viewId: string): string | null {
    if (viewId === 'crm') return '/crm'
    const path = crmViewToPath[viewId]
    return path ? `/crm/${path}` : null
}

export function resolveCrmSlug(slug: string[]): string {
    const path = slug.join('/')
    return crmPathToView[path] || crmPathToView[slug[0] || ''] || 'crm'
}

export function findCrmGroupForView(viewId: string): CrmNavGroup | undefined {
    return crmNavGroups.find(
        (g) => g.id === viewId || g.children.some((c) => c.id === viewId)
    )
}

export function getCrmBreadcrumb(viewId: string): { label: string; href?: string }[] {
    const crumbs: { label: string; href?: string }[] = [{ label: 'Customer & Growth', href: 'customer-growth' }, { label: 'CRM', href: 'crm' }]
    const group = findCrmGroupForView(viewId)
    if (group) {
        crumbs.push({ label: group.label })
        const child = group.children.find((c) => c.id === viewId)
        if (child) {
            crumbs.push({ label: child.label, href: child.id })
        }
    }
    return crumbs
}
