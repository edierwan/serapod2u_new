import { createBrowserClient } from '@supabase/ssr'
import { Database } from '@/types/database'

// Singleton instance to prevent multiple Supabase clients  
let client: ReturnType<typeof createBrowserClient<Database>> | null = null

export function createClient() {
  // Return existing client if already created
  if (client) {
    return client
  }

  // Create new client with proper configuration
  client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  return client
}

// Export a function to reset the client (useful for testing or logout)
export function resetClient() {
  client = null
}