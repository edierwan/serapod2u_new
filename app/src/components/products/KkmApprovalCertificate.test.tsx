// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KkmApprovalCertificate from './KkmApprovalCertificate'

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  return {
    maybeSingle,
    toast: vi.fn(),
    supabase: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
      storage: { from: () => ({}) },
    },
  }
})

vi.mock('@/lib/hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: () => ({
    isReady: true,
    supabase: mocks.supabase,
  }),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

describe('KkmApprovalCertificate optional states', () => {
  beforeEach(() => {
    mocks.maybeSingle.mockReset()
    mocks.toast.mockReset()
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:certificate'),
      revokeObjectURL: vi.fn(),
    })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows Not provided without treating a missing optional record as an error', async () => {
    render(<KkmApprovalCertificate variantId="variant-1" canManage={false} kkmApproval="" />)
    expect(await screen.findByText('Not provided')).not.toBeNull()
    expect(screen.getByText(/Certificate attachment is optional/)).not.toBeNull()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('shows Certificate not attached when the KKM number exists', async () => {
    render(<KkmApprovalCertificate variantId="variant-1" canManage kkmApproval="KKM-123456789" />)
    expect(await screen.findByText('Certificate not attached')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Upload Certificate' })).not.toBeNull()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('shows Certificate attached and the filename when metadata exists', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: 'certificate-1', product_variant_id: 'variant-1', storage_path: 'variant-1/approval.pdf',
        file_name: 'approval.pdf', mime_type: 'application/pdf', file_size: 1200, updated_at: '2026-07-23',
      },
      error: null,
    })
    render(<KkmApprovalCertificate variantId="variant-1" canManage kkmApproval="" />)
    expect(await screen.findByText('Certificate attached')).not.toBeNull()
    expect(screen.getByText('approval.pdf')).not.toBeNull()
    expect(screen.getByText('KKM approval number not provided.')).not.toBeNull()
  })

  it('continues to surface genuine schema errors', async () => {
    const error = { message: 'relation public.variant_kkm_certificates does not exist' }
    mocks.maybeSingle.mockResolvedValue({ data: null, error })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<KkmApprovalCertificate variantId="variant-1" canManage={false} />)
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Certificate unavailable', variant: 'destructive' })))
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it.each([
    ['application/pdf', 'approval.pdf'],
    ['image/jpeg', 'approval.jpg'],
    ['image/png', 'approval.png'],
  ])('views a private %s certificate through the authenticated application endpoint', async (mimeType, fileName) => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: 'certificate-1', product_variant_id: 'variant-1', storage_path: `variant-1/${fileName}`,
        file_name: fileName, mime_type: mimeType, file_size: 1200, updated_at: '2026-07-23',
      },
      error: null,
    })
    const blob = new Blob(['certificate'], { type: mimeType })
    vi.mocked(fetch).mockResolvedValue(new Response(blob, { status: 200 }))
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<KkmApprovalCertificate variantId="variant-1" canManage kkmApproval="" />)
    fireEvent.click(await screen.findByRole('button', { name: 'View' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/products/variants/variant-1/kkm-certificate',
      { credentials: 'same-origin', cache: 'no-store' },
    ))
    expect(anchorClick).toHaveBeenCalled()
  })

  it('downloads the private certificate with the stored filename', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: 'certificate-1', product_variant_id: 'variant-1', storage_path: 'variant-1/approval.pdf',
        file_name: 'KKM approval.pdf', mime_type: 'application/pdf', file_size: 1200, updated_at: '2026-07-23',
      },
      error: null,
    })
    vi.mocked(fetch).mockResolvedValue(new Response(new Blob(['pdf'], { type: 'application/pdf' }), { status: 200 }))
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('KKM approval.pdf')
    })

    render(<KkmApprovalCertificate variantId="variant-1" canManage kkmApproval="" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/products/variants/variant-1/kkm-certificate?download=1',
      { credentials: 'same-origin', cache: 'no-store' },
    ))
    expect(anchorClick).toHaveBeenCalled()
  })

  it('shows a controlled error when the private file cannot be obtained', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: 'certificate-1', product_variant_id: 'variant-1', storage_path: 'variant-1/missing.pdf',
        file_name: 'missing.pdf', mime_type: 'application/pdf', file_size: 1200, updated_at: '2026-07-23',
      },
      error: null,
    })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Certificate file is unavailable' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }))

    render(<KkmApprovalCertificate variantId="variant-1" canManage kkmApproval="" />)
    fireEvent.click(await screen.findByRole('button', { name: 'View' }))

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Unable to view certificate',
      description: 'Certificate file is unavailable',
      variant: 'destructive',
    })))
  })
})
