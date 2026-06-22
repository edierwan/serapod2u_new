'use client'

import PremiumLoyaltyTemplate from '@/components/journey/templates/PremiumLoyaltyTemplate'
import RoadTourPetFoodExperience from '@/components/journey/petfood/RoadTourPetFoodExperience'
import type { RoadtourExperience } from '@/lib/roadtour/experience-registry'

interface RoadtourContext {
    token: string
    campaign_name: string
    account_manager_name: string
    default_points: number
    org_id: string
    qr_code_id?: string | null
    campaign_id?: string | null
    account_manager_user_id?: string | null
    reward_mode?: string | null
    survey_template_id?: string | null
    require_geolocation?: boolean
}

interface Props {
    roadtourContext: RoadtourContext
    orgId: string
    experience: RoadtourExperience
}

/**
 * Thin client wrapper that renders the same PremiumLoyaltyTemplate used by
 * the product QR flow, but with a roadtourContext prop that switches the
 * title, collect button label, and claim API to RoadTour-specific behavior.
 *
 * The JourneyConfig is minimal — only points_enabled is turned on.
 * All other features (lucky draw, scratch card, etc.) are disabled.
 */
export default function RoadtourJourneyWrapper({ roadtourContext, orgId, experience }: Props) {
    const config = {
        welcome_title: roadtourContext.campaign_name,
        welcome_message: `Claim your bonus points from ${roadtourContext.account_manager_name}`,
        thank_you_message: 'Thank you for participating in our RoadTour campaign!',
        primary_color: '#e97b2d',
        button_color: '#e97b2d',
        points_enabled: true,
        lucky_draw_enabled: false,
        redemption_enabled: false,
        require_security_code: false,
    }

    // Pet Food RoadTour Events render the Ellbow interface, reusing the exact
    // same RoadTour claim/enrollment/duplicate-protection machinery via the
    // roadtourContext prop (no RoadTour business logic is forked or duplicated).
    if (experience.key === 'pet_food') {
        return <RoadTourPetFoodExperience roadtourContext={roadtourContext} orgId={orgId} />
    }

    // Vape (and every legacy / unmapped category that falls back to Vape)
    // intentionally reuses the established RoadTour mobile journey unchanged.
    if (experience.key === 'vape') return (
        <PremiumLoyaltyTemplate
            config={config}
            qrCode={roadtourContext.token}
            orgId={orgId}
            isLive={true}
            productInfo={{
                product_name: roadtourContext.campaign_name,
                variant_name: `Account Manager: ${roadtourContext.account_manager_name}`,
                brand_name: 'RoadTour',
            }}
            roadtourContext={roadtourContext}
        />
    )

    return null
}
