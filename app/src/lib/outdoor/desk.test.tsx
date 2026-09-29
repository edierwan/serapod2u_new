import { describe, expect, it } from 'vitest'
import {
  isOutdoorPackshot,
  isOutdoorStaffPage,
  mainAppHref,
  outdoorDeskProductStatus,
  outdoorProductEditHref,
  outdoorProductPreviewHref,
} from './desk'

describe('Outdoor desk product status', () => {
  it('hides unpriced products whatever the stock', () => {
    expect(outdoorDeskProductStatus({ priced: false, stock: 10 })).toBe('hidden_no_price')
    expect(outdoorDeskProductStatus({ priced: false, stock: 0 })).toBe('hidden_no_price')
  })

  it('is sold out at zero stock, and live otherwise', () => {
    expect(outdoorDeskProductStatus({ priced: true, stock: 0 })).toBe('sold_out')
    expect(outdoorDeskProductStatus({ priced: true, stock: 3 })).toBe('live')
  })

  it('falls back to the shop sold-out flag when stock cannot be read', () => {
    expect(outdoorDeskProductStatus({ priced: true, stock: null, soldOut: true })).toBe('sold_out')
    expect(outdoorDeskProductStatus({ priced: true, stock: null, soldOut: false })).toBe('live')
  })
})

describe('Outdoor desk links', () => {
  it('previews in the Outdoor shop and edits in the main admin, never the main store', () => {
    expect(outdoorProductPreviewHref('p1')).toBe('/outdoor/shop/p1')
    expect(outdoorProductEditHref('p1')).toBe('/supply-chain/products/p1/edit')
    expect(outdoorProductPreviewHref('p1')).not.toContain('/store/')
  })

  it('treats only the bundled packshots as standard pictures', () => {
    expect(isOutdoorPackshot('/outdoor/products/tumbler-black.png')).toBe(true)
    expect(isOutdoorPackshot('https://cdn.example.com/p1.png')).toBe(false)
    expect(isOutdoorPackshot(null)).toBe(false)
  })

  it('lets staff open the shop preview but still sends them away from cart and checkout', () => {
    expect(isOutdoorStaffPage('/outdoor/admin')).toBe(true)
    expect(isOutdoorStaffPage('/outdoor/fulfilment')).toBe(true)
    expect(isOutdoorStaffPage('/outdoor/shop')).toBe(true)
    expect(isOutdoorStaffPage('/outdoor/shop/p1')).toBe(true)
    expect(isOutdoorStaffPage('/outdoor/cart')).toBe(false)
    expect(isOutdoorStaffPage('/outdoor/checkout')).toBe(false)
    expect(isOutdoorStaffPage('/outdoor')).toBe(false)
  })
})

describe('mainAppHref', () => {
  const outdoor = { hostname: 'outdoor.serapod2u.com', protocol: 'https:' }

  it('keeps relative links on the main app host', () => {
    expect(mainAppHref('/supply-chain/products', { hostname: 'serapod2u.com', protocol: 'https:' }, 'https://serapod2u.com')).toBe(
      '/supply-chain/products',
    )
    expect(mainAppHref('/supply-chain/products', null, 'https://serapod2u.com')).toBe('/supply-chain/products')
  })

  it('sends Outdoor-host links to the configured main app', () => {
    expect(mainAppHref('/supply-chain/products', outdoor, 'https://serapod2u.com/')).toBe('https://serapod2u.com/supply-chain/products')
  })

  it('derives the main app from the Outdoor host when the configured URL is missing or is the Outdoor host', () => {
    expect(mainAppHref('/ecommerce/store-orders', outdoor, '')).toBe('https://serapod2u.com/ecommerce/store-orders')
    expect(mainAppHref('/ecommerce/store-orders', outdoor, 'https://outdoor.serapod2u.com')).toBe(
      'https://serapod2u.com/ecommerce/store-orders',
    )
    expect(mainAppHref('/x', { hostname: 'www.outdoor.serapod2u.com', protocol: 'https:' }, '')).toBe('https://serapod2u.com/x')
  })
})
