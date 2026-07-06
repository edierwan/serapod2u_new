import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

type LookupAddress = { address: string; family: number }
type LookupAll = (hostname: string) => Promise<LookupAddress[]>

export type SmtpEndpoint = {
  smtpHost: string
  connectHost: string
  tlsServername: string
  resolvedAddresses: string[]
  overrideApplied: boolean
}

export class SmtpEndpointError extends Error {
  constructor(message: string, public readonly endpoint: SmtpEndpoint) {
    super(message)
    this.name = 'SmtpEndpointError'
  }
}

export const isLoopbackAddress = (address: string) => {
  if (isIP(address) === 4) return address.startsWith('127.')
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase()
    return normalized === '::1' || normalized.startsWith('::ffff:127.')
  }
  return false
}

export const parseSmtpHostOverrides = (value = process.env.SMTP_HOST_OVERRIDES || '') => {
  const overrides = new Map<string, string>()

  for (const entry of value.split(/[;,\n]/)) {
    const separator = entry.indexOf('=')
    if (separator < 1) continue

    const smtpHost = entry.slice(0, separator).trim().toLowerCase()
    const connectHost = entry.slice(separator + 1).trim()
    if (!smtpHost || isIP(connectHost) === 0 || isLoopbackAddress(connectHost)) continue
    overrides.set(smtpHost, connectHost)
  }

  return overrides
}

export async function resolveSmtpEndpoint(
  smtpHostValue: string,
  overridesValue = process.env.SMTP_HOST_OVERRIDES || '',
  lookupAll: LookupAll = hostname => lookup(hostname, { all: true, verbatim: true })
): Promise<SmtpEndpoint> {
  const smtpHost = smtpHostValue.trim()
  const override = parseSmtpHostOverrides(overridesValue).get(smtpHost.toLowerCase())
  const connectHost = override || smtpHost
  const addresses = isIP(connectHost)
    ? [{ address: connectHost, family: isIP(connectHost) }]
    : await lookupAll(connectHost)
  const resolvedAddresses = [...new Set(addresses.map(({ address }) => address))]
  const endpoint = {
    smtpHost,
    connectHost,
    tlsServername: smtpHost,
    resolvedAddresses,
    overrideApplied: Boolean(override)
  }

  if (resolvedAddresses.some(isLoopbackAddress)) {
    throw new SmtpEndpointError(
      `SMTP connect host ${connectHost} resolves to a loopback address. Configure container DNS or a valid SMTP_HOST_OVERRIDES entry.`,
      endpoint
    )
  }

  return endpoint
}
