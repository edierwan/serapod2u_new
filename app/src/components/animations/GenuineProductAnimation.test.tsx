// @vitest-environment jsdom

import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { GenuineProductAnimation } from './GenuineProductAnimation'

// canvas-confetti needs a real canvas; mock it so the celebration is a no-op in tests.
const confettiMock = vi.hoisted(() => {
  const fn: any = vi.fn()
  fn.shapeFromText = vi.fn(() => ({}))
  return fn
})
vi.mock('canvas-confetti', () => ({ default: confettiMock }))

// next/image -> plain img in jsdom.
vi.mock('next/image', () => ({
  default: (props: any) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />
  },
}))

const productInfo = {
  product_name: 'Test Campaign For Ellbow',
  variant_name: 'Account Manager: Edi',
  brand_name: 'RoadTour',
}

describe('GenuineProductAnimation (Ellbow success popup)', () => {
  beforeEach(() => confettiMock.mockClear())
  afterEach(() => cleanup())

  it('renders the Ellbow themed success content', () => {
    render(
      <GenuineProductAnimation
        isVisible
        ellbow
        productInfo={productInfo}
        title="Thanks Bestari Pet Shop for Joining RoadTour!"
        subtitle="We appreciate your participation and support."
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('Thanks Bestari Pet Shop for Joining RoadTour!')).toBeTruthy()
    expect(screen.getByText('Test Campaign For Ellbow')).toBeTruthy()
    expect(screen.getByText('Account Manager: Edi')).toBeTruthy()
    expect(screen.getByText('by RoadTour')).toBeTruthy()
    expect(screen.getByText('Tap anywhere to continue')).toBeTruthy()
    // Reuses existing Ellbow asset pack (mascot + verified shield).
    const imgs = document.querySelectorAll('img')
    const srcs = Array.from(imgs).map((i) => i.getAttribute('src') || '')
    expect(srcs.some((s) => s.includes('ellbow-mobile-ready-assets'))).toBe(true)
    expect(srcs.some((s) => s.includes('04-ellbow-verified-shield-cat'))).toBe(true)
    // Celebration fired (confetti reused, not a new dependency).
    expect(confettiMock).toHaveBeenCalled()
  })

  it('closes when the overlay is tapped (behaviour preserved)', () => {
    const onClose = vi.fn()
    const { container } = render(
      <GenuineProductAnimation isVisible ellbow productInfo={productInfo} title="Thanks!" onClose={onClose} />,
    )
    fireEvent.click(container.firstChild as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when the card itself is tapped', () => {
    const onClose = vi.fn()
    render(<GenuineProductAnimation isVisible ellbow productInfo={productInfo} title="Thanks!" onClose={onClose} />)
    fireEvent.click(screen.getByText('Test Campaign For Ellbow'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the legacy green (non-ellbow) popup working', () => {
    render(<GenuineProductAnimation isVisible productInfo={productInfo} onClose={() => {}} />)
    expect(screen.getByText('✓ Genuine Product')).toBeTruthy()
    // legacy path does not pull the Ellbow asset pack
    const srcs = Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('src') || '')
    expect(srcs.some((s) => s.includes('ellbow-mobile-ready-assets'))).toBe(false)
  })
})
