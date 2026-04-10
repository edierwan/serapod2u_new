'use client'

import PremiumLoyaltyTemplate from '@/components/journey/templates/PremiumLoyaltyTemplate'

interface RoadtourContext {
    token: string
    campaign_name: string
    account_manager_name: string
    default_points: number
    org_id: string
}

interface Props {
    roadtourContext: RoadtourContext
    orgId: string
}

/**
 * Thin client wrapper that renders the same PremiumLoyaltyTemplate used by
 * the product QR flow, but with a roadtourContext prop that switches the
 * title, collect button label, and claim API to RoadTour-specific behavior.
 *
 * The JourneyConfig is minimal — only points_enabled is turned on.
 * All other features (lucky draw, scratch card, etc.) are disabled.
 */
export default function RoadtourJourneyWrapper({ roadtourContext, orgId }: Props) {
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

    return (
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
}
