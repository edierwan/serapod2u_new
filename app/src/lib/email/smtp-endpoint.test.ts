import { describe, expect, it } from 'vitest'
import { parseSmtpHostOverrides, resolveSmtpEndpoint, SmtpEndpointError } from './smtp-endpoint'

describe('SMTP endpoint resolution', () => {
  it('uses an IP override while retaining the SMTP TLS hostname', async () => {
    const endpoint = await resolveSmtpEndpoint(
      'mail.getouch.co',
      'mail.getouch.co=72.62.253.182',
      async () => [{ address: '127.0.1.1', family: 4 }]
    )

    expect(endpoint).toEqual({
      smtpHost: 'mail.getouch.co',
      connectHost: '72.62.253.182',
      tlsServername: 'mail.getouch.co',
      resolvedAddresses: ['72.62.253.182'],
      overrideApplied: true
    })
  })

  it('rejects loopback DNS when there is no valid override', async () => {
    await expect(resolveSmtpEndpoint(
      'mail.getouch.co',
      '',
      async () => [{ address: '127.0.1.1', family: 4 }]
    )).rejects.toBeInstanceOf(SmtpEndpointError)
  })

  it('ignores malformed and loopback override targets', () => {
    expect(parseSmtpHostOverrides('bad,mail.getouch.co=127.0.1.1,other.example=not-an-ip')).toEqual(new Map())
  })
})
