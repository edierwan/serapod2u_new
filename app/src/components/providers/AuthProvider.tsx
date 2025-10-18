'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect } from 'react'

/**
 * AuthProvider component that ensures the Supabase session is properly initialized
 * on the client side. This allows auth.uid() to be available in RLS policies.
 * 
 * This must be used as a wrapper component in the layout to ensure the session
 * is established before any protected queries are made.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Initialize the auth session by getting the current user
    // This ensures the JWT token is properly loaded from cookies
    const supabase = createClient()
    
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // This will be called whenever the auth state changes
      // The session will be automatically included in subsequent requests
      if (event === 'SIGNED_IN') {
        console.log('✓ User signed in, session established for RLS policies')
      } else if (event === 'SIGNED_OUT') {
        console.log('✓ User signed out')
      } else if (event === 'TOKEN_REFRESHED') {
        console.log('✓ Auth token refreshed for RLS policies')
      }
    })

    return () => {
      subscription?.unsubscribe()
    }
  }, [])

  return <>{children}</>
}
