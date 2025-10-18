import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Hook to ensure Supabase auth session is ready before making queries
 * This prevents auth.uid() from being NULL in RLS policies
 */
export function useSupabaseAuth() {
  const [isReady, setIsReady] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    let mounted = true

    const initializeAuth = async () => {
      try {
        // Check current auth state
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        
        if (mounted) {
          if (authError) {
            // Handle refresh token errors gracefully
            if (authError.message?.includes('refresh_token_not_found') || 
                authError.message?.includes('Invalid Refresh Token')) {
              console.warn('Session expired, clearing local session')
              // Clear local session
              await supabase.auth.signOut()
              setUser(null)
              setError('Session expired. Please log in again.')
              // Redirect to login
              if (typeof window !== 'undefined') {
                window.location.href = '/login'
              }
            } else {
              console.error('Auth error:', authError)
              setError(authError.message || 'Authentication error')
            }
          } else {
            setUser(user)
            setError(null)
          }
          setIsReady(true)
        }
      } catch (err: any) {
        if (mounted) {
          console.error('Error initializing auth:', err)
          // Handle network or other errors
          if (err.message?.includes('refresh_token_not_found')) {
            await supabase.auth.signOut()
            setUser(null)
            if (typeof window !== 'undefined') {
              window.location.href = '/login'
            }
          }
          setError(err.message || 'Authentication failed')
          setIsReady(true)
        }
      }
    }

    initializeAuth()

    // Cleanup function to prevent state updates on unmounted component
    return () => {
      mounted = false
    }
  }, [])

  return { isReady, user, error, supabase }
}
