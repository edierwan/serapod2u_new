export type RoadtourExperienceKey = 'vape' | 'electronic' | 'outdoor' | 'pet_food'

export interface RoadtourProductCategory {
    id: string
    category_code: string
    category_name: string
    image_url?: string | null
    is_active: boolean | null
    is_vape?: boolean | null
}

export interface RoadtourExperience {
    key: RoadtourExperienceKey
    label: string
    active: boolean
}

export const ROADTOUR_EXPERIENCE_REGISTRY: Readonly<Record<RoadtourExperienceKey, RoadtourExperience>> = {
    vape: { key: 'vape', label: 'Vape', active: true },
    electronic: { key: 'electronic', label: 'Electronic', active: false },
    outdoor: { key: 'outdoor', label: 'Outdoor', active: false },
    pet_food: { key: 'pet_food', label: 'Pet Food', active: true },
}

/**
 * Mobile presentation template selected by an experience.
 * The Pet Food experience renders the Ellbow Pet Food interface; every other
 * experience (including the Vape default and any unmapped/legacy category)
 * renders the existing PremiumTemplate.
 */
export type TemplateKey = 'premium' | 'pet_food'

export function experienceToTemplateKey(experience: RoadtourExperience | null | undefined): TemplateKey {
    return experience?.key === 'pet_food' ? 'pet_food' : 'premium'
}

const normalize = (value?: string | null) => (value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')

export function getRoadtourExperienceForCategory(
    category?: Pick<RoadtourProductCategory, 'category_code' | 'category_name' | 'is_vape'> | null,
): RoadtourExperience | null {
    if (!category) return null
    if (category.is_vape === true) return ROADTOUR_EXPERIENCE_REGISTRY.vape

    const values = [normalize(category.category_code), normalize(category.category_name)]
    if (values.some((value) => value === 'vape' || value.includes('vape'))) return ROADTOUR_EXPERIENCE_REGISTRY.vape
    if (values.some((value) => value === 'electronic' || value === 'electronics')) return ROADTOUR_EXPERIENCE_REGISTRY.electronic
    if (values.some((value) => value === 'outdoor' || value === 'outdoors')) return ROADTOUR_EXPERIENCE_REGISTRY.outdoor
    if (values.some((value) => value === 'petfood')) return ROADTOUR_EXPERIENCE_REGISTRY.pet_food
    return null
}

export function isRoadtourCategorySelectable(category: RoadtourProductCategory) {
    const experience = getRoadtourExperienceForCategory(category)
    return category.is_active === true && experience?.active === true
}

/** Missing, inactive, and unmapped categories deliberately retain the existing Vape UI. */
export function resolveRoadtourExperience(category?: RoadtourProductCategory | null): RoadtourExperience {
    const experience = getRoadtourExperienceForCategory(category)
    if (!category || category.is_active !== true || !experience?.active) {
        return ROADTOUR_EXPERIENCE_REGISTRY.vape
    }
    return experience
}

/**
 * Resolve the mobile template a Product Category maps to. Shared by the Journey
 * product-QR flow and the RoadTour flow so there is a single source of truth.
 * Unknown / inactive / unmapped categories deliberately fall back to 'premium'.
 */
export function resolveCategoryTemplateKey(category?: RoadtourProductCategory | null): TemplateKey {
    return experienceToTemplateKey(resolveRoadtourExperience(category))
}
