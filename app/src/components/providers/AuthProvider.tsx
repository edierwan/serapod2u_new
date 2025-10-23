'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * AuthProvider component that ensures the Supabase session is properly initialized
 * and automatically refreshed on the client side. This allows auth.uid() to be 
 * available in RLS policies and prevents unexpected logouts.
 * 
 * This must be used as a wrapper component in the layout to ensure the session
 * is established before any protected queries are made.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let refreshInterval: NodeJS.Timeout | null = null

    // Initialize and validate session
    const initializeSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('❌ Session initialization error:', error)
          if (error.message?.includes('refresh_token_not_found') || 
              error.message?.includes('Invalid Refresh Token')) {
            // Clear invalid session and redirect to login
            await supabase.auth.signOut()
            router.push('/login')
            return
          }
        }

        if (session) {
          console.log('✅ Session initialized successfully')
          setIsInitialized(true)
        } else {
          console.log('ℹ️ No active session found')
          setIsInitialized(true)
        }
      } catch (error) {
        console.error('❌ Failed to initialize session:', error)
        setIsInitialized(true)
      }
    }

    // Start session check immediately
    initializeSession()

    // Set up auth state change listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('🔔 Auth state changed:', event)

      if (event === 'SIGNED_IN') {
        console.log('✅ User signed in, session established for RLS policies')
        setIsInitialized(true)
      } else if (event === 'SIGNED_OUT') {
        console.log('👋 User signed out')
        setIsInitialized(true)
        // Clear any refresh interval
        if (refreshInterval) {
          clearInterval(refreshInterval)
          refreshInterval = null
        }
        // Redirect to login if on protected page
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard')) {
          router.push('/login')
        }
      } else if (event === 'TOKEN_REFRESHED') {
        console.log('🔄 Auth token refreshed successfully')
      } else if (event === 'USER_UPDATED') {
        console.log('👤 User data updated')
      }

      // Handle session errors
      if (event === 'SIGNED_OUT' && session === null) {
        // Check if this was an automatic signout due to token expiry
        const { data: { session: currentSession } } = await supabase.auth.getSession()
        if (!currentSession && typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard')) {
          console.error('⚠️ Session expired unexpectedly - redirecting to login')
          router.push('/login')
        }
      }
    })

    // Set up automatic session refresh check every 5 minutes
    // This prevents token expiry causing unexpected logouts
    refreshInterval = setInterval(async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('⚠️ Session check error:', error.message)
          if (error.message?.includes('refresh_token_not_found') || 
              error.message?.includes('Invalid Refresh Token')) {
            console.error('❌ Invalid session detected - clearing and redirecting')
            await supabase.auth.signOut()
            if (typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard')) {
              router.push('/login')
            }
          }
          return
        }

        if (!session) {
          console.warn('⚠️ No session found during refresh check')
          if (typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard')) {
            console.error('❌ Session lost - redirecting to login')
            router.push('/login')
          }
        } else {
          // Check if token is close to expiry (within 5 minutes)
          const expiresAt = session.expires_at
          if (expiresAt) {
            const now = Math.floor(Date.now() / 1000)
            const timeUntilExpiry = expiresAt - now
            
            if (timeUntilExpiry < 300) { // Less than 5 minutes
              console.log('⏰ Token expiring soon, forcing refresh...')
              const { error: refreshError } = await supabase.auth.refreshSession()
              if (refreshError) {
                console.error('❌ Failed to refresh session:', refreshError)
              } else {
                console.log('✅ Session refreshed proactively')
              }
            }
          }
        }
      } catch (error) {
        console.error('❌ Session refresh check failed:', error)
      }
    }, 5 * 60 * 1000) // Check every 5 minutes

    // Cleanup
    return () => {
      subscription?.unsubscribe()
      if (refreshInterval) {
        clearInterval(refreshInterval)
      }
    }
  }, [router])

  return <>{children}</>
}
