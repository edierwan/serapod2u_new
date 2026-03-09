import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Database } from '@/types/database'
import { isPostgresMode } from '@/lib/db/backend'

/**
 * Creates a server-side data client.
 *
 * - DATA_BACKEND=supabase (default) → Supabase JS SDK with cookie auth
 * - DATA_BACKEND=postgres           → Hybrid: PG for simple queries,
 *                                     Supabase fallback for nested FK joins.
 *
 * In PG mode, auth operations (.auth.getUser etc.) are proxied to a
 * lightweight Supabase client so hybrid auth continues to work.
 */
export async function createClient() {
  // ── PostgreSQL mode ──────────────────────────────────────────────
  if (isPostgresMode()) {
    // Dynamic imports to prevent pg (Node.js native) from leaking into client bundles
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createPgClient } = require('@/lib/db/pg-adapter') as typeof import('@/lib/db/pg-adapter')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHybridClient } = require('@/lib/db/hybrid-client') as typeof import('@/lib/db/hybrid-client')
    const pgClient = createPgClient()

    // Build a Supabase client for hybrid auth AND for nested-join fallback
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (supabaseUrl && supabaseAnonKey) {
      try {
        const cookieStore = await cookies()
        const supabaseClient = createServerClient<Database>(
          supabaseUrl,
          supabaseAnonKey,
          {
            cookies: {
              get(name: string) { return cookieStore.get(name)?.value },
              set(name: string, value: string, options: CookieOptions) {
                try { cookieStore.set({ name, value, ...options }) } catch {}
              },
              remove(name: string, options: CookieOptions) {
                try { cookieStore.set({ name, value: '', ...options }) } catch {}
              },
            },
          }
        )
        // Replace auth and storage stubs with real Supabase auth/storage
        ;(pgClient as any).auth = supabaseClient.auth
        ;(pgClient as any).storage = supabaseClient.storage

        // Return hybrid client: PG for simple queries, Supabase for nested joins
        return createHybridClient(pgClient, supabaseClient, 'server') as any
      } catch {
        // cookies() may fail outside of request context; return PG-only
      }
    }

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