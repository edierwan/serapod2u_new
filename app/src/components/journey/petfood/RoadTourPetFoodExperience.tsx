'use client'

import PetFoodMobileExperience from './PetFoodMobileExperience'

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
}

/**
 * RoadTour adapter for the Pet Food experience.
 *
 * Mirrors the existing RoadtourJourneyWrapper's Vape path exactly, but renders
 * the Ellbow shell. The roadtourContext prop switches the engine to the
 * RoadTour claim API (/api/roadtour/claim-reward) and RoadTour participant /
 * enrollment / duplicate-protection / milestone logic. Only points are enabled,
 * matching the Vape RoadTour behavior. No Journey-only APIs are involved.
 */
export default function RoadTourPetFoodExperience({ roadtourContext, orgId }: Props) {
    const config = {
        welcome_title: roadtourContext.campaign_name,
        welcome_message: `Claim your bonus points from ${roadtourContext.account_manager_name}`,
        thank_you_message: 'Thank you for participating in our RoadTour campaign!',
        primary_color: '#0D9488',
        button_color: '#DB2777',
        points_enabled: true,
        lucky_draw_enabled: false,
        redemption_enabled: false,
        require_security_code: false,
    }

    return (
        <PetFoodMobileExperience
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
}
