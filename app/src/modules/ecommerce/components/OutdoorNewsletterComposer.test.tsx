// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OutdoorNewsletterComposer } from './OutdoorNewsletterComposer'

const posts: any[] = []

beforeEach(() => {
  posts.length = 0
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      posts.push(body)
      const data = body.test ? { ok: true, test: true, to: 'me@serapod.com' } : { ok: true, emailed: 2, subscribers: 2 }
      return new Response(JSON.stringify(data), { status: 200 })
    }
    return new Response(JSON.stringify({ subscribers: 2, updates: [] }), { status: 200 })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function fillIn() {
  render(<OutdoorNewsletterComposer />)
  await screen.findByText('Email your subscribers')
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'shipping' } })
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Free shipping weekend' } })
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'All orders ship free.' } })
}

describe('OutdoorNewsletterComposer', () => {
  it('keeps the send buttons off until a title and message are written', async () => {
    render(<OutdoorNewsletterComposer />)
    await screen.findByText('Email your subscribers')
    expect((screen.getByRole('button', { name: 'Send to 2 subscribers' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Send a test to me' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a preview and sends a test only to the staff member', async () => {
    await fillIn()
    expect(screen.getByTestId('newsletter-preview').textContent).toContain('Free shipping weekend')
    expect(screen.getByTestId('newsletter-preview').textContent).toContain('Free shipping')
    fireEvent.click(screen.getByRole('button', { name: 'Send a test to me' }))
    await screen.findByText(/Test sent to me@serapod.com/)
    expect(posts).toEqual([{ kind: 'shipping', title: 'Free shipping weekend', body: 'All orders ship free.', link: '', test: true }])
  })

  it('asks for confirmation before sending to everyone', async () => {
    await fillIn()
    fireEvent.click(screen.getByRole('button', { name: 'Send to 2 subscribers' }))
    expect(posts).toEqual([])
    expect(screen.getByText(/It cannot be undone/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send it' }))
    await screen.findByText('Sent to 2 of 2 subscribers.')
    expect(posts).toHaveLength(1)
    expect(posts[0].test).toBe(false)
    await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(''))
  })

  it('does not send with a bad link', async () => {
    await fillIn()
    fireEvent.change(screen.getByLabelText(/Button link/), { target: { value: 'javascript:alert(1)' } })
    expect((screen.getByRole('button', { name: 'Send to 2 subscribers' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
