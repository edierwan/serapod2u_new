'use client'

import EllbowHomePreview from './EllbowHomePreview'

interface Props {
    config: any
}

/**
 * Journey Builder preview adapter for the Pet Food experience.
 *
 * Renders the presentation-only Ellbow Home screen. It owns no claim state and
 * never calls live scan or points endpoints, so it is safe for admin preview.
 */
export default function PreviewPetFoodExperience({ config }: Props) {
    return <EllbowHomePreview config={config} />
}
