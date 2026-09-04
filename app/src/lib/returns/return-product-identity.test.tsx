import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  variantAlternativeLabel,
  variantIdentityLabel,
} from '@/lib/inventory/variant-display-label'

const source = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, `../../${relativePath}`), 'utf8')

const view = source('components/supply-chain/returns/ReturnProductView.tsx')
const types = source('lib/returns/types.ts')
const eligibility = source('lib/returns/eligibility.ts')

describe('Return Product worksheet shows one Product Name column', () => {
  it('replaces the three identity columns with a single one', () => {
    expect(view).toContain('<th className="px-2 py-2 font-medium">Product Name</th>')
    expect(view).not.toContain('<th className="px-2 py-2 font-medium">Variant / Flavour</th>')
    expect(view).not.toContain('<th className="px-2 py-2 font-medium">Product Line</th>')
    expect(view).not.toContain('<th className="px-2 py-2 font-medium">Internal SKU</th>')
    // Three columns out, one in: the worksheet is now ten wide.
    expect(view).toContain('colSpan={10}')
    expect(view).not.toContain('colSpan={12}')
  })

  it('renders identity through the SHARED helpers, not a fourth implementation', () => {
    expect(view).toContain("from '@/lib/inventory/variant-display-label'")
    expect(view).toContain('variantIdentityLabel(r.variant_name, r.variant_product_code)')
    expect(view).toContain('variantAlternativeLabel(r.alternative_name)')
    expect(view).toContain('{r.product_name}')
  })

  it('shows no configuration information on the worksheet', () => {
    const worksheet = view.slice(view.indexOf('<th className="px-2 py-2 font-medium">Product Name</th>'))
    expect(worksheet).not.toContain('config_code')
    expect(worksheet).not.toContain('stock_config_id')
    expect(worksheet).not.toContain('New Box')
    expect(worksheet).not.toContain('withStockStrengthUnit')
  })

  it('keeps the Product Line tabs', () => {
    for (const label of ['All Items', 'Hero', 'Zero', 'S.Box', 'S.Line']) {
      expect(view).toContain(`label="${label}"`)
    }
    expect(view).toContain("r.product_line !== lineTab")
  })
})

describe('the removed columns are removed from the TABLE, not from the data', () => {
  it('keeps Product Line and Internal SKU on the API contract', () => {
    expect(types).toContain('manual_sku: string | null')
    expect(types).toContain("product_line: 'hero' | 'zero' | 'sbox' | 'sline' | 'other'")
    expect(eligibility).toContain('manual_sku: v.manual_sku ?? null')
    expect(eligibility).toContain('product_line: classifyProductLine(productName)')
  })

  it('keeps both searchable, and adds the two fields now on screen', () => {
    const haystack = view.slice(view.indexOf('const hay = ['), view.indexOf('const hay = [') + 400)
    expect(haystack).toContain('r.manual_sku')
    expect(haystack).toContain('r.product_line')
    expect(haystack).toContain('r.variant_product_code')
    expect(haystack).toContain('r.alternative_name')
  })

  it('keeps Product Line and Internal SKU reachable on the row tooltip', () => {
    expect(view).toContain('`Product Line: ${productLineLabel(r.product_line)}`')
    expect(view).toContain("r.manual_sku ? `Internal SKU: ${r.manual_sku}` : 'Internal SKU: not assigned'")
  })

  it('carries the variant identity from the API through to the row', () => {
    expect(types).toContain('variant_product_code: string | null')
    expect(types).toContain('alternative_name: string | null')
    expect(eligibility).toContain('variant_product_code: v.product_code ?? null')
    expect(eligibility).toContain('alternative_name: v.alternative_name ?? null')
    expect(eligibility).toContain('product_code, alternative_name')
  })
})

describe('identity degrades correctly for every product family', () => {
  const render = (
    productName: string,
    variantName: string | null,
    code: string | null,
    alternative: string | null,
  ) => [
    productName,
    variantIdentityLabel(variantName, code),
    variantAlternativeLabel(alternative),
  ].filter(Boolean)

  it('renders a Cellera cartridge exactly as Add Stock and Stock Transfer do', () => {
    expect(render(
      'Cellera Hero',
      'Deluxe Cellera Cartridge [ Banana Vanilla ]',
      'BV',
      'Banana Milk',
    )).toEqual([
      'Cellera Hero',
      'Banana Vanilla – BV',
      'Alternative: Banana Milk',
    ])
  })

  it('renders a device variant with no alternative name', () => {
    expect(render('Serapod Device S.Line', 'Arctic', 'AR', null)).toEqual([
      'Serapod Device S.Line',
      'Arctic – AR',
    ])
  })

  it('renders a non-vape variant carrying no Product Code', () => {
    // No dangling separator: the flavour stands alone.
    expect(render('Ellbow Cat Treat', 'Chicken Cranberry', null, null)).toEqual([
      'Ellbow Cat Treat',
      'Chicken Cranberry',
    ])
  })

  it('renders a historical saved row, which has only the name snapshot', () => {
    // return_case_items stores product_name / variant_name and no variant code,
    // so a saved row degrades to two lines rather than rendering an empty code.
    expect(render('SERAPOD® TUMBLER', 'SERAPOD® TUMBLER 1L', null, null)).toEqual([
      'SERAPOD® TUMBLER',
      'SERAPOD® TUMBLER 1L',
    ])
  })

  it('renders a product with no variant at all', () => {
    expect(render('Serapod Camping Mat', null, null, null)).toEqual([
      'Serapod Camping Mat',
      'No variant',
    ])
  })

  it('maps a saved historical row to null identity fields rather than guessing', () => {
    expect(view).toContain('// return_case_items stores a name snapshot only, so a saved historical')
    expect(view).toContain('variant_product_code: null')
  })
})
