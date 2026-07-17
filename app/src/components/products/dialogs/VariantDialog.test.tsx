// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRODUCT_CODE_DUPLICATE_MESSAGE } from '@/lib/products/product-code'
import { ALTERNATIVE_NAME_DUPLICATE_MESSAGE } from '@/lib/products/alternative-name'
import VariantDialog from './VariantDialog'

const products = [{ id: 'product-1', product_name: 'Cellera Hero' }]

describe('VariantDialog Product Code', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders directly below Barcode and enforces uppercase with a five-character maximum', () => {
    render(
      <VariantDialog
        variant={null}
        products={products}
        open
        isSaving={false}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    const barcode = screen.getByLabelText(/Barcode/)
    const productCode = screen.getByLabelText(/Product Code/) as HTMLInputElement

    expect(barcode.closest('.space-y-2')?.nextElementSibling?.contains(productCode)).toBe(true)
    expect(productCode.maxLength).toBe(5)

    fireEvent.change(productCode, { target: { value: 'a001' } })
    expect(productCode.value).toBe('A001')
  })

  it('shows the required inline message and does not save a duplicate', async () => {
    const onSave = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: PRODUCT_CODE_DUPLICATE_MESSAGE }),
    }))

    render(
      <VariantDialog
        variant={null}
        products={products}
        open
        isSaving={false}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.change(screen.getByLabelText(/Variant Name/), { target: { value: 'Original' } })
    fireEvent.change(screen.getByLabelText(/Product Code/), { target: { value: 'a001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(PRODUCT_CODE_DUPLICATE_MESSAGE)).not.toBeNull()
    await waitFor(() => expect(onSave).not.toHaveBeenCalled())
  })
})

describe('VariantDialog Alternative Name', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  const stubSuccessfulValidation = () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('renders directly below Variant Name and creates a variant with an Alternative Name', async () => {
    const onSave = vi.fn()
    stubSuccessfulValidation()
    render(
      <VariantDialog variant={null} products={products} open isSaving={false} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    const variantName = screen.getByLabelText(/Variant Name/)
    const alternativeName = screen.getByLabelText(/Alternative Name/) as HTMLInputElement
    expect(variantName.closest('.space-y-2')?.nextElementSibling?.contains(alternativeName)).toBe(true)
    expect(alternativeName.placeholder).toBe('e.g. Banana Vanilla')
    expect(screen.getByText('Alternative name commonly used by distributors.')).not.toBeNull()

    fireEvent.change(variantName, { target: { value: 'Banana Milk' } })
    fireEvent.change(alternativeName, { target: { value: ' Banana   Vanilla ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ alternative_name: 'Banana Vanilla' })
  })

  it('loads and retains the same Alternative Name when editing, excluding the current variant', async () => {
    const onSave = vi.fn()
    const fetchMock = stubSuccessfulValidation()
    const variant = {
      id: 'variant-1', product_id: 'product-1', variant_name: 'Banana Milk', alternative_name: 'Banana Vanilla',
      attributes: {}, barcode: '123', product_code: null, manufacturer_sku: null, manual_sku: null,
      base_cost: null, suggested_retail_price: null, is_active: true, is_default: false,
    } as any

    render(
      <VariantDialog variant={variant} products={products} open isSaving={false} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    expect((screen.getByLabelText(/Alternative Name/) as HTMLInputElement).value).toBe('Banana Vanilla')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ alternative_name: 'Banana Vanilla' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ variantId: 'variant-1', alternativeName: 'Banana Vanilla' })
  })

  it('allows a blank Alternative Name and saves it as null', async () => {
    const onSave = vi.fn()
    stubSuccessfulValidation()
    render(
      <VariantDialog variant={null} products={products} open isSaving={false} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    fireEvent.change(screen.getByLabelText(/Variant Name/), { target: { value: 'Banana Milk' } })
    fireEvent.change(screen.getByLabelText(/Alternative Name/), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].alternative_name).toBeNull()
  })

  it('prevents saving a duplicate Alternative Name and shows the required inline message', async () => {
    const onSave = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: ALTERNATIVE_NAME_DUPLICATE_MESSAGE, field: 'alternative_name' }),
    }))
    render(
      <VariantDialog variant={null} products={products} open isSaving={false} onOpenChange={vi.fn()} onSave={onSave} />,
    )

    fireEvent.change(screen.getByLabelText(/Variant Name/), { target: { value: 'Banana Milk' } })
    fireEvent.change(screen.getByLabelText(/Alternative Name/), { target: { value: 'BANANA VANILLA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(ALTERNATIVE_NAME_DUPLICATE_MESSAGE)).not.toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('VariantDialog Stock Configuration administration', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  const variant = {
    id: 'variant-1', product_id: 'product-1', variant_name: 'Banana Milk', alternative_name: null,
    attributes: {}, barcode: '123', product_code: null, manufacturer_sku: null, manual_sku: null,
    base_cost: null, suggested_retail_price: null, is_active: true, is_default: false,
  } as any

  it('shows the internal panel for an HQ administrator editing a Cellera flavour', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabled: false, configurations: [], legacy: [] }),
    }))

    render(
      <VariantDialog
        variant={variant}
        products={products}
        open
        isSaving={false}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        canManageStockConfigurations
      />,
    )

    expect(await screen.findByRole('region', { name: 'Inventory Stock Configurations' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Enable Stock Configurations' })).not.toBeNull()
  })

  it('does not expose the panel to other users', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <VariantDialog variant={variant} products={products} open isSaving={false} onOpenChange={vi.fn()} onSave={vi.fn()} />,
    )

    expect(screen.queryByRole('region', { name: 'Inventory Stock Configurations' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
