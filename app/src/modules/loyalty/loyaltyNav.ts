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
    Scan,
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
            { id: 'consumer-activations', label: 'Customer Activation', icon: Scan },
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
