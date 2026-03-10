import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Database } from '@/types/database'
import { isPostgresMode } from '@/lib/db/backend'

/**
 * Creates a server-side data client.
 *
 * - DATA_BACKEND=supabase (default) → Supabase JS SDK with cookie auth
 * - DATA_BACKEND=postgres           → PG-only: direct PostgreSQL for data,
 *                                     PG-backed auth, PG-backed storage.
 *                                     No Supabase runtime dependency.
 */
export async function createClient() {
  // ── PostgreSQL mode ──────────────────────────────────────────────
  if (isPostgresMode()) {
    // Dynamic imports to prevent pg (Node.js native) from leaking into client bundles
    const { createPgClient } = require('@/lib/db/pg-adapter') as typeof import('@/lib/db/pg-adapter')
    const { createPgAuth } = require('@/lib/db/pg-auth') as typeof import('@/lib/db/pg-auth')
    const { createPgStorage } = require('@/lib/db/pg-storage') as typeof import('@/lib/db/pg-storage')

    const pgClient = createPgClient()

    // Wire PG auth with Next.js cookie access
    try {
      const cookieStore = await cookies()
      const pgAuth = createPgAuth(
        (name: string) => cookieStore.get(name)?.value,
        (name: string, value: string, options: any) => {
          try { cookieStore.set({ name, value, ...options }) } catch {}
        },
        (name: string, options: any) => {
          try { cookieStore.set({ name, value: '', ...options }) } catch {}
        }
      )
      ;(pgClient as any).auth = pgAuth
    } catch {
      // cookies() may fail outside of request context (e.g., during build)
    }

    // Wire PG storage
    const pgStorage = createPgStorage()
    ;(pgClient as any).storage = pgStorage

    return pgClient as any
  }

  // ── Supabase mode (production default) ───────────────────────────
  const cookieStore = await cookies()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_SUPABASE) {
    console.log('[Supabase Server] URL:', supabaseUrl?.substring(0, 30) + '...')
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. ' +
      'Please ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
    )
  }

  return createServerClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch (error) {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options })
          } catch (error) {
            // The `delete` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}