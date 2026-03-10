/**
 * PG Auth Sign-Up API Route
 * POST /api/pg-auth/signup
 */

import { NextRequest, NextResponse } from 'next/server'
import { signUp, AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME_EXPORT, getAuthCookieOptions, getRefreshCookieOptions } from '@/lib/db/pg-auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, phone, options } = body

    if (!email || !password) {
      return NextResponse.json(
        { data: { user: null, session: null }, error: { message: 'Email and password required' } },
        { status: 400 }
      )
    }

    const result = await signUp(
      { email, password, phone },
      { data: options?.data }
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
