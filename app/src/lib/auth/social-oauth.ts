import { randomBytes } from 'crypto'

export const SOCIAL_OAUTH_STATE_COOKIE = 'social_oauth_state'

export type CustomSocialProvider = 'tiktok' | 'instagram'

export function isCustomSocialProvider(value: string): value is CustomSocialProvider {
  return value === 'tiktok' || value === 'instagram'
}

export function syntheticSocialEmail(provider: string, providerUserId: string) {
  const id = String(providerUserId || 'user').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) || 'user'
  return `${provider}.${id}@oauth.serapod2u.com`
}

export function newOAuthState() {
  return randomBytes(24).toString('hex')
}

export function socialOAuthRedirectUri(origin: string, provider: CustomSocialProvider) {
  return `${origin.replace(/\/+$/, '')}/api/auth/oauth/${provider}/callback`
}

export function tiktokAuthorizeUrl(origin: string, state: string) {
  const clientKey = String(process.env.TIKTOK_CLIENT_KEY || '').trim()
  if (!clientKey) throw new Error('TikTok login is not configured yet.')
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/')
  url.searchParams.set('client_key', clientKey)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'user.info.basic')
  url.searchParams.set('redirect_uri', socialOAuthRedirectUri(origin, 'tiktok'))
  url.searchParams.set('state', state)
  return url.toString()
}

export function instagramAuthorizeUrl(origin: string, state: string) {
  const clientId = String(process.env.INSTAGRAM_CLIENT_ID || '').trim()
  if (!clientId) throw new Error('Instagram login is not configured yet.')
  const url = new URL('https://www.instagram.com/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', socialOAuthRedirectUri(origin, 'instagram'))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'instagram_business_basic')
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeTikTokCode(origin: string, code: string) {
  const clientKey = String(process.env.TIKTOK_CLIENT_KEY || '').trim()
  const clientSecret = String(process.env.TIKTOK_CLIENT_SECRET || '').trim()
  if (!clientKey || !clientSecret) throw new Error('TikTok login is not configured yet.')

  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: socialOAuthRedirectUri(origin, 'tiktok'),
    }),
  })
  const tokenJson = await tokenRes.json().catch(() => null)
  const accessToken = tokenJson?.access_token || tokenJson?.data?.access_token
  if (!tokenRes.ok || !accessToken) {
    throw new Error(tokenJson?.error_description || tokenJson?.error || 'TikTok token exchange failed')
  }

  const userRes = await fetch(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const userJson = await userRes.json().catch(() => null)
  const user = userJson?.data?.user || userJson?.data || {}
  const providerUserId = String(user.open_id || tokenJson.open_id || tokenJson?.data?.open_id || '')
  if (!providerUserId) throw new Error('TikTok did not return a user id')

  return {
    provider: 'tiktok' as const,
    providerUserId,
    email: null as string | null,
    fullName: String(user.display_name || ''),
    avatarUrl: String(user.avatar_url || ''),
  }
}

export async function exchangeInstagramCode(origin: string, code: string) {
  const clientId = String(process.env.INSTAGRAM_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.INSTAGRAM_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) throw new Error('Instagram login is not configured yet.')

  const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: socialOAuthRedirectUri(origin, 'instagram'),
      code,
    }),
  })
  const tokenJson = await tokenRes.json().catch(() => null)
  const accessToken =
    tokenJson?.access_token ||
    tokenJson?.data?.[0]?.access_token
  const userId = String(tokenJson?.user_id || tokenJson?.data?.[0]?.user_id || '')
  if (!tokenRes.ok || !accessToken) {
    throw new Error(tokenJson?.error_message || tokenJson?.error?.message || 'Instagram token exchange failed')
  }

  const userRes = await fetch(
    `https://graph.instagram.com/me?fields=id,username,name,profile_picture_url&access_token=${encodeURIComponent(accessToken)}`,
  )
  const user = await userRes.json().catch(() => ({}))
  const providerUserId = String(user.id || userId || '')
  if (!providerUserId) throw new Error('Instagram did not return a user id')

  return {
    provider: 'instagram' as const,
    providerUserId,
    email: null as string | null,
    fullName: String(user.name || user.username || ''),
    avatarUrl: String(user.profile_picture_url || ''),
  }
}
