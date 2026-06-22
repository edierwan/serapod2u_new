// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PreviewPetFoodExperience from './PreviewPetFoodExperience'

describe('PreviewPetFoodExperience', () => {
    it('renders the isolated Ellbow verification home preview', () => {
        render(<PreviewPetFoodExperience config={{ points_per_scan: 125 }} />)

        expect(screen.getByText('Genuine Product')).toBeTruthy()
        expect(screen.getByText('Verified!')).toBeTruthy()
        expect(screen.getByText('+125')).toBeTruthy()
        expect(screen.getByText('Daily Cat Treats')).toBeTruthy()
        expect(screen.getByText('Scan')).toBeTruthy()
    })
})
