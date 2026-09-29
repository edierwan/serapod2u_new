/** Public address of the Outdoor store. */
export const OUTDOOR_SITE_DEFAULT = 'https://outdoor.serapod2u.com'

/** Hosts that serve the Outdoor store at their root. Shared by middleware, server routes and the browser. */
export const OUTDOOR_HOSTS: readonly string[] = [
  'outdoor.serapod2u.com',
  'www.outdoor.serapod2u.com',
  'outdoor.serapod.com',
  'www.outdoor.serapod.com',
  'outdoor.localhost',
]

export function isOutdoorHost(hostname: string | null | undefined) {
  const host = String(hostname || '').trim().toLowerCase().split(':')[0]
  return Boolean(host) && OUTDOOR_HOSTS.includes(host)
}
