'use client'

import PremiumLoyaltyTemplate from '@/components/journey/templates/PremiumLoyaltyTemplate'

/**
 * Ellbow Pet Food brand palette. Teal hero + pink accents per the reference.
 * Applied on top of the existing loyalty machinery so the Pet Food interface
 * is visually distinct while the claim / points / rewards logic is identical.
 */
export const ELLBOW_PET_FOOD_THEME = {
    primary_color: '#0D9488', // teal-600
    button_color: '#DB2777', // pink-600
} as const

interface ProductInfo {
    product_name?: string
    variant_name?: string
    brand_name?: string
}

export interface PetFoodMobileExperienceProps {
    config: any
    qrCode?: string
    orgId?: string
    isLive?: boolean
    productInfo?: ProductInfo
    roadtourContext?: any
}

/**
 * Shared Ellbow Pet Food presentation shell.
 *
 * This is the single visual surface reused by the Journey product-QR flow, the
 * RoadTour flow, and the Journey Builder preview. It renders the existing
 * PremiumLoyaltyTemplate engine with the Ellbow brand skin (`experienceTheme`)
 * and the teal/pink palette, so all authentication, scan, points, reward and
 * duplicate-protection behavior is delegated to the proven machinery and is
 * never duplicated here. Mode-specific wiring (Journey vs RoadTour vs Preview)
 * is supplied by the adapters that render this component.
 */
export default function PetFoodMobileExperience({
    config,
    qrCode,
    orgId,
    isLive = false,
    productInfo,
    roadtourContext,
}: PetFoodMobileExperienceProps) {
    const themedConfig = {
        ...config,
        primary_color: ELLBOW_PET_FOOD_THEME.primary_color,
        button_color: ELLBOW_PET_FOOD_THEME.button_color,
    }

    return (
        <PremiumLoyaltyTemplate
            config={themedConfig}
            qrCode={qrCode}
            orgId={orgId}
            isLive={isLive}
            productInfo={productInfo}
            roadtourContext={roadtourContext}
            experienceTheme="pet_food"
        />
    )
}
