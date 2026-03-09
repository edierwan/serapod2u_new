import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'
import { isPostgresMode } from '@/lib/db/backend'

/**
 * Creates an admin/service-role data client.
 *
 * - DATA_BACKEND=supabase (default) → Supabase JS SDK with service role key
 * - DATA_BACKEND=postgres           → Hybrid: PG for simple queries,
 *                                     Supabase fallback for nested FK joins.
 *
 * In PG mode, .auth.admin and .storage are proxied to Supabase when
 * the service role key is available (hybrid mode).
 */
export const createAdminClient = () => {
  // ── PostgreSQL mode ──────────────────────────────────────────────
  if (isPostgresMode()) {
    // Dynamic imports to prevent pg (Node.js native) from leaking into client bundles
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createPgClient } = require('@/lib/db/pg-adapter') as typeof import('@/lib/db/pg-adapter')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHybridClient } = require('@/lib/db/hybrid-client') as typeof import('@/lib/db/hybrid-client')
    const pgClient = createPgClient()

    // Hybrid: proxy auth.admin and storage to Supabase AND use for fallback
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (supabaseUrl && supabaseServiceKey) {
      const supabaseAdmin = createSupabaseClient<Database>(
        supabaseUrl,
        supabaseServiceKey,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      ;(pgClient as any).auth = supabaseAdmin.auth
      ;(pgClient as any).storage = supabaseAdmin.storage

      // Return hybrid client: PG for simple queries, Supabase for nested joins
      return createHybridClient(pgClient, supabaseAdmin, 'admin') as any
    }

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