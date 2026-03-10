/**
 * PG Auth Session API Route
 * GET /api/pg-auth/session — get current session
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromToken, verifyAccessToken, AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME_EXPORT } from '@/lib/db/pg-auth'

export async function GET(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ data: { session: null }, error: null })
  }

  const payload = await verifyAccessToken(token)
  if (!payload) {
    return NextResponse.json({ data: { session: null }, error: { message: 'Invalid token' } })
  }

  const userResult = await getUserFromToken(token)
  if (!userResult.data.user) {
    return NextResponse.json({ data: { session: null }, error: userResult.error })
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME_EXPORT)?.value
  return NextResponse.json({
    data: {
      session: {
        access_token: token,
        refresh_token: refreshToken || '',
        expires_in: Math.max(0, (payload.exp || 0) - Math.floor(Date.now() / 1000)),
        expires_at: payload.exp || 0,
        token_type: 'bearer',
        user: userResult.data.user,
      },
    },
    error: null,
  })
}
