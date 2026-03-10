/**
 * PG Auth Edge — JWT validation for Next.js middleware (Edge Runtime).
 *
 * This module only uses jose (Edge-compatible) for JWT verification.
 * No pg module, no bcrypt — purely stateless token validation.
 */

import { jwtVerify, type JWTPayload } from 'jose'

const COOKIE_NAME = 'pg-auth-token'

function getJwtSecret(): Uint8Array {
  const secret = process.env.PG_JWT_SECRET
  if (!secret) {
    throw new Error('[PgAuthEdge] PG_JWT_SECRET environment variable is required')
  }
  return new TextEncoder().encode(secret)
}

export interface EdgeAuthUser {
  id: string
  email: string
  phone: string
  role: string
  aud: string
  app_metadata: Record<string, any>
  user_metadata: Record<string, any>
}

/**
 * Validate JWT from cookie and return user info.
 * Purely stateless — no DB calls.
 */
export async function getEdgeUser(cookieValue: string | undefined): Promise<{
  data: { user: EdgeAuthUser | null }
  error: { message: string; status?: number } | null
}> {
  if (!cookieValue) {
    return { data: { user: null }, error: null }
  }

  try {
    const { payload } = await jwtVerify(cookieValue, getJwtSecret(), {
      issuer: 'pg-auth',
    })

    return {
      data: {
        user: {
          id: payload.sub || '',
          email: (payload.email as string) || '',
          phone: (payload.phone as string) || '',
          role: (payload.role as string) || 'authenticated',
          aud: (payload.aud as string) || 'authenticated',
          app_metadata: (payload.app_metadata as Record<string, any>) || {},
          user_metadata: (payload.user_metadata as Record<string, any>) || {},
        },
      },
      error: null,
    }
  } catch (err: any) {
    const isExpired = err?.code === 'ERR_JWT_EXPIRED'
    return {
      data: { user: null },
      error: {
        message: isExpired ? 'Token has expired' : 'Invalid token',
        status: 401,
      },
    }
  }
}

export { COOKIE_NAME as PG_AUTH_COOKIE_NAME }
