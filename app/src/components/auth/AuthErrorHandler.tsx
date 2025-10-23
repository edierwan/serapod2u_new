'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { handleAuthError } from '@/lib/auth-utils'

/**
 * AuthErrorHandler - Global component to handle auth errors
 * Place this in your root layout to catch authentication errors
 */
export default function AuthErrorHandler() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('🔍 Auth state changed:', event)

      if (event === 'SIGNED_OUT') {
        console.log('🔴 User signed out')
        // Redirect to login if not already there
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          router.push('/login')
        }
      }

      if (event === 'TOKEN_REFRESHED') {
        console.log('✅ Token refreshed successfully')
      }

      if (event === 'USER_UPDATED') {
        console.log('✅ User updated')
      }

      if (event === 'SIGNED_IN') {
        console.log('✅ User signed in')
      }
    })

    // Check for stale sessions on mount
    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('Session check error:', error)
          handleAuthError(error, router)
        }
        
        if (!session && typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard')) {
          console.log('🔴 No valid session, redirecting to login')
          router.push('/login')
        }
      } catch (error) {
        console.error('Error checking session:', error)
      }
    }

    checkSession()

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  return null // This component doesn't render anything
}
