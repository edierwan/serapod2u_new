import { NextRequest, NextResponse } from 'next/server'
import { publicOriginFromRequest } from '@/lib/http/public-origin'
import {
  exchangeInstagramCode,
  exchangeTikTokCode,
  isCustomSocialProvider,
  SOCIAL_OAUTH_STATE_COOKIE,
  type CustomSocialProvider,
} from '@/lib/auth/social-oauth'
import { createSessionForSocialProfile, socialPostLoginPath } from '@/server/auth/create-social-session'
import { OUTDOOR_OAUTH_NEXT_COOKIE, sanitizeOutdoorReturnPath } from '@/lib/outdoor/auth-return'

export const dynamic = 'force-dynamic'

function failRedirect(origin: string, nextPath: string, message: string) {
  const login = nextPath.startsWith('/outdoor') ? '/outdoor/login' : '/login'
  const url = new URL(login, origin)
  url.searchParams.set('error', 'oauth_failed')
  url.searchParams.set('message', message)
  if (nextPath.startsWith('/')) url.searchParams.set('next', nextPath)
  return NextResponse.redirect(url)
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params
  const origin = publicOriginFromRequest(request)
  let nextPath = '/outdoor'

  try {
    const rawState = request.cookies.get(SOCIAL_OAUTH_STATE_COOKIE)?.value
    const parsed = rawState ? JSON.parse(rawState) as { state?: string; provider?: string; next?: string } : null
    const expectedState = parsed?.state
    const nextFromCookie = parsed?.next
    if (nextFromCookie?.startsWith('/outdoor')) nextPath = sanitizeOutdoorReturnPath(nextFromCookie)
    else if (nextFromCookie?.startsWith('/') && !nextFromCookie.startsWith('//')) nextPath = nextFromCookie

    if (!isCustomSocialProvider(provider)) {
      return failRedirect(origin, nextPath, 'Unsupported social login.')
    }

    const errorParam = request.nextUrl.searchParams.get('error')
    if (errorParam) {
      return failRedirect(origin, nextPath, request.nextUrl.searchParams.get('error_description') || errorParam)
    }

    const code = request.nextUrl.searchParams.get('code')
    const state = request.nextUrl.searchParams.get('state')
    if (!code) return failRedirect(origin, nextPath, 'Could not finish social login.')
    if (!expectedState || state !== expectedState) {
      return failRedirect(origin, nextPath, 'Social login expired. Try again.')
    }
    if (parsed?.provider && parsed.provider !== provider) {
      return failRedirect(origin, nextPath, 'Social login mismatch. Try again.')
    }

    const profile =
      (provider as CustomSocialProvider) === 'tiktok'
        ? await exchangeTikTokCode(origin, code)
        : await exchangeInstagramCode(origin, code)

    await createSessionForSocialProfile(profile)
    const redirectTo = await socialPostLoginPath(nextPath)
    const res = NextResponse.redirect(new URL(redirectTo, origin))
    res.cookies.set(SOCIAL_OAUTH_STATE_COOKIE, '', { path: '/', maxAge: 0 })
    res.cookies.set(OUTDOOR_OAUTH_NEXT_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  } catch (err: any) {
    console.error('[social-oauth] callback failed:', err)
    return failRedirect(origin, nextPath, err?.message || 'Could not finish social login.')
  }
}
