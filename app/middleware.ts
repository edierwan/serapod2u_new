import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  extractQRCodeFromPath,
  extractTokenFromQRCode,
  replaceTokenInQRCode,
  splitSecurityToken,
  writeSecurityMappingCookie
} from './src/utils/qrSecurity'

const QR_TRACK_PREFIX = "/track/product/";

/**
 * Handle QR security redirect for journeys that require security codes
 * Only redirects if journey has require_security_code = true
 * Keeps existing journeys unaffected (NON-BREAKING)
 */
async function handleQRSecurityRedirect(
  request: NextRequest
): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;

  const qrCode = extractQRCodeFromPath(pathname);
  if (!qrCode) return null; // not QR route

  const fullToken = extractTokenFromQRCode(qrCode);

  // 1) Lookup QR + journey to see if this order uses security
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: () => undefined,
        set: () => undefined,
        remove: () => undefined
      }
    }
  );

  // Query qr_codes table with order relationship to find journey
  const { data: qrRow, error } = await supabase
    .from("qr_codes")
    .select("id, code, order_id, company_id")
    .eq("code", qrCode)
    .maybeSingle();

  if (error || !qrRow) {
    // Not a known QR / or DB problem → don't touch, let existing flow handle
    return null;
  }

  // Get the company_id from QR code directly (if available) or from order
  let companyId = qrRow.company_id;

  if (!companyId && qrRow.order_id) {
    const { data: orderRow } = await supabase
      .from("orders")
      .select("company_id")
      .eq("id", qrRow.order_id)
      .maybeSingle();

    companyId = orderRow?.company_id;
  }

  if (!companyId) {
    return null; // Can't determine company, skip security check
  }

  // Resolve journey using same logic as verify API:
  // 1. First check journey_order_links for order-specific journey
  // 2. Then check for default journey
  // 3. Finally any active journey
  let requireSecurity = false;

  if (qrRow.order_id) {
    // Check order-specific journey first
    const { data: linkedJourneys } = await supabase
      .from("journey_order_links")
      .select("journey_configurations(id, require_security_code, is_active)")
      .eq("order_id", qrRow.order_id)
      .order("created_at", { ascending: false });

    if (linkedJourneys && linkedJourneys.length > 0) {
      for (const link of linkedJourneys) {
        const config = (link as any).journey_configurations;
        if (config?.is_active) {
          requireSecurity = config.require_security_code === true;
          break;
        }
      }
    }
  }

  // Fallback to default/any active journey if no order-specific found
  if (!requireSecurity) {
    const { data: journeyRow } = await supabase
      .from("journey_configurations")
      .select("id, require_security_code")
      .eq("org_id", companyId)
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    requireSecurity = journeyRow?.require_security_code === true;
  }

  // If journey does NOT require security → do nothing, keep existing behaviour
  if (!requireSecurity) {
    return null;
  }

  // Already short? (no security code)
  const { publicToken, secretCode, hasSecurityCode } = splitSecurityToken(fullToken);
  if (!hasSecurityCode) {
    return null; // nothing to hide
  }

  // Build short QR code (same format, last segment replaced)
  const shortQRCode = replaceTokenInQRCode(qrCode, publicToken);

  // If already short (user came direct to short URL), no redirect needed
  if (shortQRCode === qrCode) {
    return null;
  }

  // Prepare redirect response
  const url = request.nextUrl.clone();
  url.pathname = QR_TRACK_PREFIX + encodeURIComponent(shortQRCode);

  const response = NextResponse.redirect(url, 302);

  // Save secretCode in cookie mapping for later Lucky Draw / Redeem checks
  writeSecurityMappingCookie(request, response, publicToken, secretCode);

  return response;
}

export async function middleware(request: NextRequest) {
  // 1) QR security redirect – may return a redirect response
  const qrRedirect = await handleQRSecurityRedirect(request);
  if (qrRedirect) return qrRedirect;

  // Public paths that don't require authentication
  const PUBLIC_PATHS = ['/auth', '/verify', '/track', '/api/verify', '/api/consumer', '/api/scratch-card', '/app', '/api/journey/default', '/api/master-banner']

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
      }, (error: unknown) => {
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