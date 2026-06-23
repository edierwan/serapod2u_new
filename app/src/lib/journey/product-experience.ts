/**
 * Centralized Product Category → mobile experience resolver.
 *
 * Single source of truth for deciding which mobile interface (PremiumTemplate
 * vs Ellbow Pet Food) a given order / product QR maps to. Category is always
 * derived from real database relationships — never from order numbers, product
 * names, codes, or anything supplied by the browser.
 *
 *   Order detection:   orders → order_items → products → product_categories
 *   Product QR detection: qr_codes.product_id → products.category_id → product_categories
 *
 * The category → templateKey mapping itself lives in the shared
 * `experience-registry` so Journey and RoadTour stay consistent.
 */

import {
    resolveCategoryTemplateKey,
    type RoadtourProductCategory,
    type TemplateKey,
} from '@/lib/roadtour/experience-registry'

export type { TemplateKey } from '@/lib/roadtour/experience-registry'

const CATEGORY_COLUMNS = 'id, category_code, category_name, image_url, is_active, is_vape'

const EXPERIENCE_LABELS: Record<TemplateKey, string> = {
    premium: 'Premium Template',
    pet_food: 'Ellbow Pet Food Experience',
}

export interface ResolvedCategoryExperience {
    categoryId: string | null
    categoryCode: string | null
    categoryName: string | null
    templateKey: TemplateKey
    /** Human readable interface name, e.g. "Ellbow Pet Food Experience". */
    experienceLabel: string
}

export interface OrderExperienceResolution {
    /** Distinct categories across all order items (deduped by category id). */
    categories: ResolvedCategoryExperience[]
    /**
     * The template stored on the Journey. When the order is single-category this
     * is that category's template; for a mixed-category order it is the first
     * detected category (each QR still resolves its own template at scan time).
     */
    templateKey: TemplateKey
    /** True when the order spans more than one product category. */
    mixed: boolean
    /** False when the order has no resolvable category (treated as premium). */
    resolved: boolean
}

type SupabaseLikeClient = { from: (table: string) => any }

function toResolvedCategory(category: RoadtourProductCategory | null): ResolvedCategoryExperience {
    const templateKey = resolveCategoryTemplateKey(category)
    return {
        categoryId: category?.id ?? null,
        categoryCode: category?.category_code ?? null,
        categoryName: category?.category_name ?? null,
        templateKey,
        experienceLabel: EXPERIENCE_LABELS[templateKey],
    }
}

/** Map a single Product Category row to its experience. Pure / no IO. */
export function resolveProductCategoryExperience(
    category: RoadtourProductCategory | null | undefined,
): ResolvedCategoryExperience {
    return toResolvedCategory(category ?? null)
}

/**
 * Resolve every distinct Product Category referenced by an order's items.
 * Uses the trusted server FK path; the caller supplies a Supabase client whose
 * row-level access already scopes the order to the requesting user.
 */
export async function resolveOrderProductCategories(
    supabase: SupabaseLikeClient,
    orderId: string,
): Promise<OrderExperienceResolution> {
    const { data, error } = await supabase
        .from('order_items')
        .select(`product_id, products!inner ( category_id, product_categories!inner ( ${CATEGORY_COLUMNS} ) )`)
        .eq('order_id', orderId)

    if (error || !Array.isArray(data) || data.length === 0) {
        const fallback = toResolvedCategory(null)
        return { categories: [fallback], templateKey: 'premium', mixed: false, resolved: false }
    }

    const byId = new Map<string, ResolvedCategoryExperience>()
    for (const row of data) {
        const product = Array.isArray((row as any).products) ? (row as any).products[0] : (row as any).products
        const rawCategory = Array.isArray(product?.product_categories)
            ? product.product_categories[0]
            : product?.product_categories
        const resolved = toResolvedCategory((rawCategory as RoadtourProductCategory) ?? null)
        const key = resolved.categoryId ?? '__null__'
        if (!byId.has(key)) byId.set(key, resolved)
    }

    const categories = Array.from(byId.values())
    const mixed = categories.length > 1
    const templateKey = categories[0]?.templateKey ?? 'premium'
    const resolved = categories.some((category) => category.categoryId !== null)

    return { categories, templateKey, mixed, resolved }
}
