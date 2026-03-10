/**
 * PG Auth User API Route
 * GET  /api/pg-auth/user   — get current user
 * PATCH /api/pg-auth/user  — update current user
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromToken, AUTH_COOKIE_NAME, adminAuth } from '@/lib/db/pg-auth'
import { verifyAccessToken } from '@/lib/db/pg-auth'

export async function GET(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ data: { user: null }, error: null })
  }

  const result = await getUserFromToken(token)
  return NextResponse.json(result)
}

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json(
      { data: { user: null }, error: { message: 'Not authenticated' } },
      { status: 401 }
    )
  }

  const payload = await verifyAccessToken(token)
  if (!payload?.sub) {
    return NextResponse.json(
      { data: { user: null }, error: { message: 'Invalid token' } },
      { status: 401 }
    )
  }

  const body = await request.json()
  const result = await adminAuth.updateUserById(payload.sub, {
    email: body.email,
    password: body.password,
    user_metadata: body.data,
  })

  return NextResponse.json(result)
}
