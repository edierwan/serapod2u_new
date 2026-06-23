'use client'

import PetFoodMobileExperience from './PetFoodMobileExperience'

interface ProductInfo {
    product_name?: string
    variant_name?: string
    brand_name?: string
}

interface Props {
    config: any
    qrCode: string
    orgId?: string
    productInfo?: ProductInfo
}

/**
 * Journey adapter for the Pet Food experience.
 *
 * Connects the Ellbow shell to the Journey product-QR business logic by passing
 * the live journey config + scanned QR code. The underlying engine resolves
 * journey eligibility, authentication, points and rewards through the existing
 * Journey APIs (/api/consumer/*). No RoadTour APIs are involved here.
 */
export default function JourneyPetFoodExperience({ config, qrCode, orgId, productInfo }: Props) {
    return (
        <PetFoodMobileExperience
            config={config}
            qrCode={qrCode}
            orgId={orgId}
            isLive={true}
            productInfo={productInfo}
        />
    )
}
