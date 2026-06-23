// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import OrgLogoUpload from './OrgLogoUpload'

describe('OrgLogoUpload', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  it('maps a persisted storage path on load and refreshes when the saved value changes', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
    const props = {
      orgName: '24 Street Vapor',
      onLogoChange: vi.fn(),
    }
    const { rerender } = render(
      <OrgLogoUpload {...props} currentLogoUrl="org-24/old.jpg" />
    )

    expect((screen.getByAltText('Organization logo') as HTMLImageElement).src).toContain(
      '/storage/v1/object/public/avatars/org-24/old.jpg'
    )

    rerender(<OrgLogoUpload {...props} currentLogoUrl="org-24/new.jpg" />)

    expect((screen.getByAltText('Organization logo') as HTMLImageElement).src).toContain(
      '/storage/v1/object/public/avatars/org-24/new.jpg'
    )
  })

  it('marks removal for the parent form without persisting immediately', () => {
    const onLogoChange = vi.fn()
    const onLogoRemove = vi.fn()
    render(
      <OrgLogoUpload
        orgName="24 Street Vapor"
        currentLogoUrl="https://example.test/logo.jpg"
        onLogoChange={onLogoChange}
        onLogoRemove={onLogoRemove}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove 24 Street Vapor logo' }))

    expect(onLogoChange).toHaveBeenCalledWith(null)
    expect(onLogoRemove).toHaveBeenCalledTimes(1)
    expect(screen.queryByAltText('Organization logo')).toBeNull()
  })
})
