// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LoyaltyProgramSelector } from './LoyaltyProgramSelector'

describe('LoyaltyProgramSelector', () => {
  afterEach(cleanup)

  it('keeps the legacy Cellera route as the default and links Ellbow by query parameter', () => {
    render(<LoyaltyProgramSelector program="cellera" />)
    expect(screen.getByText('Program: Cellera Loyalty')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Cellera Loyalty' }).getAttribute('href')).toBe('/engagement/catalog/admin')
    expect(screen.getByRole('link', { name: 'Ellbow Loyalty' }).getAttribute('href')).toBe('/engagement/catalog/admin?program=ellbow')
  })

  it('exposes the isolated Ellbow shop route without changing the Cellera default', () => {
    render(<LoyaltyProgramSelector program="cellera" shopView />)
    expect(screen.getByRole('link', { name: 'Cellera Loyalty' }).getAttribute('href')).toBe('/engagement/catalog')
    expect(screen.getByRole('link', { name: 'Ellbow Loyalty' }).getAttribute('href')).toBe('/engagement/catalog?program=ellbow')
  })
})
