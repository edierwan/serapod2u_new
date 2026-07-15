// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRODUCT_CODE_DUPLICATE_MESSAGE } from '@/lib/products/product-code'
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
