import { describe, expect, it, vi } from 'vitest'
import {
  ARCHIVE_PRODUCT_VARIANT_RPC,
  VariantArchiveRefreshError,
  archiveProductVariantAndRefresh,
  variantArchiveSuccessDescription,
} from './variant-deletion'

const archivedResult = {
  status: 'archived' as const,
  variant_id: 'variant-referenced',
  variant_is_active: false as const,
  configurations_archived: 2,
  remaining_operational_configurations: 0 as const,
  already_archived: false,
}

describe('Product Variant archive client flow', () => {
  it('waits for the verified atomic RPC and authoritative refresh before resolving success', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: archivedResult, error: null })
    const refresh = vi.fn().mockResolvedValue(true)

    const result = await archiveProductVariantAndRefresh(
      { rpc },
      'variant-referenced',
      refresh,
    )

    expect(rpc).toHaveBeenCalledWith(ARCHIVE_PRODUCT_VARIANT_RPC, {
      p_variant_id: 'variant-referenced',
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(result.variant_is_active).toBe(false)
    expect(result.remaining_operational_configurations).toBe(0)
    expect(variantArchiveSuccessDescription(result)).toMatch(/Historical records were preserved/)
  })

  it('cannot produce success or refresh the list when the database operation fails', async () => {
    const rpcFailure = new Error('variant_archive_incomplete')
    const rpc = vi.fn().mockResolvedValue({ data: null, error: rpcFailure })
    const refresh = vi.fn().mockResolvedValue(true)
    let successShown = false

    try {
      await archiveProductVariantAndRefresh({ rpc }, 'variant-referenced', refresh)
      successShown = true
    } catch (error) {
      expect(error).toBe(rpcFailure)
    }

    expect(successShown).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('rejects an unverified/zero-row-style response instead of reporting false success', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })

    await expect(archiveProductVariantAndRefresh(
      { rpc },
      'variant-referenced',
      vi.fn().mockResolvedValue(true),
    )).rejects.toThrow(/verified database result/)
  })

  it('does not report full success when the authoritative refresh fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: archivedResult, error: null })

    await expect(archiveProductVariantAndRefresh(
      { rpc },
      'variant-referenced',
      vi.fn().mockResolvedValue(false),
    )).rejects.toBeInstanceOf(VariantArchiveRefreshError)
  })
})
