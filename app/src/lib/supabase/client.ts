import { createBrowserClient } from '@supabase/ssr'
import { Database } from '@/types/database'

// Check if PG mode is active (NEXT_PUBLIC_ vars are available in browser)
function isPgBrowserMode(): boolean {
  return process.env.NEXT_PUBLIC_DATA_BACKEND === 'postgres' || process.env.NEXT_PUBLIC_DATA_BACKEND === 'pg'
}

// Singleton instance to prevent multiple clients
let client: any = null

export function createClient() {
  // Return existing client if already created
  if (client) {
    return client
  }

  // ── PG Browser Mode ──────────────────────────────────────────────
  if (isPgBrowserMode()) {
    const { createPgBrowserClient } = require('@/lib/db/pg-browser-client') as typeof import('@/lib/db/pg-browser-client')
    client = createPgBrowserClient()
    return client
  }

  // ── Supabase Browser Mode (production) ───────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. ' +
      'Please ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
    )
  }

  client = createBrowserClient<Database>(
    supabaseUrl,
    supabaseAnonKey
  )

  return client
}

// Export a function to reset the client (useful for testing or logout)
export function resetClient() {
  if (isPgBrowserMode() && client) {
    const { resetPgBrowserClient } = require('@/lib/db/pg-browser-client') as typeof import('@/lib/db/pg-browser-client')
    resetPgBrowserClient()
  }
  client = null
}

/**
 * Force clear all auth storage data from browser
 */
export function forceCleanStorage() {
  if (typeof window === 'undefined') return

  if (isPgBrowserMode()) {
    const { forceCleanPgStorage } = require('@/lib/db/pg-browser-client') as typeof import('@/lib/db/pg-browser-client')
    forceCleanPgStorage()
    return
  }

  try {
    // Clear all Supabase-related localStorage items
    const localKeys = Object.keys(localStorage)
    localKeys.forEach(key => {
      if (key.includes('supabase') || key.includes('sb-')) {
        localStorage.removeItem(key)
      }
    })

    // Clear all Supabase-related sessionStorage items
    const sessionKeys = Object.keys(sessionStorage)
    sessionKeys.forEach(key => {
      if (key.includes('supabase') || key.includes('sb-')) {
        sessionStorage.removeItem(key)
      }
    })

    console.log('🧹 Auth storage cleaned')
  } catch (error) {
    console.error('Error cleaning storage:', error)
  }
}