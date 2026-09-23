import { describe, expect, it } from 'vitest'
import { isCustomSocialProvider, socialAccountLabel, syntheticSocialEmail } from './social-oauth'

describe('custom social oauth helpers', () => {
  it('builds a stable synthetic email for providers without email', () => {
    expect(syntheticSocialEmail('tiktok', 'afd97af1-b87b-48b9-ac98')).toBe(
      'tiktok.afd97af1b87b48b9ac98@oauth.serapod2u.com',
    )
    expect(isCustomSocialProvider('instagram')).toBe(true)
    expect(isCustomSocialProvider('twitter')).toBe(true)
    expect(isCustomSocialProvider('google')).toBe(false)
  })

  it('shows the X username instead of the internal oauth email', () => {
    expect(socialAccountLabel('twitter.1152572059@oauth.serapod2u.com', 'allamsalamah')).toBe('@allamsalamah')
    expect(socialAccountLabel('admin@dev.com', 'allamsalamah')).toBe('admin@dev.com')
  })
})
