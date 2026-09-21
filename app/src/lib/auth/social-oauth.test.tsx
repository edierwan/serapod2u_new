import { describe, expect, it } from 'vitest'
import { isCustomSocialProvider, syntheticSocialEmail } from './social-oauth'

describe('custom social oauth helpers', () => {
  it('builds a stable synthetic email for providers without email', () => {
    expect(syntheticSocialEmail('tiktok', 'afd97af1-b87b-48b9-ac98')).toBe(
      'tiktok.afd97af1b87b48b9ac98@oauth.serapod2u.com',
    )
    expect(isCustomSocialProvider('instagram')).toBe(true)
    expect(isCustomSocialProvider('google')).toBe(false)
  })
})
