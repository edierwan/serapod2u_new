import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'
import { isPostgresMode } from '@/lib/db/backend'

/**
 * Creates an admin/service-role data client.
 *
 * - DATA_BACKEND=supabase (default) → Supabase JS SDK with service role key
 * - DATA_BACKEND=postgres           → PG-only: direct PostgreSQL for data,
 *                                     PG-backed auth admin, PG-backed storage.
 *                                     No Supabase runtime dependency.
 */
export const createAdminClient = () => {
  // ── PostgreSQL mode ──────────────────────────────────────────────
  if (isPostgresMode()) {
    const { createPgClient } = require('@/lib/db/pg-adapter') as typeof import('@/lib/db/pg-adapter')
    const { createPgAuth, adminAuth } = require('@/lib/db/pg-auth') as typeof import('@/lib/db/pg-auth')
    const { createPgStorage } = require('@/lib/db/pg-storage') as typeof import('@/lib/db/pg-storage')

    const pgClient = createPgClient()

    // Admin auth — uses same PG auth but with admin methods
    const pgAuthAdmin = {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: 'Use user client for login' } }),
      signOut: async () => ({ error: null }),
      admin: {
        getUserById: adminAuth.getUserById,
        createUser: adminAuth.createUser,
        updateUserById: adminAuth.updateUserById,
        deleteUser: adminAuth.deleteUser,
        listUsers: adminAuth.listUsers,
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    }
    ;(pgClient as any).auth = pgAuthAdmin

    // Wire PG storage
    const pgStorage = createPgStorage()
    ;(pgClient as any).storage = pgStorage

    return pgClient as any
  }

  // ── Supabase mode (production default) ───────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Missing Supabase admin environment variables. ' +
      'Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.'
    )
  }

  return createSupabaseClient<Database>(
    supabaseUrl,
    supabaseServiceKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}