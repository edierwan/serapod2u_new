// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AddProductView from './AddProductView'

vi.mock('@/lib/hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: () => ({ isReady: false, supabase: {} }),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

afterEach(cleanup)

describe('AddProductView', () => {
  it('remains the real Product creation form with Product-level Additional Attributes', () => {
    const onViewChange = vi.fn()
    render(<AddProductView userProfile={{}} onViewChange={onViewChange} />)

    expect(screen.getByRole('heading', { name: 'Add New Product' })).not.toBeNull()
    expect(screen.getByText('Product Information')).not.toBeNull()
    expect(screen.getByPlaceholderText('e.g., Premium Vape Device')).not.toBeNull()
    expect(screen.getByText('Brand')).not.toBeNull()
    expect(screen.getByText('Category')).not.toBeNull()
    expect(screen.getByText('Manufacturer')).not.toBeNull()
    expect(screen.getByText('Group')).not.toBeNull()
    expect(screen.getByText('SubGroup')).not.toBeNull()
    expect(screen.getByText('Product Image')).not.toBeNull()
    expect(screen.getByText('Outdoor store')).not.toBeNull()
    expect(screen.getByText(/Additional Attributes/)).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Add Attribute' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Create Product' }).closest('form')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onViewChange).toHaveBeenCalledWith('products')
  })
})
