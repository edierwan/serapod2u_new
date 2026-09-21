import { describe, expect, it } from 'vitest'
import { resolveTransactionalFromEmail, transactionalMessageId } from './transactional-html-email'

describe('resolveTransactionalFromEmail', () => {
  it('sends Gmail as the Gmail mailbox, not a custom From', () => {
    expect(resolveTransactionalFromEmail('gmail', {
      gmail_email: 'noreply@gmail.com',
      from_email: 'no-reply@serapod2u.com',
    })).toBe('noreply@gmail.com')
  })

  it('uses the configured From for SMTP', () => {
    expect(resolveTransactionalFromEmail('smtp', {
      from_email: 'no-reply@serapod2u.com',
      gmail_email: 'noreply@gmail.com',
    })).toBe('no-reply@serapod2u.com')
  })
})

describe('transactionalMessageId', () => {
  it('uses the sender domain', () => {
    expect(transactionalMessageId('no-reply@serapod2u.com')).toMatch(/^<[0-9a-f]+@serapod2u\.com>$/)
  })
})
