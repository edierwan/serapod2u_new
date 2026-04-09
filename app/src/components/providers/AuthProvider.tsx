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

      // Handle session errors - but only redirect if user is on dashboard
      if (event === 'SIGNED_OUT' && session === null) {
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard')) {
          // Add a small delay to prevent race conditions with manual signouts
          setTimeout(() => {
            const currentPath = window.location.pathname
            if (currentPath.startsWith('/dashboard')) {
              console.warn('⚠️ Session expired unexpectedly - redirecting to login')
              router.push('/login')
            }
          }, 100)
        }
      }
    })

    // Set up automatic session refresh check every 15 minutes
    // This prevents token expiry causing unexpected logouts
    // Also validates single-session enforcement (kicks out old sessions)
    refreshInterval = setInterval(async () => {
      try {
        // Only check if we're on a dashboard page
        if (typeof window === 'undefined' || !window.location.pathname.startsWith('/dashboard')) {
          return
        }

        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('⚠️ Session check error:', error.message)
          if (error.message?.includes('refresh_token_not_found') || 
              error.message?.includes('Invalid Refresh Token') ||
              error.message?.includes('JWT expired')) {
            console.error('❌ Invalid session detected - clearing and redirecting')
            await supabase.auth.signOut()
            router.push('/login')
          }
          return
        }

        if (!session) {
          console.warn('⚠️ No session found during refresh check')
          const { data: { session: doubleCheck } } = await supabase.auth.getSession()
          if (!doubleCheck) {
            console.error('❌ Session confirmed lost - redirecting to login')
            router.push('/login')
          }
        } else {
          // Single-session enforcement: validate this session is still the active one
          const localSessionId = typeof window !== 'undefined' ? localStorage.getItem('serapod_session_id') : null
          if (localSessionId && session.user?.id) {
            try {
              const { data: userData } = await supabase
                .from('users')
                .select('active_session_id')
                .eq('id', session.user.id)
                .single()
              if (userData?.active_session_id && userData.active_session_id !== localSessionId) {
                console.warn('⚠️ Session replaced by another device - signing out')
                localStorage.removeItem('serapod_session_id')
                await supabase.auth.signOut({ scope: 'local' })
                window.location.href = '/login?reason=session_replaced'
                return
              }
            } catch { /* ignore - non-critical */ }
          }

          // Check if token is close to expiry (within 10 minutes)
          const expiresAt = session.expires_at
          if (expiresAt) {
            const now = Math.floor(Date.now() / 1000)
            const timeUntilExpiry = expiresAt - now
            
            if (timeUntilExpiry < 600) {
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
        // Don't logout on errors - could be network issues
      }
    }, 15 * 60 * 1000) // Check every 15 minutes

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
