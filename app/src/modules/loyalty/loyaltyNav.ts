/**
 * Loyalty Module Navigation Configuration
 *
 * Single source of truth for Loyalty (Rewards & Gamification) navigation.
 * Mirrors the pattern used by Supply Chain (src/modules/supply-chain/supplyChainNav.ts)
 * and Finance (src/modules/finance/financeNav.ts).
 *
 * After splitting, Loyalty keeps only rewards & games:
 *  - Rewards & Games: loyalty programs (points, draws, games, redemptions)
 *
 * Moved to other modules:
 *  - CRM: Support Inbox, Customer Activity (consumer-activations)
 *  - Marketing: Journey Builder, WhatsApp Broadcast
 *  - Catalog: Product Catalog
 */

import {
    Trophy,
    Gift,
    Gamepad2,
    type LucideIcon,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────

export interface LoyaltyNavChild {
    /** View id – maps to currentView in DashboardContent */
    id: string
    label: string
    icon: LucideIcon
}

export interface LoyaltyNavGroup {
    /** Group key, e.g. 'ly-campaigns' */
    id: string
    label: string
    icon: LucideIcon
    description: string
    children: LoyaltyNavChild[]
}

// ── Navigation tree ──────────────────────────────────────────────
// Each child.id maps to an existing view in DashboardContent's renderCurrentView().

export const loyaltyNavGroups: LoyaltyNavGroup[] = [
    {
        id: 'ly-rewards',
        label: 'Rewards & Games',
        icon: Trophy,
        description: 'Manage loyalty point rewards, lucky draw events, interactive games, and gift redemptions.',
        children: [
            { id: 'point-catalog', label: 'Point Catalog', icon: Gift },
            { id: 'lucky-draw', label: 'Lucky Draw', icon: Trophy },
            { id: 'scratch-card-game', label: 'Games', icon: Gamepad2 },
            { id: 'redeem-gift-management', label: 'Redeem', icon: Gift },
        ],
    },
]

// ── Flat list helpers ────────────────────────────────────────────

/** All leaf-level nav items (for search, quick links, etc.) */
export function getAllLoyaltyNavItems(): LoyaltyNavChild[] {
    return loyaltyNavGroups.flatMap((g) => g.children)
}

/** Set of all Loyalty child view IDs (for detecting if a view belongs to Loyalty) */
const _allLoyaltyViewIds = new Set<string>([
    'loyalty',
    // Legacy parent id – still used in some places
    'consumer-engagement',
    ...loyaltyNavGroups.flatMap((g) => g.children.map((c) => c.id)),
    // Also include related child views / redirects triggered from Loyalty views
    'point-catalog-admin',
    'point-catalog-admin-list',
    'point-catalog-admin-new',
    // Lucky draw sub-views
    'lucky-draw-detail',
])

/** Check if a given view ID belongs to the Loyalty module */
export function isLoyaltyViewId(viewId: string): boolean {
    return _allLoyaltyViewIds.has(viewId)
}

/**
 * Admin URL paths for Loyalty subviews under /loyalty/...
 * point-catalog* stay on /engagement/catalog (existing redirect in DashboardContent).
 */
export const loyaltyViewToPath: Record<string, string> = {
    'lucky-draw': 'lucky-draw',
    'scratch-card-game': 'games',
    'redeem-gift-management': 'redeem',
}

export const loyaltyPathToView: Record<string, string> = Object.fromEntries(
    Object.entries(loyaltyViewToPath).map(([view, path]) => [path, view])
)

export function loyaltyHrefForView(viewId: string): string | null {
    if (viewId === 'loyalty' || viewId === 'consumer-engagement') return '/loyalty'
    if (viewId === 'point-catalog' || viewId === 'point-catalog-admin' || viewId === 'point-catalog-admin-list') {
        return '/engagement/catalog'
    }
    if (viewId === 'point-catalog-admin-new') return '/engagement/catalog/admin/new'
    const path = loyaltyViewToPath[viewId]
    return path ? `/loyalty/${path}` : null
}

export function resolveLoyaltySlug(slug: string[]): string {
    const path = slug.join('/')
    return loyaltyPathToView[path] || loyaltyPathToView[slug[0] || ''] || 'loyalty'
}

/** Find which group a given view id belongs to */
export function findLoyaltyGroupForView(viewId: string): LoyaltyNavGroup | undefined {
    return loyaltyNavGroups.find(
        (g) => g.id === viewId || g.children.some((c) => c.id === viewId)
    )
}

/** Build breadcrumb segments from a view id, e.g. ['Loyalty', 'Rewards & Games', 'Lucky Draw'] */
export function getLoyaltyBreadcrumb(viewId: string): { label: string; href?: string }[] {
    const crumbs: { label: string; href?: string }[] = [{ label: 'Customer & Growth', href: 'customer-growth' }, { label: 'Loyalty', href: 'loyalty' }]
    const group = findLoyaltyGroupForView(viewId)
    if (group) {
        crumbs.push({ label: group.label })
        const child = group.children.find((c) => c.id === viewId)
        if (child) {
            crumbs.push({ label: child.label, href: child.id })
        }
    }
    return crumbs
}
