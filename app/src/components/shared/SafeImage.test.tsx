// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SafeImage from './SafeImage'

describe('SafeImage', () => {
  afterEach(cleanup)

  it('renders a clean placeholder (not a broken <img>) when no source is provided', () => {
    render(<SafeImage src={null} alt="Serapod Portable Speaker" className="h-10 w-10" />)

    const node = screen.getByRole('img', { name: 'Serapod Portable Speaker' })
    expect(node.tagName).toBe('DIV')
  })

  it('falls back to the placeholder when an empty string is provided', () => {
    render(<SafeImage src="   " alt="Cellera Zero" className="h-10 w-10" />)

    expect(screen.getByRole('img', { name: 'Cellera Zero' }).tagName).toBe('DIV')
  })

  it('renders an <img> for a valid non-storage URL and swaps to the placeholder on load error', () => {
    render(<SafeImage src="https://legacy.example/broken.png" alt="Serapod Camping Chair" />)

    const img = screen.getByRole('img', { name: 'Serapod Camping Chair' })
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe('https://legacy.example/broken.png')

    fireEvent.error(img)

    expect(screen.getByRole('img', { name: 'Serapod Camping Chair' }).tagName).toBe('DIV')
  })

  it('attempts a newly provided source after the previous one failed', () => {
    const view = render(
      <SafeImage src="https://legacy.example/broken.png" alt="Ellbow Cat Treat" />
    )
    fireEvent.error(screen.getByRole('img', { name: 'Ellbow Cat Treat' }))
    expect(screen.getByRole('img', { name: 'Ellbow Cat Treat' }).tagName).toBe('DIV')

    view.rerender(<SafeImage src="https://legacy.example/new.png" alt="Ellbow Cat Treat" />)

    const img = screen.getByRole('img', { name: 'Ellbow Cat Treat' })
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe('https://legacy.example/new.png')
  })

  it('passes blob: preview URLs through untouched (immediate local upload preview)', () => {
    render(<SafeImage src="blob:http://localhost:3000/abc-123" alt="New upload" />)

    const img = screen.getByRole('img', { name: 'New upload' })
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe('blob:http://localhost:3000/abc-123')
  })
})
