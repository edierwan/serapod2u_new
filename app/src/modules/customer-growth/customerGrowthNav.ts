/**
 * Customer & Growth Module Navigation Configuration
 *
 * Single source of truth for Customer & Growth domain navigation.
 * This is a domain grouping that contains CRM, Marketing, Loyalty, and Product Catalog modules.
 *
 * Each child module retains its own route and top-nav bar.
 * This config is used for the domain landing page and sidebar navigation.
 */

import {
    Inbox,
    MessageSquare,
    Gift,
    ShoppingCart,
    UsersRound,
    Scan,
    HeadphonesIcon,
    BookOpen,
    Megaphone,
    Trophy,
    Gamepad2,
    Store,
    ImageIcon,
    ShoppingBag,
    CreditCard,
    LogIn,
    type LucideIcon,
} from 'lucide-react'
import { isCrmViewId } from '@/modules/crm/crmNav'
import { isMarketingViewId } from '@/modules/marketing/marketingNav'
import { isLoyaltyViewId } from '@/modules/loyalty/loyaltyNav'
import { isCatalogViewId } from '@/modules/catalog/catalogNav'

// ── Types ────────────────────────────────────────────────────────

export interface CustomerGrowthNavChild {
    /** Module id – maps to sidebar id */
    id: string
    label: string
    icon: LucideIcon
    /** The route this module navigates to */
    route: string
    description: string
    /** Resolved href for navigation (same as route, used by top nav dropdown) */
    href?: string
}

export interface CustomerGrowthNavGroup {
    id: string
    label: string
    icon: LucideIcon
    description: string
    children: CustomerGrowthNavChild[]
}

// ── Navigation tree ──────────────────────────────────────────────

export const customerGrowthModules: CustomerGrowthNavChild[] = [
    {
        id: 'crm',
        label: 'CRM',
        icon: Inbox,
        route: '/crm',
        description: 'Customer activity, consumer activations, and support conversations.',
    },
    {
        id: 'mktg',
        label: 'Marketing',
        icon: MessageSquare,
        route: '/marketing',
        description: 'Campaigns, journey builder, and outbound WhatsApp messaging.',
    },
    {
        id: 'loyalty',
        label: 'Loyalty',
        icon: Gift,
        route: '/loyalty',
        description: 'Points catalog, lucky draws, scratch cards, and gift redemptions.',
    },
    {
        id: 'catalog',
        label: 'Product Catalog',
        icon: ShoppingCart,
        route: '/catalog',
        description: 'Consumer-facing product catalog with pricing and variants.',
    },
    {
        id: 'ecommerce',
        label: 'E-commerce',
        icon: Store,
        route: '/ecommerce',
        description: 'Online store management, hero banners, and storefront settings.',
    },
]

// Group the modules into card groups for the landing page AND top nav dropdowns
export const customerGrowthNavGroups: CustomerGrowthNavGroup[] = [
    {
        id: 'cg-crm',
        label: 'CRM',
        icon: HeadphonesIcon,
        description: 'Handle customer conversations and track consumer engagement activity.',
        children: [
            { id: 'consumer-activations', label: 'Customer Activity', icon: Scan, route: '/crm', description: 'Track consumer scans and engagement', href: '/crm' },
            { id: 'support-inbox', label: 'Support Inbox', icon: Inbox, route: '/crm', description: 'Manage customer support conversations', href: '/crm' },
        ],
    },
    {
        id: 'cg-marketing',
        label: 'Marketing',
        icon: Megaphone,
        description: 'Build automated consumer journeys and send targeted WhatsApp broadcasts.',
        children: [
            { id: 'journey-builder', label: 'Journey Builder', icon: BookOpen, route: '/marketing', description: 'Automated consumer journeys', href: '/marketing' },
            { id: 'marketing', label: 'WhatsApp Broadcast', icon: MessageSquare, route: '/marketing', description: 'Outbound WhatsApp messaging', href: '/marketing' },
        ],
    },
    {
        id: 'cg-loyalty',
        label: 'Loyalty',
        icon: Trophy,
        description: 'Manage loyalty point rewards, lucky draw events, interactive games, and gift redemptions.',
        children: [
            { id: 'point-catalog', label: 'Point Catalog', icon: Gift, route: '/loyalty', description: 'Points-based reward catalog', href: '/loyalty' },
            { id: 'lucky-draw', label: 'Lucky Draw', icon: Trophy, route: '/loyalty', description: 'Lucky draw events', href: '/loyalty' },
            { id: 'scratch-card-game', label: 'Games', icon: Gamepad2, route: '/loyalty', description: 'Interactive scratch card games', href: '/loyalty' },
            { id: 'redeem-gift-management', label: 'Redeem', icon: Gift, route: '/loyalty', description: 'Gift redemption management', href: '/loyalty' },
        ],
    },
    {
        id: 'cg-catalog',
        label: 'Product Catalog',
        icon: ShoppingCart,
        description: 'Browse and manage consumer-facing product catalog with pricing and variants.',
        children: [
            { id: 'product-catalog', label: 'Product Catalog', icon: ShoppingCart, route: '/catalog', description: 'Browse and manage product catalog', href: '/catalog' },
        ],
    },
    {
        id: 'cg-ecommerce',
        label: 'E-commerce',
        icon: Store,
        description: 'Manage your online storefront — hero banners, promotions, and store settings.',
        children: [
            { id: 'hero-banners', label: 'Hero Banners', icon: ImageIcon, route: '/ecommerce', description: 'Manage storefront and login hero banners', href: '/ecommerce' },
            { id: 'store-orders', label: 'Store Orders', icon: ShoppingBag, route: '/ecommerce', description: 'View and manage online store orders', href: '/ecommerce' },
            { id: 'ecommerce/payment-gateway', label: 'Payment Gateway', icon: CreditCard, route: '/ecommerce', description: 'Configure payment providers for checkout', href: '/ecommerce' },
        ],
    },
]

// ── Helpers ────────────────────────────────────────────────────

/** E-commerce view IDs */
const ecommerceViewIds = new Set(['ecommerce', 'hero-banners', 'store-banner-manager', 'login-hero-banner', 'store-orders', 'ecommerce/payment-gateway'])
export function isEcommerceViewId(viewId: string): boolean {
    return ecommerceViewIds.has(viewId)
}

/** Check if a given view ID belongs to the Customer & Growth domain.
 *  Delegates to each child module's detector so sub-views (e.g. 'support-inbox') are also captured. */
export function isCustomerGrowthViewId(viewId: string): boolean {
    return viewId === 'customer-growth' ||
        isCrmViewId(viewId) ||
        isMarketingViewId(viewId) ||
        isLoyaltyViewId(viewId) ||
        isCatalogViewId(viewId) ||
        isEcommerceViewId(viewId)
}

/** Determine which child module a view belongs to (returns module id, or null) */
export function getActiveCustomerGrowthModule(viewId: string): string | null {
    if (isCrmViewId(viewId)) return 'crm'
    if (isMarketingViewId(viewId)) return 'mktg'
    if (isLoyaltyViewId(viewId)) return 'loyalty'
    if (isCatalogViewId(viewId)) return 'catalog'
    if (isEcommerceViewId(viewId)) return 'ecommerce'
    return null
}

/** Determine which nav group a view belongs to (returns group id, or null) */
export function getActiveCustomerGrowthGroup(viewId: string): string | null {
    if (isCrmViewId(viewId)) return 'cg-crm'
    if (isMarketingViewId(viewId)) return 'cg-marketing'
    if (isLoyaltyViewId(viewId)) return 'cg-loyalty'
    if (isCatalogViewId(viewId)) return 'cg-catalog'
    if (isEcommerceViewId(viewId)) return 'cg-ecommerce'
    return null
}

/** Get all nav items flattened (used for search) */
export function getAllCustomerGrowthNavItems(): CustomerGrowthNavChild[] {
    return customerGrowthNavGroups.flatMap((g) => g.children)
}

/** Build breadcrumb segments for Customer & Growth */
export function getCustomerGrowthBreadcrumb(viewId: string): { label: string; href?: string }[] {
    const crumbs: { label: string; href?: string }[] = [{ label: 'Customer & Growth', href: 'customer-growth' }]
    const module = customerGrowthModules.find(m => m.id === viewId)
    if (module) {
        crumbs.push({ label: module.label, href: module.id })
    }
    return crumbs
}
