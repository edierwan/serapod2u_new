// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SignatureUpload from './SignatureUpload'

const createSignedUrlMock = vi.fn()
const uploadMock = vi.fn()
const getPublicUrlMock = vi.fn()
const updateUserWithAuthMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: createSignedUrlMock,
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
      }),
    },
  }),
}))

vi.mock('@/lib/actions', () => ({
  updateUserWithAuth: (...args: any[]) => updateUserWithAuthMock(...args),
}))

const PUBLIC_URL_PREFIX = 'http://localhost:54321/storage/v1/object/public/documents/'

describe('SignatureUpload', () => {
  beforeEach(() => {
    createSignedUrlMock.mockReset()
    uploadMock.mockReset()
    getPublicUrlMock.mockReset()
    updateUserWithAuthMock.mockReset()
    updateUserWithAuthMock.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    cleanup()
  })

  it('loads an existing signature and resolves it to a signed URL', async () => {
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: 'http://localhost:54321/storage/v1/object/sign/documents/signatures/u1/old.png?token=abc' },
      error: null,
    })

    render(
      <SignatureUpload
        userId="u1"
        currentSignatureUrl={`${PUBLIC_URL_PREFIX}signatures/u1/old.png`}
      />
    )

    await waitFor(() => expect(createSignedUrlMock).toHaveBeenCalledWith('signatures/u1/old.png', 3600))

    const img = await screen.findByAltText('Digital Signature') as HTMLImageElement
    expect(img.src).toContain('/object/sign/documents/signatures/u1/old.png')
  })

  it('shows a fallback error state when the signed URL cannot be resolved', async () => {
    createSignedUrlMock.mockResolvedValue({ data: null, error: new Error('not found') })

    render(
      <SignatureUpload
        userId="u1"
        currentSignatureUrl={`${PUBLIC_URL_PREFIX}signatures/u1/missing.png`}
      />
    )

    await waitFor(() => expect(screen.getByText('Signature image unavailable')).toBeTruthy())
  })

  it('shows a fallback error state when the image fails to load', async () => {
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: 'http://localhost:54321/storage/v1/object/sign/documents/signatures/u1/old.png?token=abc' },
      error: null,
    })

    render(
      <SignatureUpload
        userId="u1"
        currentSignatureUrl={`${PUBLIC_URL_PREFIX}signatures/u1/old.png`}
      />
    )

    const img = await screen.findByAltText('Digital Signature')
    fireEvent.error(img)

    await waitFor(() => expect(screen.getByText('Signature image unavailable')).toBeTruthy())
  })

  it('uploading a new signature previews it immediately', async () => {
    createSignedUrlMock
      .mockResolvedValueOnce({
        data: { signedUrl: 'http://localhost:54321/storage/v1/object/sign/documents/signatures/u1/new.png?token=fresh' },
        error: null,
      })
    uploadMock.mockResolvedValue({ error: null, data: { path: 'signatures/u1/new.png' } })
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: `${PUBLIC_URL_PREFIX}signatures/u1/new.png` } })

    const user = userEvent.setup()
    render(<SignatureUpload userId="u1" currentSignatureUrl={null} />)

    await user.click(screen.getByRole('tab', { name: /Upload Image/i }))
    const input = await waitFor(() => {
      const el = document.querySelector('input[type="file"]') as HTMLInputElement | null
      if (!el) throw new Error('file input not mounted yet')
      return el
    })
    const file = new File(['fake'], 'sig.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(updateUserWithAuthMock).toHaveBeenCalledWith(
      'u1',
      { signature_url: `${PUBLIC_URL_PREFIX}signatures/u1/new.png` },
      { id: 'u1', role_code: 'USER' }
    ))

    await waitFor(() => expect(createSignedUrlMock).toHaveBeenCalledWith('signatures/u1/new.png', 3600))
    const img = await screen.findByAltText('Digital Signature') as HTMLImageElement
    expect(img.src).toContain('/object/sign/documents/signatures/u1/new.png')
  })

  it('removing the signature clears the preview', async () => {
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: 'http://localhost:54321/storage/v1/object/sign/documents/signatures/u1/old.png?token=abc' },
      error: null,
    })
    vi.stubGlobal('confirm', vi.fn(() => true))

    render(
      <SignatureUpload
        userId="u1"
        currentSignatureUrl={`${PUBLIC_URL_PREFIX}signatures/u1/old.png`}
      />
    )

    await screen.findByAltText('Digital Signature')

    fireEvent.click(screen.getByRole('button', { name: /Remove/i }))

    await waitFor(() => expect(updateUserWithAuthMock).toHaveBeenCalledWith(
      'u1',
      { signature_url: null },
      { id: 'u1', role_code: 'USER' }
    ))

    await waitFor(() => expect(screen.queryByAltText('Digital Signature')).toBeNull())

    vi.unstubAllGlobals()
  })
})
