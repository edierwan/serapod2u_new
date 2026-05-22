import type { LandingPageAttribution, LandingPageEventType } from '@/lib/landing-pages/types'

export const LANDING_ATTRIBUTION_STORAGE_KEY = 'serapod2u_landing_attribution'
const LANDING_SESSION_PREFIX = 'serapod2u_lp_session:'

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 300) : ''
}

export function getLandingPageSessionId(slug: string): string {
  if (typeof window === 'undefined') return ''

  const key = `${LANDING_SESSION_PREFIX}${slug}`
  const existing = window.localStorage.getItem(key)
  if (existing) return existing

  const next = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const random = Math.floor(Math.random() * 16)
      const value = char === 'x' ? random : (random & 0x3) | 0x8
      return value.toString(16)
    })
  window.localStorage.setItem(key, next)
  return next
}

export function saveLandingPageAttribution(attribution: LandingPageAttribution) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LANDING_ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution))
}

export function getStoredLandingPageAttribution(): LandingPageAttribution | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(LANDING_ATTRIBUTION_STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    if (!parsed?.landingPageId || !parsed?.landingPageSlug || !parsed?.landingPageSessionId) return null
    return parsed
  } catch {
    return null
  }
}

export function buildLandingPageAttribution(input: {
  landingPageId: string
  landingPageSlug: string
  landingPageSessionId: string
  sourceCode?: string
  searchParams: URLSearchParams
  referrer?: string
}): LandingPageAttribution {
  let referrerDomain = ''
  try {
    referrerDomain = input.referrer ? new URL(input.referrer).hostname : ''
  } catch {
    referrerDomain = ''
  }

  return {
    landingPageId: input.landingPageId,
    landingPageSlug: input.landingPageSlug,
    landingPageSessionId: input.landingPageSessionId,
    sourceCode: safeString(input.searchParams.get('source_code') || input.sourceCode || ''),
    utmSource: safeString(input.searchParams.get('utm_source') || ''),
    utmMedium: safeString(input.searchParams.get('utm_medium') || ''),
    utmCampaign: safeString(input.searchParams.get('utm_campaign') || ''),
    utmContent: safeString(input.searchParams.get('utm_content') || ''),
    utmTerm: safeString(input.searchParams.get('utm_term') || ''),
    fbclid: safeString(input.searchParams.get('fbclid') || ''),
    referrerDomain: safeString(referrerDomain),
  }
}

export function trackLandingPageEvent(eventType: LandingPageEventType, payload: Record<string, unknown>) {
  if (typeof window === 'undefined') return

  const body = JSON.stringify({ eventType, ...payload })
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    navigator.sendBeacon('/api/landing-pages/events', blob)
    return
  }

  fetch('/api/landing-pages/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}