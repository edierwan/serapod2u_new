import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
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

    // Handle refresh token errors
    if (authError && (
      authError.message?.includes('refresh_token_not_found') ||
      authError.message?.includes('Invalid Refresh Token') ||
      authError.message?.includes('Token has expired')
    )) {
      // Clear ALL session cookies (try multiple possible cookie names)
      response = NextResponse.redirect(new URL('/login', request.url))
      
      // Clear common Supabase cookie names
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

    // Update last_login_at when user first accesses any dashboard page
    if (user && request.nextUrl.pathname.startsWith('/dashboard')) {
      try {
        console.log('🔍 Middleware - Updating last_login for user:', user.id)
        // Use RPC function to bypass RLS
        const { error: updateError } = await supabase.rpc('update_last_login', { user_id: user.id })
        if (updateError) {
          console.error('🔍 Failed to update last_login_at:', updateError)
        } else {
          console.log('🔍 Successfully updated last_login_at for user:', user.id)
        }
      } catch (error) {
        console.error('🔍 Exception updating last_login_at:', error)
      }
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