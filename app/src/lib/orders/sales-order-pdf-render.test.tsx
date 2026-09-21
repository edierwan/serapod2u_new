import { inflateSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'
import { ClassicTemplate, type TemplateDocumentData, type TemplateOrderData } from '@/lib/pdf-templates'

/**
 * Sales Order PDF — asserted against a real generated document rather than
 * against the template source, so the line descriptions, the Hero/Zero
 * grouping, the Expected Delivery section and the footer are all checked as the
 * reader receives them.
 *
 * `pdfText` inflates the page content streams (the template compresses them)
 * and collects the literal strings behind each `Tj` show-text operator, which
 * is exactly the text drawn on the page and nothing else.
 */
interface DrawnText {
  text: string
  /** PDF user-space y, in points from the BOTTOM of the page. Below 0 is off it. */
  y: number
}

/**
 * Every string drawn on the document, with the y it was drawn at. jsPDF emits
 * `x y Td (text) Tj` per run, in points from the bottom-left of the page, and
 * will happily place a run below y=0 — off the paper — so the coordinate is the
 * only way to prove the footer stayed on the page.
 */
function pdfDrawnText(bytes: Buffer): DrawnText[] {
  const content = pdfContent(bytes)
  const drawn: DrawnText[] = []
  const runs = /(-?[\d.]+)\s+(-?[\d.]+)\s+Td\s*\n?\((?:(?:\\.|[^\\()])*)\)\s*Tj/g
  for (const match of content.matchAll(runs)) {
    const text = /\(((?:\\.|[^\\()])*)\)\s*Tj$/.exec(match[0])?.[1] ?? ''
    drawn.push({ text, y: Number(match[2]) })
  }
  return drawn
}

/** A4 page height in PDF points, as the template's MediaBox declares it. */
const PAGE_HEIGHT_PT = 841.89

function pdfContent(bytes: Buffer): string {
  let content = ''
  let cursor = 0
  while (true) {
    const open = bytes.indexOf('stream', cursor)
    if (open === -1) break
    let start = open + 'stream'.length
    if (bytes[start] === 0x0d) start += 1
    if (bytes[start] === 0x0a) start += 1
    const close = bytes.indexOf('endstream', start)
    if (close === -1) break
    try {
      content += inflateSync(bytes.subarray(start, close)).toString('latin1')
    } catch {
      // Not a deflate stream (an embedded font or image) — nothing to read.
    }
    cursor = close + 'endstream'.length
  }
  return content
}

function pdfText(bytes: Buffer): string[] {
  return [...pdfContent(bytes).matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map((match) => match[1])
}

/** How many pages the generated document has. */
function pdfPageCount(bytes: Buffer): number {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
}

const ORG = { org_name: 'Serapod Sdn Bhd', org_type_code: 'HQ' }

const line = (productName: string, variantName: string, qty: number, unitPrice: number) => ({
  product: { product_name: productName, product_code: 'CEL' },
  variant: { variant_name: variantName },
  qty,
  unit_price: unitPrice,
  line_total: qty * unitPrice,
})

/** 5,600 cases in total, deliberately stored Zero-first. */
const ORDER_ITEMS = [
  line('Cellera Zero', 'Zero Edition Novella [ Almond Corn ]', 1400, 32),
  line('Cellera Hero', 'Fruity Cellera Cartridge [ Honeydew ]', 1400, 32),
  line('Cellera Zero', 'Zero Edition Trevia [ Mango Blackcurrant ]', 1400, 32),
  line('Cellera Hero', 'Deluxe Cellera Cartridge [ Banana Vanilla ]', 1400, 32),
]

async function renderBytes(
  docType: string,
  items: TemplateOrderData['order_items'] = ORDER_ITEMS,
  terms = 'Payment within 30 days of invoice date.',
): Promise<Buffer> {
  const orderData = {
    order_no: 'SO26000044',
    order_type: docType,
    status: 'approved',
    created_at: '2026-09-01T00:00:00Z',
    buyer_org: ORG,
    seller_org: ORG,
    order_items: items,
    organization_terms: terms,
  } as unknown as TemplateOrderData

  const documentData = {
    doc_no: `${docType}26000044`,
    display_doc_no: `${docType}26000044`,
    doc_type: docType,
    status: 'approved',
    created_at: '2026-09-01T00:00:00Z',
  } as TemplateDocumentData

  const blob = await new ClassicTemplate([]).generate(orderData, documentData, docType === 'SO' ? 'Sales Order' : 'Purchase Order')
  return Buffer.from(await blob.arrayBuffer())
}

async function renderDocument(
  docType: string,
  items: TemplateOrderData['order_items'] = ORDER_ITEMS,
  terms?: string,
): Promise<string[]> {
  return pdfText(await renderBytes(docType, items, terms))
}

describe('Sales Order PDF', () => {
  let text: string[]
  let joined: string

  beforeAll(async () => {
    text = await renderDocument('SO')
    joined = text.join('\n')
  })

  it('describes each line as "<Product Name> - [ Flavour ]"', () => {
    expect(text).toContain('Cellera Hero - [ Honeydew ]')
    expect(text).toContain('Cellera Hero - [ Banana Vanilla ]')
    expect(text).toContain('Cellera Zero - [ Almond Corn ]')
    expect(text).toContain('Cellera Zero - [ Mango Blackcurrant ]')
  })

  it('prints none of the marketing range wording', () => {
    for (const range of [
      'Zero Edition Novella',
      'Zero Edition Trevia',
      'Fruity Cellera Cartridge',
      'Deluxe Cellera Cartridge',
    ]) {
      expect(joined).not.toContain(range)
    }
    expect(joined).not.toContain('Cellera Zero Zero Edition Novella')
    expect(joined).not.toContain('Cellera Hero Fruity Cellera Cartridge')
  })

  it('shows both Hero rows before either Zero row, though Zero was stored first', () => {
    const rows = text.filter((value) => value.startsWith('Cellera '))
    expect(rows).toEqual([
      'Cellera Hero - [ Honeydew ]',
      'Cellera Hero - [ Banana Vanilla ]',
      'Cellera Zero - [ Almond Corn ]',
      'Cellera Zero - [ Mango Blackcurrant ]',
    ])
  })

  it('states Expected Delivery between the order total and the Terms', () => {
    const total = text.indexOf('Total')
    const heading = text.indexOf('Expected Delivery')
    const value = text.indexOf('56 Boxes')
    const terms = text.findIndex((entry) => entry.toUpperCase().startsWith('TERMS'))

    expect(total).toBeGreaterThan(-1)
    expect(heading).toBeGreaterThan(total)
    expect(value).toBe(heading + 1)
    expect(terms).toBeGreaterThan(value)
  })

  it('prints no formula or explanation beside the figure', () => {
    expect(joined).not.toContain('5600 / 100')
    expect(joined).not.toContain('5,600 / 100')
    expect(joined).not.toMatch(/÷/)
    expect(joined).not.toContain('Calculation')
    expect(joined).not.toContain('100 cases')
    expect(joined).not.toContain('cases per box')
    expect(joined).not.toContain('56.00 Boxes')
  })

  it('leaves the order total and the line amounts alone', () => {
    // 5,600 cases @ RM32 — the same figures as before the grouping.
    expect(text).toContain('Total')
    expect(joined).toContain('RM 179,200.00')
    expect(text.filter((value) => value === 'RM 44800.00')).toHaveLength(4)
    const cases = ORDER_ITEMS.reduce((sum, item) => sum + item.qty, 0)
    expect(cases).toBe(5600)
    expect(text).toContain('56 Boxes')
  })

  it('keeps the signature block and the footer note', () => {
    expect(text).toContain('Issued by:')
    expect(text).toContain('Created by:')
    expect(text).toContain('Approved by:')
    expect(joined).toContain('Payment within 30 days of invoice date.')
  })

  it('divides without rounding when the cases do not fill whole boxes', async () => {
    const halfBox = await renderDocument('SO', [
      line('Cellera Hero', 'Fruity Cellera Cartridge [ Honeydew ]', 5650, 32),
    ])
    expect(halfBox).toContain('56.5 Boxes')
    expect(halfBox).not.toContain('56 Boxes')
    expect(halfBox).not.toContain('57 Boxes')
  })

  it('renders a single-box order in the singular', async () => {
    const oneBox = await renderDocument('SO', [
      line('Cellera Hero', 'Fruity Cellera Cartridge [ Honeydew ]', 100, 32),
    ])
    expect(oneBox).toContain('1 Box')
  })
})

describe('a long Sales Order', () => {
  // Enough lines to fill the first page and push the total, the Expected
  // Delivery section, the Terms and the signature block onto a second one.
  const manyLines = Array.from({ length: 40 }, (_, index) =>
    line(index % 2 === 0 ? 'Cellera Hero' : 'Cellera Zero', `Fruity Cellera Cartridge [ Flavour ${index} ]`, 140, 32),
  )

  it('paginates and still prints every closing section once', async () => {
    const bytes = await renderBytes('SO', manyLines)
    const text = pdfText(bytes)

    expect(pdfPageCount(bytes)).toBeGreaterThan(1)
    expect(text.filter((value) => value === 'Expected Delivery')).toHaveLength(1)
    expect(text.filter((value) => value === 'Issued by:')).toHaveLength(1)
    expect(text.filter((value) => value === 'Created by:')).toHaveLength(1)
    expect(text.filter((value) => value === 'Approved by:')).toHaveLength(1)
    // 40 lines x 140 cases = 5,600 cases.
    expect(text).toContain('56 Boxes')
  })

  it('still groups every Hero line ahead of every Zero line across the pages', async () => {
    const text = await renderDocument('SO', manyLines)
    const families = text.filter((value) => value.startsWith('Cellera ')).map((value) => value.split(' - ')[0])
    expect(families).toHaveLength(40)
    expect(families.lastIndexOf('Cellera Hero')).toBeLessThan(families.indexOf('Cellera Zero'))
  })

  it('keeps the signature block clear of the page bottom', async () => {
    // The footer takes a page of its own when it would not fit, so the note
    // that closes it is always drawn.
    const text = await renderDocument('SO', manyLines)
    expect(text).toContain('This is a computer generated document.')
  })

  it('keeps Expected Delivery on the page, directly above its value', async () => {
    const longTerms = Array.from({ length: 60 }, (_, index) => `${index + 1}. Clause ${index + 1}.`).join('\n')
    const drawn = pdfDrawnText(await renderBytes('SO', manyLines, longTerms))

    const heading = drawn.find((run) => run.text === 'Expected Delivery')
    const value = drawn.find((run) => run.text === '56 Boxes')
    expect(heading?.y).toBeGreaterThan(0)
    expect(value?.y).toBeGreaterThan(0)
    // The value sits directly under its heading, on the same page.
    expect(heading!.y - value!.y).toBeGreaterThan(0)
    expect(heading!.y - value!.y).toBeLessThan(30)
  })

  /**
   * The signature block has no height of its own to bargain with: it is drawn
   * at a fixed offset below the Terms and runs ~50mm further down. At certain
   * document lengths that offset lands it past the foot of the page, and jsPDF
   * draws it there anyway — at a negative y, off the paper. Adding Expected
   * Delivery shifts every one of those lengths, so the invariant is checked
   * across a spread of them rather than at one hand-picked size.
   */
  it('never draws the footer off the page, at any document length', async () => {
    const offPage: string[] = []

    for (const lineCount of [4, 20, 40]) {
      for (const clauseCount of [1, 8, 16, 20, 23, 30, 41, 45, 48, 49, 52, 60, 70]) {
        const items = Array.from({ length: lineCount }, (_, index) =>
          line(index % 2 === 0 ? 'Cellera Hero' : 'Cellera Zero', `Fruity Cellera Cartridge [ Flavour ${index} ]`, 140, 32),
        )
        const terms = Array.from({ length: clauseCount }, (_, index) => `${index + 1}. Clause ${index + 1} of the agreement.`).join('\n')
        const drawn = pdfDrawnText(await renderBytes('SO', items, terms))
        const note = drawn.find((run) => run.text === 'This is a computer generated document.')

        if (!note || !(note.y > 0)) {
          offPage.push(`${lineCount} lines / ${clauseCount} clauses -> y=${note ? note.y.toFixed(1) : 'missing'}`)
        }
      }
    }

    expect(offPage).toEqual([])
  })
})

describe('other documents from the same template', () => {
  it('leave the Purchase Order without an Expected Delivery section', async () => {
    const text = await renderDocument('PO')
    expect(text).not.toContain('Expected Delivery')
    expect(text).toContain('Total')
    expect(text).toContain('Issued by:')
  })

  it('leave the Purchase Order line order exactly as stored', async () => {
    const text = await renderDocument('PO')
    expect(text.filter((value) => value.startsWith('Cellera '))).toEqual([
      'Cellera Zero - [ Almond Corn ]',
      'Cellera Hero - [ Honeydew ]',
      'Cellera Zero - [ Mango Blackcurrant ]',
      'Cellera Hero - [ Banana Vanilla ]',
    ])
  })

  it('still simplify the description, which is one shared formatter', async () => {
    const text = await renderDocument('PO')
    expect(text.join('\n')).not.toContain('Zero Edition Novella')
  })
})
