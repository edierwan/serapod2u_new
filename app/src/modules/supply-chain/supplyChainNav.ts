/**
 * Supply Chain Module Navigation Configuration
 *
 * Single source of truth for Supply Chain navigation.
 * Mirrors the pattern used by Finance (src/modules/finance/financeNav.ts).
 *
 * This module groups existing Supply Chain features (Products, Order Management,
 * QR Tracking, Inventory, Quality & Returns) under a unified landing page.
 * All child routes are existing views — no new business logic.
 *
 * Access control: Each group and child can declare an `access` rule.
 * Components use `filterSupplyChainNavForUser()` to strip items
 * the current org-type / role-level should not see.
 */

import {
    Package,
    FileText,
    QrCode,
    Warehouse,
    ShieldCheck,
    ShoppingCart,
    Store,
    Factory,
    Truck,
    Plus,
    ListTree,
    Settings as SettingsIcon,
    Building2,
    type LucideIcon,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────

export interface SCAccessRule {
    /** Organisation types that see this item (empty / omitted = all) */
    allowedOrgTypes?: string[]
    /** Maximum role_level that may see this item (lower = more privileged) */
    maxRoleLevel?: number
}

export interface SupplyChainNavChild {
    /** View id – maps to currentView in DashboardContent */
    id: string
    label: string
    icon: LucideIcon
    /** If true, this item is marked as legacy (still accessible) */
    legacy?: boolean
    /** Optional access restriction */
    access?: SCAccessRule
}

export interface SupplyChainNavGroup {
    /** Group key, e.g. 'sc-products' */
    id: string
    label: string
    icon: LucideIcon
    description: string
    children: SupplyChainNavChild[]
    /** Optional access restriction that hides the entire group */
    access?: SCAccessRule
}

// ── Navigation tree ──────────────────────────────────────────────
// Each child.id maps to an existing view in DashboardContent's renderCurrentView().

export const supplyChainNavGroups: SupplyChainNavGroup[] = [
    {
        id: 'sc-organizations',
        label: 'Organizations',
        icon: Building2,
        description: 'Manage supply chain partner organizations, distributors, and warehouses.',
        access: { allowedOrgTypes: ['HQ'], maxRoleLevel: 30 },
        children: [
            { id: 'organizations', label: 'Organizations', icon: Building2 },
            { id: 'add-organization', label: 'Add Organization', icon: Plus, access: { allowedOrgTypes: ['HQ'], maxRoleLevel: 20 } },
        ],
    },
    {
        id: 'sc-products',
        label: 'Products',
        icon: Package,
        description: 'Maintain product catalog and master data used across ordering and QR tracking.',
        children: [
            { id: 'products', label: 'Product List', icon: Package },
            { id: 'product-management', label: 'Master Data', icon: Package, access: { allowedOrgTypes: ['HQ'] } },
        ],
    },
    {
        id: 'sc-orders',
        label: 'Order Management',
        icon: FileText,
        description: 'Create and track orders by channel: HQ, Distributor, and Shop.',
        children: [
            { id: 'orders', label: 'Orders', icon: FileText },
            { id: 'distributor-order', label: 'Distributor Order', icon: ShoppingCart, access: { allowedOrgTypes: ['HQ', 'DIST'] } },
            { id: 'shop-order', label: 'Shop Order', icon: Store, access: { allowedOrgTypes: ['HQ', 'SHOP'] } },
        ],
    },
    {
        id: 'sc-qr',
        label: 'QR Tracking',
        icon: QrCode,
        description: 'Trace cartons/cases through scan events, receiving, and shipping operations.',
        children: [
            { id: 'qr-batches', label: 'QR Batches', icon: QrCode },
            { id: 'manufacturer-scan-2', label: 'Manufacturer Scan', icon: Factory, access: { allowedOrgTypes: ['HQ', 'MFG'] } },
            { id: 'warehouse-receive-2', label: 'Warehouse Receive', icon: Warehouse, access: { allowedOrgTypes: ['HQ', 'DIST', 'WH'] } },
            { id: 'warehouse-ship-v2', label: 'Warehouse Ship', icon: Truck, access: { allowedOrgTypes: ['HQ', 'DIST', 'WH'] } },
        ],
    },
    {
        id: 'sc-inventory',
        label: 'Inventory',
        icon: Warehouse,
        description: 'Monitor stock on hand, adjustments, transfers, and movement reporting.',
        // Entire Inventory group is hidden for manufacturers
        access: { allowedOrgTypes: ['HQ', 'DIST', 'WH'] },
        children: [
            { id: 'inventory-list', label: 'View Inventory', icon: Package },
            { id: 'add-stock', label: 'Add Stock', icon: Plus },
            { id: 'stock-adjustment', label: 'Stock Adjustment', icon: SettingsIcon },
            { id: 'stock-transfer', label: 'Stock Transfer', icon: Truck },
            { id: 'stock-movements', label: 'Movement Reports', icon: ListTree },
        ],
    },
    {
        id: 'sc-quality',
        label: 'Quality & Returns',
        icon: ShieldCheck,
        description: 'Manage product return cases, quality adjustments, and manufacturer acknowledgements.',
        children: [
            { id: 'manufacturer-quality-issues', label: 'Product Return', icon: ShieldCheck },
        ],
    },
]

// ── Access filtering ─────────────────────────────────────────────

function matchesAccess(access: SCAccessRule | undefined, orgType?: string, roleLevel?: number): boolean {
    if (!access) return true
    if (access.allowedOrgTypes && access.allowedOrgTypes.length > 0) {
        if (!orgType || !access.allowedOrgTypes.includes(orgType)) return false
    }
    if (access.maxRoleLevel !== undefined && roleLevel !== undefined) {
        if (roleLevel > access.maxRoleLevel) return false
    }
    return true
}

/**
 * Return a filtered copy of supplyChainNavGroups where groups / children
 * that the current user is not allowed to see are removed.
 */
export function filterSupplyChainNavForUser(
    orgType?: string,
    roleLevel?: number,
): SupplyChainNavGroup[] {
    return supplyChainNavGroups
        .filter((g) => matchesAccess(g.access, orgType, roleLevel))
        .map((g) => ({
            ...g,
            children: g.children.filter((c) => matchesAccess(c.access, orgType, roleLevel)),
        }))
        .filter((g) => g.children.length > 0)
}

// ── Flat list helpers ────────────────────────────────────────────

/** All leaf-level nav items (for search, quick links, etc.) */
export function getAllSupplyChainNavItems(): SupplyChainNavChild[] {
    return supplyChainNavGroups.flatMap((g) => g.children)
}

/** Set of all Supply Chain child view IDs (for detecting if a view belongs to SC) */
const _allSupplyChainViewIds = new Set<string>([
    'supply-chain',
    ...supplyChainNavGroups.flatMap((g) => g.children.map((c) => c.id)),
    // Also include related child views not in the nav but triggered from SC views
    'view-product', 'edit-product', 'add-product',
    'create-order', 'view-order', 'track-order',
    'manufacturer-scan-2',
    'inventory', 'inventory-settings',
    // Organization views (moved from sidebar to Supply Chain)
    'organizations', 'add-organization', 'edit-organization', 'edit-organization-hq', 'view-organization',
])

/** Check if a given view ID belongs to the Supply Chain module */
export function isSupplyChainViewId(viewId: string): boolean {
    return _allSupplyChainViewIds.has(viewId)
}

/** Find which group a given view id belongs to */
export function findSupplyChainGroupForView(viewId: string): SupplyChainNavGroup | undefined {
    return supplyChainNavGroups.find(
        (g) => g.id === viewId || g.children.some((c) => c.id === viewId)
    )
}

/** Build breadcrumb segments from a view id, e.g. ['Supply Chain', 'Products', 'Product List'] */
export function getSupplyChainBreadcrumb(viewId: string): { label: string; href?: string }[] {
    const crumbs: { label: string; href?: string }[] = [{ label: 'Supply Chain', href: 'supply-chain' }]
    const group = findSupplyChainGroupForView(viewId)
    if (group) {
        crumbs.push({ label: group.label })
        const child = group.children.find((c) => c.id === viewId)
        if (child) {
            crumbs.push({ label: child.label, href: child.id })
        }
    }
    return crumbs
}
