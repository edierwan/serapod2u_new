import { NextRequest, NextResponse } from 'next/server'
import { publicOriginFromRequest } from '@/lib/http/public-origin'
import {
  instagramAuthorizeUrl,
  isCustomSocialProvider,
  newOAuthState,
  SOCIAL_OAUTH_STATE_COOKIE,
  tiktokAuthorizeUrl,
} from '@/lib/auth/social-oauth'
import { sanitizeOutdoorReturnPath } from '@/lib/outdoor/auth-return'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params
  const origin = publicOriginFromRequest(request)
  const rawNext = request.nextUrl.searchParams.get('next')
  const nextPath = rawNext?.startsWith('/outdoor')
    ? sanitizeOutdoorReturnPath(rawNext)
    : rawNext?.startsWith('/') && !rawNext.startsWith('//')
      ? rawNext
      : '/outdoor'

  if (!isCustomSocialProvider(provider)) {
    return NextResponse.redirect(new URL(`/outdoor/login?error=unsupported_provider`, origin))
  }

  try {
    const state = newOAuthState()
    const authorize =
      provider === 'tiktok' ? tiktokAuthorizeUrl(origin, state) : instagramAuthorizeUrl(origin, state)
    const res = NextResponse.redirect(authorize)
    res.cookies.set(
      SOCIAL_OAUTH_STATE_COOKIE,
      JSON.stringify({ state, provider, next: nextPath }),
      { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 600, secure: origin.startsWith('https') },
    )
    return res
  } catch (err: any) {
    const login = nextPath.startsWith('/outdoor') ? '/outdoor/login' : '/login'
    const url = new URL(login, origin)
    url.searchParams.set('error', 'oauth_failed')
    url.searchParams.set('message', err?.message || `Could not continue with ${provider}.`)
    url.searchParams.set('next', nextPath)
    return NextResponse.redirect(url)
  }
}
