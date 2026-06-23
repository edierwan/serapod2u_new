// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import BrandLogo from './BrandLogo'

describe('BrandLogo', () => {
  afterEach(cleanup)

  it('shows a clean placeholder when no logo is saved', () => {
    render(<BrandLogo name="Serapod Official" logoUrl={null} className="h-10 w-10" />)

    expect(screen.getByRole('img', { name: 'Serapod Official brand placeholder' }).tagName).toBe('DIV')
  })

  it('replaces a broken saved image with the placeholder', () => {
    render(<BrandLogo name="Cellera Hero" logoUrl="https://legacy.example/broken.png" className="h-10 w-10" />)

    fireEvent.error(screen.getByRole('img', { name: 'Cellera Hero logo' }))

    expect(screen.getByRole('img', { name: 'Cellera Hero logo' }).tagName).toBe('DIV')
  })

  it('attempts a newly saved logo after the previous source failed', () => {
    const view = render(
      <BrandLogo name="Ellbow" logoUrl="https://legacy.example/broken.png" className="h-10 w-10" />
    )
    fireEvent.error(screen.getByRole('img', { name: 'Ellbow logo' }))

    view.rerender(
      <BrandLogo name="Ellbow" logoUrl="https://legacy.example/new.png" className="h-10 w-10" />
    )

    expect(screen.getByRole('img', { name: 'Ellbow logo' }).tagName).toBe('IMG')
    expect(screen.getByRole('img', { name: 'Ellbow logo' }).getAttribute('src')).toBe(
      'https://legacy.example/new.png'
    )
  })
})
