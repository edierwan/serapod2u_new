import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // Public paths that don't require authentication
  const PUBLIC_PATHS = ['/auth', '/verify', '/track', '/api/verify', '/api/consumer']
  
  // Check if current path is public
  const isPublicPath = PUBLIC_PATHS.some((path) => 
    request.nextUrl.pathname.startsWith(path)
  )
  
  // Allow public paths to proceed without auth check
  if (isPublicPath) {
    return NextResponse.next({
      request: {
        headers: request.headers,
      },
    })
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Add no-cache headers to prevent caching
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Expires', '0')

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    // Debug logging
    if (user && request.nextUrl.pathname.startsWith('/dashboard')) {
      console.log('🔍 Middleware - User ID:', user.id)
      console.log('🔍 Middleware - User Email:', user.email)
    }

    // Handle authentication errors
    if (authError) {
      console.error('🔴 Auth Error in Middleware:', authError.message, authError.status)
      
      // Check for rate limit error
      if (authError.status === 429 || authError.message?.toLowerCase().includes('rate limit')) {
        console.error('⚠️ Rate limit reached - too many requests')
        // Don't redirect on rate limit, just continue
        // The session might still be valid
        if (request.nextUrl.pathname === '/login') {
          return response // Allow access to login page
        }
      }
      
      // Handle token errors
      if (
        authError.message?.includes('refresh_token_not_found') ||
        authError.message?.includes('Invalid Refresh Token') ||
        authError.message?.includes('Refresh Token Not Found') ||
        authError.message?.includes('Token has expired') ||
        authError.status === 400
      ) {
        console.log('🔴 Invalid/expired token - clearing session and redirecting to login')
        
        // Only redirect if not already on login page
        if (request.nextUrl.pathname !== '/login') {
          response = NextResponse.redirect(new URL('/login', request.url))
          
          // Clear ALL session cookies
          const cookieNames = [
            'sb-access-token',
            'sb-refresh-token',
            `sb-${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]?.split('.')[0]}-auth-token`,
            `sb-${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]?.split('.')[0]}-auth-token-code-verifier`
          ]
          
          cookieNames.forEach(name => {
            if (name) {
              response.cookies.delete(name)
              request.cookies.delete(name)
            }
          })
          
          return response
        }
      }
    }

    // Update last_login_at when user first accesses any dashboard page
    // Fire and forget - don't await to avoid blocking middleware
    if (user && request.nextUrl.pathname.startsWith('/dashboard')) {
      supabase.rpc('update_last_login', { user_id: user.id }).then(({ error: updateError }) => {
        if (updateError) {
          console.error('🔍 Failed to update last_login_at:', updateError)
        }
      }).catch((error) => {
        console.error('🔍 Exception updating last_login_at:', error)
      })
    }

    // Handle protected routes
    if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Handle login redirect for authenticated users
    if (user && request.nextUrl.pathname === '/login') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  } catch (error) {
    console.error('Middleware error:', error)
    // On error, redirect to login for protected routes
    if (request.nextUrl.pathname.startsWith('/dashboard')) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}