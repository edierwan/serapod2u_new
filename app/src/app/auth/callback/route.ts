import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createAdminSupabase } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * OAuth callback handler for social login (Google, Facebook).
 * Supabase redirects here after the user authenticates with the provider.
 * This route exchanges the auth code for a session, creates/updates the user
 * profile, and redirects to the intended destination.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') || '/store'
  const errorParam = requestUrl.searchParams.get('error')
  const errorDescription = requestUrl.searchParams.get('error_description')

  // Validate 'next' param to prevent open redirects
  const sanitizedNext = sanitizeRedirectPath(next)

  if (errorParam) {
    console.error('[auth/callback] OAuth error:', errorParam, errorDescription)
    return NextResponse.redirect(
      new URL(`/login?error=oauth_failed&message=${encodeURIComponent(errorDescription || errorParam)}`, requestUrl.origin)
    )
  }

  if (!code) {
    console.error('[auth/callback] No code parameter received')
    return NextResponse.redirect(new URL('/login?error=no_code', requestUrl.origin))
  }

  try {
    const cookieStore = await cookies()

    // Create server-side Supabase client with cookie handling
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value
          },
          set(name: string, value: string, options: CookieOptions) {
            try { cookieStore.set({ name, value, ...options }) } catch {}
          },
          remove(name: string, options: CookieOptions) {
            try { cookieStore.set({ name, value: '', ...options }) } catch {}
          },
        },
      }
    )

    // Exchange the code for a session
    const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

    if (sessionError) {
      console.error('[auth/callback] Session exchange error:', sessionError.message)
      return NextResponse.redirect(
        new URL(`/login?error=session_failed&message=${encodeURIComponent(sessionError.message)}`, requestUrl.origin)
      )
    }

    const user = sessionData?.user
    if (!user) {
      console.error('[auth/callback] No user after session exchange')
      return NextResponse.redirect(new URL('/login?error=no_user', requestUrl.origin))
    }

    // Determine provider info
    const provider = user.app_metadata?.provider || 'email'
    const fullName = user.user_metadata?.full_name || user.user_metadata?.name || ''
    const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || ''
    const email = user.email || ''
    const phone = user.phone || ''

    console.log(`[auth/callback] User authenticated: ${email} via ${provider}`)

    // Create or update user profile using admin client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (supabaseUrl && supabaseServiceKey) {
      try {
        const adminClient = createAdminSupabase(supabaseUrl, supabaseServiceKey)

        const { data: result, error: rpcError } = await adminClient
          .rpc('handle_social_login', {
            p_auth_id: user.id,
            p_email: email,
            p_full_name: fullName,
            p_avatar_url: avatarUrl,
            p_provider: provider,
            p_phone: phone || null,
          })

        if (rpcError) {
          console.error('[auth/callback] handle_social_login RPC error:', rpcError.message)
          // Don't fail - user is still authenticated, just profile may not be complete
          // Fall through to direct insert
          await fallbackCreateProfile(adminClient, user.id, email, fullName, avatarUrl, provider)
        } else {
          const profileResult = result as any
          console.log('[auth/callback] Profile result:', profileResult)

          // If user needs phone, redirect to onboarding
          if (profileResult?.needs_phone && profileResult?.is_new) {
            return NextResponse.redirect(
              new URL(`/store?welcome=true`, requestUrl.origin)
            )
          }

          // Route based on user type
          if (profileResult?.org_type && profileResult.org_type !== 'END_USER') {
            return NextResponse.redirect(new URL('/dashboard', requestUrl.origin))
          }
        }
      } catch (err) {
        console.error('[auth/callback] Profile creation error:', err)
      }
    }

    // Default redirect to store for end users
    return NextResponse.redirect(new URL(sanitizedNext, requestUrl.origin))
  } catch (error) {
    console.error('[auth/callback] Unexpected error:', error)
    return NextResponse.redirect(new URL('/login?error=unexpected', requestUrl.origin))
  }
}

/**
 * Sanitize redirect path to prevent open redirects.
 * Must start with '/' and must not contain '//' or protocol indicators.
 */
function sanitizeRedirectPath(path: string): string {
  if (!path || typeof path !== 'string') return '/store'
  const trimmed = path.trim()
  if (!trimmed.startsWith('/')) return '/store'
  if (trimmed.includes('//') || trimmed.includes(':')) return '/store'
  return trimmed
}

/**
 * Fallback profile creation if the RPC function doesn't exist yet.
 */
async function fallbackCreateProfile(
  adminClient: any,
  userId: string,
  email: string,
  fullName: string,
  avatarUrl: string,
  provider: string
) {
  try {
    // Check if user exists
    const { data: existing } = await adminClient
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle()

    if (existing) {
      // Update existing user
      await adminClient
        .from('users')
        .update({
          avatar_url: avatarUrl || undefined,
          auth_provider: provider,
          last_login_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
    } else {
      // Get End User org and Guest role
      const { data: endUserOrg } = await adminClient
        .from('organizations')
        .select('id')
        .eq('org_type_code', 'END_USER')
        .maybeSingle()

      const { data: guestRole } = await adminClient
        .from('roles')
        .select('id')
        .eq('role_level', 70)
        .maybeSingle()

      await adminClient.from('users').insert({
        id: userId,
        email,
        full_name: fullName || email.split('@')[0],
        company_id: endUserOrg?.id || null,
        role_id: guestRole?.id || null,
        org_type_code: 'END_USER',
        is_active: true,
        auth_provider: provider,
        avatar_url: avatarUrl,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.error('[auth/callback] Fallback profile creation error:', err)
  }
}
