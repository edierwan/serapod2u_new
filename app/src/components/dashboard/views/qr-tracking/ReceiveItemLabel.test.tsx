// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ReceiveItemLabel } from './ReceiveItemLabel'
import { readFileSync } from 'node:fs'
afterEach(cleanup)
it('shows dynamic product and clean flavour with master product code in two lines', () => {
  const { container } = render(<ReceiveItemLabel product_name="Test Group" variant_name="Range [ Citrus ]" product_code="CT" />)
  expect(Array.from(container.children).map(el => el.textContent)).toEqual(['Test Group', 'Citrus - CT'])
})
it.each([null, undefined, '', '  '])('omits absent product codes (%s)', (code) => {
  const { container } = render(<ReceiveItemLabel product_name="Another Group" variant_name="Plain flavour" product_code={code} />)
  expect(container.textContent).toBe('Another GroupPlain flavour')
})
it('reads code from the variant relationship and leaves destination/quantity data intact', () => {
  const api = readFileSync('src/app/api/warehouse/receipt-summary/route.ts', 'utf8')
  const view = readFileSync('src/components/dashboard/views/qr-tracking/WarehouseReceiveView2.tsx', 'utf8')
  expect(api).toContain('product_variants(variant_name, product_code)')
  expect(api).toContain('product_code: (oi.product_variants as any)?.product_code || null')
  expect(api).toContain('destination_stock_config: destinationByVariant.get(variantId) || null')
  expect(view).not.toContain('Inventory destination:')
  expect(view).not.toContain('it.destination_stock_config.stock_sku')
  expect(view).toContain('receiveNow[it.variant_id] || 0')
})
