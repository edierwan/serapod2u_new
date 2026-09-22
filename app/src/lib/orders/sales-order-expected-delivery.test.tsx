import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CASES_PER_BOX,
  expectedDeliveryBoxes,
  formatBoxEstimate,
  formatExpectedDelivery,
  resolveOrderCasesPerBox,
} from './packaging'

const source = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, `../../${relativePath}`), 'utf8')

const view = source('components/orders/ViewOrderDetailsView.tsx')
const classicTemplate = source('lib/pdf-templates.ts')

/**
 * Expected Delivery — the box figure the Sales Order states between the order
 * total and the Terms & Conditions.
 *
 * The generated document itself is asserted in `sales-order-pdf-render.test.tsx`;
 * this file locks the arithmetic, and the Sales Order detail page, which renders
 * in the browser and so can only be read here as source.
 */
describe('Expected Delivery figure', () => {
  it.each([
    [5600, '56 Standard Boxes'],
    [5550, '55 Standard Boxes + 1 Small Box'],
    [5050, '50 Standard Boxes + 1 Small Box'],
    [100, '1 Standard Box'],
    [50, '1 Small Box'],
    [200, '2 Standard Boxes'],
  ])('%i cases -> "%s"', (cases, expected) => {
    expect(formatExpectedDelivery(cases)).toBe(expected)
  })

  it('splits into whole Standard Boxes plus at most one Small Box', () => {
    expect(DEFAULT_CASES_PER_BOX).toBe(100)
    expect(expectedDeliveryBoxes(5600)).toEqual({ standardBoxes: 56, smallBoxes: 0 })
    expect(expectedDeliveryBoxes(5550)).toEqual({ standardBoxes: 55, smallBoxes: 1 })
    expect(expectedDeliveryBoxes(5599)).toEqual({ standardBoxes: 55, smallBoxes: 1 })
    expect(expectedDeliveryBoxes(5601)).toEqual({ standardBoxes: 56, smallBoxes: 1 })
    expect(expectedDeliveryBoxes(1)).toEqual({ standardBoxes: 0, smallBoxes: 1 })
  })

  it('never prints a decimal, a zero part, or the loose case count', () => {
    for (const cases of [1, 50, 99, 100, 101, 150, 5050, 5550, 5600, 5625, 5650, 5699]) {
      const label = formatExpectedDelivery(cases)
      expect(label).not.toMatch(/\d\.\d/)
      expect(label).not.toContain('+ 0')
      expect(label).not.toMatch(/^0 Standard/)
      expect(label).not.toContain('Cases')
      expect(label).not.toMatch(/\b\d+ Boxes?\b/) // never a bare "56 Boxes" total
    }
    expect(formatExpectedDelivery(5550)).not.toContain('55.5')
    expect(formatExpectedDelivery(5550)).not.toContain('56 ')
  })

  it('groups thousands on a large order', () => {
    expect(formatExpectedDelivery(1_000_000)).toBe('10,000 Standard Boxes')
  })

  it('does not disturb the warehouse box split, which states loose cases on purpose', () => {
    expect(formatBoxEstimate(5650, 100)).toBe('56 Boxes + 50 Cases')
    expect(formatExpectedDelivery(5650)).toBe('56 Standard Boxes + 1 Small Box')
  })

  it('honours a configured box size, and falls back to 100', () => {
    expect(formatExpectedDelivery(600, 50)).toBe('12 Standard Boxes')
    expect(formatExpectedDelivery(620, 50)).toBe('12 Standard Boxes + 1 Small Box')
    expect(formatExpectedDelivery(5600, null)).toBe('56 Standard Boxes')
    expect(formatExpectedDelivery(5600, 0)).toBe('56 Standard Boxes')
  })

  it('uses one box size only when every line agrees on it', () => {
    expect(resolveOrderCasesPerBox([100, 100, 100], 100)).toBe(100)
    expect(resolveOrderCasesPerBox([50, 50], null)).toBe(50)
    // Mixed lines defer to the order setting rather than picking one line's size.
    expect(resolveOrderCasesPerBox([50, 100], 200)).toBe(200)
    expect(resolveOrderCasesPerBox([50, 100], null)).toBe(DEFAULT_CASES_PER_BOX)
    expect(resolveOrderCasesPerBox([null, undefined], null)).toBe(DEFAULT_CASES_PER_BOX)
  })

  it('yields the figure alone, with no working attached', () => {
    const rendered = [formatExpectedDelivery(5600), formatExpectedDelivery(5550)].join(' ')
    for (const working of ['/', '÷', 'Calculation', '100 cases', 'cases per box', '=', 'remaining']) {
      expect(rendered).not.toContain(working)
    }
  })
})

describe('Sales Order PDF section', () => {
  const section = classicTemplate.slice(
    classicTemplate.indexOf('private addExpectedDeliverySection'),
    classicTemplate.indexOf('async generate(orderData'),
  )

  it('reuses the shared conversion rather than dividing again', () => {
    expect(classicTemplate).toContain(
      "import { formatExpectedDelivery, resolveOrderCasesPerBox } from '@/lib/orders/packaging'",
    )
    expect(section).toContain('formatExpectedDelivery(')
    expect(section).not.toMatch(/\/\s*100/)
  })

  it('takes the case total the totals row is built from', () => {
    expect(section).toContain('orderData.order_items.reduce((sum, item) => sum + (item.qty || 0), 0)')
  })

  it('stays one plain line — bold label, normal value — not a card or a coloured panel', () => {
    expect(section).toContain("const heading = 'Expected Delivery:'")
    expect(section).toContain("this.doc.setFont('helvetica', 'bold')")
    expect(section).toContain("this.doc.setFont('helvetica', 'normal')")
    expect(section).toContain('this.doc.text(label, valueX, y)')
    expect(section).toContain('this.doc.setFontSize(9)')
    expect(section).not.toContain('this.doc.rect(')
    expect(section).not.toContain('setFillColor')
    expect(section).not.toContain('setDrawColor')
  })

  it('breaks the page rather than letting the pair split or hit the footer', () => {
    expect(section).toContain('this.doc.internal.pageSize.getHeight()')
    expect(section).toContain('this.doc.addPage()')
  })
})

describe('Sales Order detail page', () => {
  it('builds the line description through the shared helper', () => {
    expect(view).toContain("from '@/lib/orders/sales-order-line-presentation'")
    expect(view).toContain('salesOrderLineDescription(item.product?.product_name, item.variant?.variant_name)')
    // The inline formatter that produced the long name is gone from both surfaces.
    expect(view).not.toContain('bracketMatch')
    expect(classicTemplate).not.toContain('bracketMatch')
  })

  it('renders the grouped copy, never a re-sorted state array', () => {
    expect(view).toContain('sortSalesOrderLinesForDisplay<any>(orderData.order_items, (item) => item.product?.product_name)')
    expect(view).toContain('{displayItems.map((item: any, index: number) => (')
    expect(view).not.toContain('orderData.order_items?.map((item: any, index: number) => (')
    expect(view).not.toContain('orderData.order_items.sort')
  })

  it('still sums the totals from the stored rows', () => {
    expect(view).toContain('const subtotal = orderData.order_items?.reduce((sum: number, item: any) => sum + (item.line_total || 0), 0) || 0')
    expect(view).toContain('const totalQuantity = orderData.order_items?.reduce((sum: number, item: any) => sum + (item.qty || 0), 0) || 0')
  })

  it('shows Expected Delivery between the totals row and the Terms', () => {
    const totalsRow = view.indexOf('{formatCurrency(subtotal)}')
    const expectedDelivery = view.indexOf('<span className="font-semibold">Expected Delivery:</span>')
    const terms = view.indexOf('<h3 className="font-bold text-gray-900 mb-3 text-sm">Terms &amp; Conditions</h3>')
    expect(totalsRow).toBeGreaterThan(-1)
    expect(expectedDelivery).toBeGreaterThan(totalsRow)
    expect(terms).toBeGreaterThan(expectedDelivery)
    expect(view).toContain('{expectedDeliveryLabel}')
  })

  it('renders Expected Delivery as a plain section that survives pagination', () => {
    const section = view.slice(
      view.indexOf('{/* Expected Delivery'),
      view.indexOf('{/* Terms & Conditions'),
    )
    expect(section).toContain('break-inside-avoid page-break-inside-avoid')
    // Not a card, not a coloured panel, no oversized value, no heavy spacing.
    expect(section).not.toContain('<Card')
    expect(section).not.toContain('border')
    expect(section).not.toContain('bg-')
    expect(section).not.toContain('text-2xl')
    expect(section).not.toContain('text-3xl')
    // One line, sitting close under the totals row.
    expect(section).not.toContain('<h3')
    expect(section).toContain('mt-2')
    expect(section).not.toContain('mt-6')
  })

  it('uses the same shared helper as the PDF', () => {
    expect(view).toContain("import { formatExpectedDelivery, resolveOrderCasesPerBox } from '@/lib/orders/packaging'")
    expect(view).toContain('const expectedDeliveryLabel = formatExpectedDelivery(')
    expect(view).not.toMatch(/totalQuantity\s*\/\s*100/)
  })

  it('keeps the signature and footer blocks', () => {
    for (const marker of [
      'Issued by:',
      'Created by: {orderData.created_by_user?.full_name',
      'Approved by: {orderData.approved_by_user.full_name',
      'This is a computer generated document.',
    ]) {
      expect(view).toContain(marker)
    }
  })
})
