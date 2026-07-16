import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRODUCT_CODE_DUPLICATE_MESSAGE,
  PRODUCT_CODE_VALIDATION_UNAVAILABLE_MESSAGE,
} from '@/lib/products/product-code'
import { ALTERNATIVE_NAME_DUPLICATE_MESSAGE } from '@/lib/products/alternative-name'

const createClientMock = vi.fn()
const authGetUser = vi.fn()
const productSingle = vi.fn()
const duplicateMaybeSingle = vi.fn()
const variantEq = vi.fn()
const variantNeq = vi.fn()
const variantNot = vi.fn()
let alternativeRows: Array<{ id: string; alternative_name: string | null }> = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

describe('POST /api/product-variants/validate-product-code', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    productSingle.mockResolvedValue({ data: { brand_id: 'brand-cellera' }, error: null })
    duplicateMaybeSingle.mockResolvedValue({ data: null, error: null })
    alternativeRows = []

    const variantQuery: any = {
      eq: variantEq,
      neq: variantNeq,
      not: variantNot,
      limit: vi.fn(() => ({ maybeSingle: duplicateMaybeSingle })),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: alternativeRows, error: null }),
    }
    variantEq.mockReturnValue(variantQuery)
    variantNeq.mockReturnValue(variantQuery)
    variantNot.mockReturnValue(variantQuery)

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUser },
      from: (table: string) => {
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({ single: productSingle }),
            }),
          }
        }
        if (table === 'product_variants') {
          return {
            select: () => variantQuery,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    })
  })

  async function post(body: Record<string, unknown>) {
    const { POST } = await import('./route')
    return POST(new Request('http://localhost/api/product-variants/validate-product-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  it('rejects unauthenticated requests', async () => {
    authGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const response = await post({ productId: 'product-1', productCode: 'A001' })

    expect(response.status).toBe(401)
  })

  it('normalizes the code and accepts it when the Brand has no duplicate', async () => {
    const response = await post({ productId: 'product-1', productCode: '  a001 ' })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ valid: true, productCode: 'A001' })
    expect(variantEq).toHaveBeenCalledWith('product_code', 'A001')
    expect(variantEq).toHaveBeenCalledWith('products.brand_id', 'brand-cellera')
  })

  it('returns the required message for a duplicate under the same Brand', async () => {
    duplicateMaybeSingle.mockResolvedValue({ data: { id: 'variant-2' }, error: null })

    const response = await post({ productId: 'product-1', productCode: 'A001' })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toBe(PRODUCT_CODE_DUPLICATE_MESSAGE)
  })

  it('excludes the edited variant from the duplicate check', async () => {
    const response = await post({
      productId: 'product-1',
      productCode: 'A001',
      variantId: 'variant-1',
    })

    expect(response.status).toBe(200)
    expect(variantNeq).toHaveBeenCalledWith('id', 'variant-1')
  })

  it('rejects a normalized duplicate Alternative Name within the same active Product scope', async () => {
    alternativeRows = [{ id: 'variant-2', alternative_name: 'Banana-Vanilla' }]

    const response = await post({
      productId: 'product-1',
      productCode: null,
      alternativeName: '  BANANA   VANILLA ',
    })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload).toEqual({ error: ALTERNATIVE_NAME_DUPLICATE_MESSAGE, field: 'alternative_name' })
    expect(variantEq).toHaveBeenCalledWith('product_id', 'product-1')
    expect(variantEq).toHaveBeenCalledWith('is_active', true)
  })

  it('allows a blank Alternative Name and excludes the current variant during edit validation', async () => {
    const blankResponse = await post({ productId: 'product-1', productCode: null, alternativeName: '   ' })
    expect(blankResponse.status).toBe(200)
    expect(await blankResponse.json()).toEqual({ valid: true, productCode: null })

    const editResponse = await post({
      productId: 'product-1',
      productCode: null,
      alternativeName: 'Banana Vanilla',
      variantId: 'variant-1',
    })
    expect(editResponse.status).toBe(200)
    expect(variantNeq).toHaveBeenCalledWith('id', 'variant-1')
  })

  it('reports a validation-unavailable error instead of a duplicate when the query fails', async () => {
    duplicateMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: '42703', message: 'column product_variants.product_code does not exist' },
    })

    const response = await post({ productId: 'product-1', productCode: 'A001' })
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).toBe(PRODUCT_CODE_VALIDATION_UNAVAILABLE_MESSAGE)
  })

  it('rejects codes longer than five characters before querying the Product', async () => {
    const response = await post({ productId: 'product-1', productCode: 'A00001' })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('Product Code must be 5 characters or fewer.')
    expect(productSingle).not.toHaveBeenCalled()
  })
})
