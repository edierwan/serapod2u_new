/**
 * PG Auth Sign-Out API Route
 * POST /api/pg-auth/signout
 */

import { NextRequest, NextResponse } from 'next/server'
import { signOut, AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME_EXPORT } from '@/lib/db/pg-auth'

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
    if (token) {
      await signOut(token)
    }

    const response = NextResponse.json({ error: null })
    response.cookies.delete(AUTH_COOKIE_NAME)
    response.cookies.delete(REFRESH_COOKIE_NAME_EXPORT)

    return response
  } catch {
    const response = NextResponse.json({ error: null })
    response.cookies.delete(AUTH_COOKIE_NAME)
    response.cookies.delete(REFRESH_COOKIE_NAME_EXPORT)
    return response
  }
}
