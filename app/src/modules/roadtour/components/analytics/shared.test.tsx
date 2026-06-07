// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BarChart3 } from 'lucide-react'

import { KpiCard } from './shared'

describe('KpiCard', () => {
    it('renders a non-interactive KPI card without throwing', () => {
        render(<KpiCard label="Visited Shops" value="24" icon={BarChart3} accent="blue" />)

        expect(screen.getByText('Visited Shops')).toBeTruthy()
        expect(screen.getByText('24')).toBeTruthy()
    })

    it('renders an interactive KPI card and calls onClick', async () => {
        const user = userEvent.setup()
        const onClick = vi.fn()

        render(
            <KpiCard
                label="Improved Shops"
                value="8"
                icon={BarChart3}
                accent="green"
                onClick={onClick}
            />
        )

        await user.click(screen.getByRole('button', { name: /improved shops/i }))

        expect(onClick).toHaveBeenCalledTimes(1)
    })
})