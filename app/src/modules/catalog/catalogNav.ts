/**
 * Catalog Module Navigation Configuration
 *
 * Single source of truth for Catalog navigation.
 * Mirrors the pattern used by Supply Chain and Finance modules.
 *
 * Groups:
 *  - Product Catalog: consumer-facing product browsing
 */

import {
    ShoppingCart,
    type LucideIcon,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────

export interface CatalogNavChild {
    /** View id – maps to currentView in DashboardContent */
    id: string
    label: string
    icon: LucideIcon
}

export interface CatalogNavGroup {
    id: string
    label: string
    icon: LucideIcon
    description: string
    children: CatalogNavChild[]
}

// ── Navigation tree ──────────────────────────────────────────────

export const catalogNavGroups: CatalogNavGroup[] = [
    {
        id: 'cat-products',
        label: 'Product Catalog',
        icon: ShoppingCart,
        description: 'Browse and manage consumer-facing product catalog with pricing and variants.',
        children: [
            { id: 'product-catalog', label: 'Product Catalog', icon: ShoppingCart },
        ],
    },
]

// ── Flat list helpers ────────────────────────────────────────────

export function getAllCatalogNavItems(): CatalogNavChild[] {
    return catalogNavGroups.flatMap((g) => g.children)
}

const _allCatalogViewIds = new Set<string>([
    'catalog',
    ...catalogNavGroups.flatMap((g) => g.children.map((c) => c.id)),
])

export function isCatalogViewId(viewId: string): boolean {
    return _allCatalogViewIds.has(viewId)
}

export function findCatalogGroupForView(viewId: string): CatalogNavGroup | undefined {
    return catalogNavGroups.find(
        (g) => g.id === viewId || g.children.some((c) => c.id === viewId)
    )
}

export function getCatalogBreadcrumb(viewId: string): { label: string; href?: string }[] {
    const crumbs: { label: string; href?: string }[] = [{ label: 'Customer & Growth', href: 'customer-growth' }, { label: 'Product Catalog', href: 'catalog' }]
    const group = findCatalogGroupForView(viewId)
    if (group) {
        crumbs.push({ label: group.label })
        const child = group.children.find((c) => c.id === viewId)
        if (child) {
            crumbs.push({ label: child.label, href: child.id })
        }
    }
    return crumbs
}
