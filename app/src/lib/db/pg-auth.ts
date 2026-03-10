/**
 * PostgreSQL Auth Adapter — Supabase Auth-Compatible
 *
 * Replaces Supabase Auth with direct PostgreSQL queries to auth.users.
 * Uses bcryptjs for password verification and jose for JWT tokens.
 *
 * Server-side only. Uses Node.js runtime (not Edge).
 * For middleware (Edge Runtime), use pg-auth-edge.ts instead.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import type { Pool } from 'pg'
import { getPool } from './pg-adapter'

// ── JWT Configuration ────────────────────────────────────────────────────

const JWT_EXPIRY = '1h'
const REFRESH_EXPIRY_DAYS = 30
const COOKIE_NAME = 'pg-auth-token'
const REFRESH_COOKIE_NAME = 'pg-refresh-token'

function getJwtSecret(): Uint8Array {
  const secret = process.env.PG_JWT_SECRET
  if (!secret) {
    throw new Error('[PgAuth] PG_JWT_SECRET environment variable is required')
  }
  return new TextEncoder().encode(secret)
}

// ── Types ────────────────────────────────────────────────────────────────

export interface PgAuthUser {
  id: string
  aud: string
  role: string
  email: string
  phone: string
  email_confirmed_at: string | null
  phone_confirmed_at: string | null
  confirmed_at: string | null
  last_sign_in_at: string | null
  created_at: string
  updated_at: string
  app_metadata: Record<string, any>
  user_metadata: Record<string, any>
  is_anonymous: boolean
}

export interface PgAuthSession {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at: number
  token_type: string
  user: PgAuthUser
}

interface AuthResult<T = any> {
  data: T
  error: { message: string; status?: number } | null
}

// ── JWT Helpers ──────────────────────────────────────────────────────────

export async function createAccessToken(user: PgAuthUser, sessionId: string): Promise<string> {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    phone: user.phone,
    role: user.role || 'authenticated',
    aud: user.aud || 'authenticated',
    session_id: sessionId,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .setIssuer('pg-auth')
    .sign(getJwtSecret())
}

export async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: 'pg-auth',
    })
    return payload
  } catch {
    return null
  }
}

function generateRefreshToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// ── Password Hashing ─────────────────────────────────────────────────────

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Lazy-load bcryptjs to keep module lightweight
  const bcrypt = require('bcryptjs') as typeof import('bcryptjs')
  return bcrypt.compare(password, hash)
}

async function hashPassword(password: string): Promise<string> {
  const bcrypt = require('bcryptjs') as typeof import('bcryptjs')
  return bcrypt.hash(password, 10)
}

// ── User Mapping ─────────────────────────────────────────────────────────

function mapAuthUser(row: any): PgAuthUser {
  return {
    id: row.id,
    aud: row.aud || 'authenticated',
    role: row.role || 'authenticated',
    email: row.email || '',
    phone: row.phone || '',
    email_confirmed_at: row.email_confirmed_at,
    phone_confirmed_at: row.phone_confirmed_at,
    confirmed_at: row.confirmed_at,
    last_sign_in_at: row.last_sign_in_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    app_metadata: row.raw_app_meta_data || {},
    user_metadata: row.raw_user_meta_data || {},
    is_anonymous: row.is_anonymous || false,
  }
}

// ── Session Management ───────────────────────────────────────────────────

async function createSession(pool: Pool, userId: string, userAgent?: string, ip?: string): Promise<{ sessionId: string; refreshToken: string }> {
  const sessionId = crypto.randomUUID()
  const refreshToken = generateRefreshToken()

  await pool.query(
    `INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal, user_agent, ip)
     VALUES ($1, $2, NOW(), NOW(), 'aal1', $3, $4)`,
    [sessionId, userId, userAgent || null, ip || null]
  )

  await pool.query(
    `INSERT INTO auth.refresh_tokens (token, user_id, session_id, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [refreshToken, userId, sessionId]
  )

  return { sessionId, refreshToken }
}

async function invalidateSession(pool: Pool, sessionId: string): Promise<void> {
  await pool.query(`UPDATE auth.refresh_tokens SET revoked = true WHERE session_id = $1`, [sessionId])
  await pool.query(`DELETE FROM auth.sessions WHERE id = $1`, [sessionId])
}

// ── Core Auth Functions ──────────────────────────────────────────────────

/**
 * Sign in with email + password.
 * Verifies against auth.users.encrypted_password (bcrypt).
 */
export async function signInWithPassword(
  credentials: { email?: string; phone?: string; password: string },
  options?: { userAgent?: string; ip?: string }
): Promise<AuthResult<{ user: PgAuthUser; session: PgAuthSession }>> {
  const pool = getPool()

  let query: string
  let params: any[]

  if (credentials.email) {
    query = `SELECT * FROM auth.users WHERE email = $1 AND deleted_at IS NULL`
    params = [credentials.email.toLowerCase().trim()]
  } else if (credentials.phone) {
    const phone = credentials.phone.replace(/\s/g, '')
    query = `SELECT * FROM auth.users WHERE phone = $1 AND deleted_at IS NULL`
    params = [phone]
  } else {
    return { data: { user: null as any, session: null as any }, error: { message: 'Email or phone required', status: 400 } }
  }

  const { rows } = await pool.query(query, params)
  if (rows.length === 0) {
    return { data: { user: null as any, session: null as any }, error: { message: 'Invalid login credentials', status: 400 } }
  }

  const row = rows[0]

  if (!row.encrypted_password) {
    return { data: { user: null as any, session: null as any }, error: { message: 'Invalid login credentials', status: 400 } }
  }

  const valid = await verifyPassword(credentials.password, row.encrypted_password)
  if (!valid) {
    return { data: { user: null as any, session: null as any }, error: { message: 'Invalid login credentials', status: 400 } }
  }

  // Check banned
  if (row.banned_until && new Date(row.banned_until) > new Date()) {
    return { data: { user: null as any, session: null as any }, error: { message: 'User is banned', status: 403 } }
  }

  const user = mapAuthUser(row)

  // Create session
  const { sessionId, refreshToken } = await createSession(pool, user.id, options?.userAgent, options?.ip)

  // Update last_sign_in_at
  await pool.query(`UPDATE auth.users SET last_sign_in_at = NOW(), updated_at = NOW() WHERE id = $1`, [user.id])

  const accessToken = await createAccessToken(user, sessionId)
  const expiresAt = Math.floor(Date.now() / 1000) + 3600

  const session: PgAuthSession = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3600,
    expires_at: expiresAt,
    token_type: 'bearer',
    user,
  }

  return { data: { user, session }, error: null }
}

/**
 * Get the current user from a JWT access token.
 * Fast path: just decodes the JWT (no DB call).
 * Full path: queries auth.users if fresh data is needed.
 */
export async function getUserFromToken(token: string, opts?: { fresh?: boolean }): Promise<AuthResult<{ user: PgAuthUser | null }>> {
  const payload = await verifyAccessToken(token)
  if (!payload || !payload.sub) {
    return { data: { user: null }, error: { message: 'Invalid or expired token', status: 401 } }
  }

  if (!opts?.fresh) {
    // Fast path: reconstruct user from JWT claims
    const user: PgAuthUser = {
      id: payload.sub,
      aud: (payload.aud as string) || 'authenticated',
      role: (payload.role as string) || 'authenticated',
      email: (payload.email as string) || '',
      phone: (payload.phone as string) || '',
      email_confirmed_at: null,
      phone_confirmed_at: null,
      confirmed_at: null,
      last_sign_in_at: null,
      created_at: '',
      updated_at: '',
      app_metadata: (payload.app_metadata as Record<string, any>) || {},
      user_metadata: (payload.user_metadata as Record<string, any>) || {},
      is_anonymous: false,
    }
    return { data: { user }, error: null }
  }

  // Full path: query DB for fresh data
  const pool = getPool()
  const { rows } = await pool.query(`SELECT * FROM auth.users WHERE id = $1 AND deleted_at IS NULL`, [payload.sub])
  if (rows.length === 0) {
    return { data: { user: null }, error: { message: 'User not found', status: 404 } }
  }

  return { data: { user: mapAuthUser(rows[0]) }, error: null }
}

/**
 * Refresh an expired session using a refresh token.
 */
export async function refreshSession(refreshTokenStr: string): Promise<AuthResult<{ user: PgAuthUser; session: PgAuthSession }>> {
  const pool = getPool()

  const { rows: tokenRows } = await pool.query(
    `SELECT rt.*, s.user_id FROM auth.refresh_tokens rt
     JOIN auth.sessions s ON s.id = rt.session_id
     WHERE rt.token = $1 AND rt.revoked = false`,
    [refreshTokenStr]
  )

  if (tokenRows.length === 0) {
    return { data: { user: null as any, session: null as any }, error: { message: 'Invalid refresh token', status: 401 } }
  }

  const tokenRow = tokenRows[0]
  const userId = tokenRow.user_id

  // Check refresh token age
  const createdAt = new Date(tokenRow.created_at)
  const maxAge = REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  if (Date.now() - createdAt.getTime() > maxAge) {
    await pool.query(`UPDATE auth.refresh_tokens SET revoked = true WHERE id = $1`, [tokenRow.id])
    return { data: { user: null as any, session: null as any }, error: { message: 'Refresh token expired', status: 401 } }
  }

  // Revoke old token, create new one
  await pool.query(`UPDATE auth.refresh_tokens SET revoked = true WHERE id = $1`, [tokenRow.id])

  const newRefreshToken = generateRefreshToken()
  await pool.query(
    `INSERT INTO auth.refresh_tokens (token, user_id, session_id, parent, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [newRefreshToken, userId, tokenRow.session_id, refreshTokenStr]
  )

  // Get fresh user data
  const { rows: userRows } = await pool.query(`SELECT * FROM auth.users WHERE id = $1`, [userId])
  if (userRows.length === 0) {
    return { data: { user: null as any, session: null as any }, error: { message: 'User not found', status: 404 } }
  }

  const user = mapAuthUser(userRows[0])
  const accessToken = await createAccessToken(user, tokenRow.session_id)
  const expiresAt = Math.floor(Date.now() / 1000) + 3600

  return {
    data: {
      user,
      session: {
        access_token: accessToken,
        refresh_token: newRefreshToken,
        expires_in: 3600,
        expires_at: expiresAt,
        token_type: 'bearer',
        user,
      },
    },
    error: null,
  }
}

/**
 * Sign out — invalidate session and clear tokens.
 */
export async function signOut(accessToken: string): Promise<{ error: null | { message: string } }> {
  const payload = await verifyAccessToken(accessToken)
  if (payload?.session_id) {
    const pool = getPool()
    await invalidateSession(pool, payload.session_id as string)
  }
  return { error: null }
}

/**
 * Sign up a new user.
 */
export async function signUp(
  credentials: { email: string; password: string; phone?: string },
  metadata?: { data?: Record<string, any> }
): Promise<AuthResult<{ user: PgAuthUser; session: PgAuthSession }>> {
  const pool = getPool()
  const email = credentials.email.toLowerCase().trim()
  const phone = credentials.phone?.replace(/\s/g, '') || null

  // Check if user exists
  const { rows: existing } = await pool.query(
    `SELECT id FROM auth.users WHERE email = $1 AND deleted_at IS NULL`,
    [email]
  )
  if (existing.length > 0) {
    return { data: { user: null as any, session: null as any }, error: { message: 'User already registered', status: 422 } }
  }

  const hashedPassword = await hashPassword(credentials.password)
  const userId = crypto.randomUUID()
  const now = new Date().toISOString()
  const userMetadata = metadata?.data || {}

  await pool.query(
    `INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, phone, raw_app_meta_data, raw_user_meta_data,
      is_super_admin, created_at, updated_at, is_sso_user, is_anonymous
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
      $2, $3, $4, $5, $6, $7, false, $4, $4, false, false
    )`,
    [userId, email, hashedPassword, now, phone, JSON.stringify({ provider: 'email', providers: ['email'] }), JSON.stringify(userMetadata)]
  )

  // Create identity record
  await pool.query(
    `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'email', $4, $4, $4)`,
    [userId, userId, JSON.stringify({ sub: userId, email, ...userMetadata }), now]
  )

  // Auto sign in
  const result = await signInWithPassword({ email, password: credentials.password })
  return result
}

// ── Admin Operations ─────────────────────────────────────────────────────

export const adminAuth = {
  async getUserById(userId: string): Promise<AuthResult<{ user: PgAuthUser | null }>> {
    const pool = getPool()
    const { rows } = await pool.query(`SELECT * FROM auth.users WHERE id = $1`, [userId])
    if (rows.length === 0) {
      return { data: { user: null }, error: { message: 'User not found', status: 404 } }
    }
    return { data: { user: mapAuthUser(rows[0]) }, error: null }
  },

  async createUser(data: {
    email: string
    password: string
    phone?: string
    email_confirm?: boolean
    user_metadata?: Record<string, any>
    app_metadata?: Record<string, any>
  }): Promise<AuthResult<{ user: PgAuthUser }>> {
    const pool = getPool()
    const email = data.email.toLowerCase().trim()
    const hashedPassword = await hashPassword(data.password)
    const userId = crypto.randomUUID()
    const now = new Date().toISOString()

    await pool.query(
      `INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, phone, raw_app_meta_data, raw_user_meta_data,
        is_super_admin, created_at, updated_at, is_sso_user, is_anonymous
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
        $2, $3, $4, $5, $6, $7, false, $8, $8, false, false
      )`,
      [
        userId, email, hashedPassword,
        data.email_confirm ? now : null,
        data.phone || null,
        JSON.stringify(data.app_metadata || { provider: 'email', providers: ['email'] }),
        JSON.stringify(data.user_metadata || {}),
        now,
      ]
    )

    // Create identity
    await pool.query(
      `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'email', $4, $4, $4)`,
      [userId, userId, JSON.stringify({ sub: userId, email, ...(data.user_metadata || {}) }), now]
    )

    const { rows } = await pool.query(`SELECT * FROM auth.users WHERE id = $1`, [userId])
    return { data: { user: mapAuthUser(rows[0]) }, error: null }
  },

  async updateUserById(userId: string, data: {
    email?: string
    password?: string
    phone?: string
    email_confirm?: boolean
    user_metadata?: Record<string, any>
    app_metadata?: Record<string, any>
    ban_duration?: string
  }): Promise<AuthResult<{ user: PgAuthUser }>> {
    const pool = getPool()
    const updates: string[] = []
    const params: any[] = []
    let paramIdx = 1

    if (data.email) {
      updates.push(`email = $${paramIdx++}`)
      params.push(data.email.toLowerCase().trim())
    }
    if (data.password) {
      const hashed = await hashPassword(data.password)
      updates.push(`encrypted_password = $${paramIdx++}`)
      params.push(hashed)
    }
    if (data.phone !== undefined) {
      updates.push(`phone = $${paramIdx++}`)
      params.push(data.phone || null)
    }
    if (data.email_confirm) {
      updates.push(`email_confirmed_at = NOW()`)
    }
    if (data.user_metadata) {
      updates.push(`raw_user_meta_data = raw_user_meta_data || $${paramIdx++}::jsonb`)
      params.push(JSON.stringify(data.user_metadata))
    }
    if (data.app_metadata) {
      updates.push(`raw_app_meta_data = raw_app_meta_data || $${paramIdx++}::jsonb`)
      params.push(JSON.stringify(data.app_metadata))
    }

    updates.push('updated_at = NOW()')
    params.push(userId)

    await pool.query(
      `UPDATE auth.users SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      params
    )

    const { rows } = await pool.query(`SELECT * FROM auth.users WHERE id = $1`, [userId])
    if (rows.length === 0) {
      return { data: { user: null as any }, error: { message: 'User not found', status: 404 } }
    }
    return { data: { user: mapAuthUser(rows[0]) }, error: null }
  },

  async deleteUser(userId: string): Promise<{ data: null; error: null | { message: string } }> {
    const pool = getPool()
    await pool.query(`UPDATE auth.users SET deleted_at = NOW() WHERE id = $1`, [userId])
    return { data: null, error: null }
  },

  async listUsers(options?: { page?: number; perPage?: number }): Promise<AuthResult<{ users: PgAuthUser[] }>> {
    const pool = getPool()
    const page = options?.page || 1
    const perPage = options?.perPage || 50
    const offset = (page - 1) * perPage

    const { rows } = await pool.query(
      `SELECT * FROM auth.users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [perPage, offset]
    )
    return { data: { users: rows.map(mapAuthUser) }, error: null }
  },
}

// ── Cookie Helpers ───────────────────────────────────────────────────────

export const AUTH_COOKIE_NAME = COOKIE_NAME
export const REFRESH_COOKIE_NAME_EXPORT = REFRESH_COOKIE_NAME

export function getAuthCookieOptions(secure: boolean = true) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 3600, // 1 hour
  }
}

export function getRefreshCookieOptions(secure: boolean = true) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: REFRESH_EXPIRY_DAYS * 24 * 3600,
  }
}

// ── Supabase-Compatible Auth Object Factory ──────────────────────────────

/**
 * Creates an auth object with the same API surface as Supabase's auth client.
 * Uses cookies from Next.js for session management.
 *
 * @param getCookie - function to read a cookie value by name
 * @param setCookie - function to set a cookie (name, value, options)
 * @param removeCookie - function to remove a cookie
 */
export function createPgAuth(
  getCookie: (name: string) => string | undefined,
  setCookie: (name: string, value: string, options: any) => void,
  removeCookie: (name: string, options: any) => void
) {
  const secure = process.env.NODE_ENV === 'production'

  return {
    async getUser() {
      const token = getCookie(COOKIE_NAME)
      if (!token) {
        return { data: { user: null }, error: null }
      }
      return getUserFromToken(token)
    },

    async getSession() {
      const token = getCookie(COOKIE_NAME)
      if (!token) {
        return { data: { session: null }, error: null }
      }
      const payload = await verifyAccessToken(token)
      if (!payload) {
        return { data: { session: null }, error: { message: 'Invalid token', status: 401 } }
      }

      const userResult = await getUserFromToken(token)
      if (!userResult.data.user) {
        return { data: { session: null }, error: userResult.error }
      }

      const refreshTokenStr = getCookie(REFRESH_COOKIE_NAME)
      return {
        data: {
          session: {
            access_token: token,
            refresh_token: refreshTokenStr || '',
            expires_in: Math.max(0, (payload.exp || 0) - Math.floor(Date.now() / 1000)),
            expires_at: payload.exp || 0,
            token_type: 'bearer',
            user: userResult.data.user,
          },
        },
        error: null,
      }
    },

    async signInWithPassword(credentials: { email?: string; phone?: string; password: string }) {
      const result = await signInWithPassword(credentials)
      if (result.error) return result
      // Set cookies
      setCookie(COOKIE_NAME, result.data.session.access_token, getAuthCookieOptions(secure))
      setCookie(REFRESH_COOKIE_NAME, result.data.session.refresh_token, getRefreshCookieOptions(secure))
      return result
    },

    async signUp(credentials: { email: string; password: string; phone?: string; options?: { data?: Record<string, any> } }) {
      const result = await signUp(
        { email: credentials.email, password: credentials.password, phone: credentials.phone },
        { data: credentials.options?.data }
      )
      if (result.error) return result
      setCookie(COOKIE_NAME, result.data.session.access_token, getAuthCookieOptions(secure))
      setCookie(REFRESH_COOKIE_NAME, result.data.session.refresh_token, getRefreshCookieOptions(secure))
      return result
    },

    async signOut(options?: { scope?: string }) {
      const token = getCookie(COOKIE_NAME)
      if (token) {
        await signOut(token)
      }
      removeCookie(COOKIE_NAME, { path: '/' })
      removeCookie(REFRESH_COOKIE_NAME, { path: '/' })
      return { error: null }
    },

    async refreshSession() {
      const refreshTokenStr = getCookie(REFRESH_COOKIE_NAME)
      if (!refreshTokenStr) {
        return { data: { session: null }, error: { message: 'No refresh token', status: 401 } }
      }
      const result = await refreshSession(refreshTokenStr)
      if (result.error) {
        removeCookie(COOKIE_NAME, { path: '/' })
        removeCookie(REFRESH_COOKIE_NAME, { path: '/' })
        return result
      }
      setCookie(COOKIE_NAME, result.data.session.access_token, getAuthCookieOptions(secure))
      setCookie(REFRESH_COOKIE_NAME, result.data.session.refresh_token, getRefreshCookieOptions(secure))
      return result
    },

    async updateUser(data: { password?: string; email?: string; data?: Record<string, any> }) {
      const token = getCookie(COOKIE_NAME)
      if (!token) {
        return { data: { user: null }, error: { message: 'Not authenticated', status: 401 } }
      }
      const payload = await verifyAccessToken(token)
      if (!payload?.sub) {
        return { data: { user: null }, error: { message: 'Invalid token', status: 401 } }
      }
      return adminAuth.updateUserById(payload.sub, {
        email: data.email,
        password: data.password,
        user_metadata: data.data,
      })
    },

    async resetPasswordForEmail(_email: string, _options?: any) {
      // In dev mode, just log it
      console.log('[PgAuth] resetPasswordForEmail — not implemented in PG mode (dev only)')
      return { data: {}, error: null }
    },

    async signInWithOAuth(_options: { provider: string; options?: any }) {
      console.warn('[PgAuth] signInWithOAuth — not available in PG-only mode')
      return { data: { url: null, provider: null }, error: { message: 'OAuth not available in PG-only dev mode' } }
    },

    async signInWithOtp(_options: { phone?: string; email?: string }) {
      console.warn('[PgAuth] signInWithOtp — not available in PG-only mode')
      return { data: { user: null, session: null }, error: { message: 'OTP not available in PG-only dev mode' } }
    },

    async exchangeCodeForSession(_code: string) {
      return { data: { user: null, session: null }, error: { message: 'Not available in PG-only dev mode' } }
    },

    onAuthStateChange(callback: (...args: any[]) => void) {
      // Server-side: no state changes to listen for
      return { data: { subscription: { unsubscribe: () => {} } } }
    },

    // Admin sub-object
    admin: {
      getUserById: async (id: string) => adminAuth.getUserById(id),
      createUser: async (data: any) => adminAuth.createUser(data),
      updateUserById: async (id: string, data: any) => adminAuth.updateUserById(id, data),
      deleteUser: async (id: string) => adminAuth.deleteUser(id),
      listUsers: async (opts?: any) => adminAuth.listUsers(opts),
    },
  }
}
