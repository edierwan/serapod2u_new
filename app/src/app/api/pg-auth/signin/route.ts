/**
 * PG Auth Sign-In API Route
 * POST /api/pg-auth/signin
 */

import { NextRequest, NextResponse } from 'next/server'
import { signInWithPassword, AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME_EXPORT, getAuthCookieOptions, getRefreshCookieOptions } from '@/lib/db/pg-auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, phone, password } = body

    if (!password || (!email && !phone)) {
      return NextResponse.json(
        { data: { user: null, session: null }, error: { message: 'Email/phone and password required' } },
        { status: 400 }
      )
    }

    const result = await signInWithPassword(
      { email, phone, password },
      {
        userAgent: request.headers.get('user-agent') || undefined,
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
      }
    )

    if (result.error) {
      return NextResponse.json(result, { status: result.error.status || 400 })
    }

    const secure = process.env.NODE_ENV === 'production'
    const response = NextResponse.json(result)
    response.cookies.set(AUTH_COOKIE_NAME, result.data.session.access_token, getAuthCookieOptions(secure))
    response.cookies.set(REFRESH_COOKIE_NAME_EXPORT, result.data.session.refresh_token, getRefreshCookieOptions(secure))

    return response
  } catch (err: any) {
    return NextResponse.json(
      { data: { user: null, session: null }, error: { message: err.message } },
      { status: 500 }
    )
  }
}
