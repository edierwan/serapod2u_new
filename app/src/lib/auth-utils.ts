import { createClient } from '@/lib/supabase/client'

/**
 * Clear all Supabase session data from the browser
 * Useful for handling invalid/expired tokens
 */
export async function clearSupabaseSession() {
  try {
    const supabase = createClient()
    
    // Sign out from Supabase
    await supabase.auth.signOut()
    
    // Clear local storage items related to Supabase
    if (typeof window !== 'undefined') {
      const localStorageKeys = Object.keys(localStorage)
      localStorageKeys.forEach(key => {
        if (key.includes('supabase') || key.includes('sb-')) {
          localStorage.removeItem(key)
        }
      })
      
      // Clear session storage as well
      const sessionStorageKeys = Object.keys(sessionStorage)
      sessionStorageKeys.forEach(key => {
        if (key.includes('supabase') || key.includes('sb-')) {
          sessionStorage.removeItem(key)
        }
      })
    }
    
    console.log('✅ Session cleared successfully')
    return true
  } catch (error) {
    console.error('❌ Error clearing session:', error)
    return false
  }
}

/**
 * Handle authentication errors and redirect if needed
 */
export function handleAuthError(error: any, router?: any) {
  if (!error) return false
  
  const isTokenError = 
    error.message?.includes('refresh_token_not_found') ||
    error.message?.includes('Invalid Refresh Token') ||
    error.message?.includes('Refresh Token Not Found') ||
    error.message?.includes('Token has expired') ||
    error.status === 400

  const isRateLimit = 
    error.status === 429 || 
    error.message?.toLowerCase().includes('rate limit')

  if (isTokenError) {
    console.log('🔴 Token error detected, clearing session')
    clearSupabaseSession()
    
    if (router && typeof window !== 'undefined' && window.location.pathname !== '/login') {
      router.push('/login')
    }
    return true
  }

  if (isRateLimit) {
    console.log('⚠️ Rate limit error detected')
    return true
  }

  return false
}

/**
 * Check if the current session is valid
 */
export async function isSessionValid(): Promise<boolean> {
  try {
    const supabase = createClient()
    const { data: { session }, error } = await supabase.auth.getSession()
    
    if (error) {
      console.error('Session check error:', error)
      return false
    }
    
    return !!session
  } catch (error) {
    console.error('Error checking session:', error)
    return false
  }
}

/**
 * Refresh the current session
 */
export async function refreshSession(): Promise<boolean> {
  try {
    const supabase = createClient()
    const { data: { session }, error } = await supabase.auth.refreshSession()
    
    if (error) {
      console.error('Session refresh error:', error)
      await clearSupabaseSession()
      return false
    }
    
    return !!session
  } catch (error) {
    console.error('Error refreshing session:', error)
    await clearSupabaseSession()
    return false
  }
}
