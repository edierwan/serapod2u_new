import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { ensureUserRow } from '@/server/auth/ensureUserRow'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// ── Portal email domains ─────────────────────────────────────────
const PORTAL_EMAIL_DOMAINS = ['serapod.com', 'serapod2u.com']

/**
 * OAuth callback handler for social login (Google, Facebook).
 * Supabase redirects here after the user authenticates with the provider.
 *
 * Flow:
 *   1. Exchange auth code for session
 *   2. Ensure public.users row exists (via centralized ensureUserRow)
 *   3. Redirect based on account_scope (single redirect path)
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const errorParam = requestUrl.searchParams.get('error')
  const errorDescription = requestUrl.searchParams.get('error_description')

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

    // 1. Exchange the code for a session
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

    // 2. Determine provider info
    const provider = user.app_metadata?.provider || 'email'
    const fullName = user.user_metadata?.full_name || user.user_metadata?.name || ''
    const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || ''
    const email = user.email || ''
    const phone = user.phone || ''

    console.log(`[auth/callback] User authenticated: ${email} via ${provider}`)

    // 3. Ensure public.users row exists (centralized logic)
    const { user: ensuredUser, wasCreated, warnings } = await ensureUserRow(
      user.id,
      email,
      { fullName, avatarUrl, provider, phone: phone || undefined }
    )

    if (warnings.length > 0) {
      console.warn('[auth/callback] ensureUserRow warnings:', warnings)
    }

    if (wasCreated) {
      console.log(`[auth/callback] New user row created for ${email}, scope=${ensuredUser.account_scope}`)

      // If new portal user needs phone, redirect to store with welcome flag
      if (ensuredUser.account_scope === 'store' && !phone) {
        return NextResponse.redirect(
          new URL('/store?welcome=true', requestUrl.origin)
        )
      }
    } else {
      // Existing user — update avatar & last_login
      try {
        const admin = createAdminClient()
        await admin
          .from('users')
          .update({
            avatar_url: avatarUrl || undefined,
            auth_provider: provider,
            last_login_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id)
      } catch (err) {
        console.warn('[auth/callback] Profile update error:', err)
      }
    }

    // 4. Redirect based on account_scope (single path, no duplication)
    if (ensuredUser.account_scope === 'portal' && ensuredUser.organization_id) {
      return NextResponse.redirect(new URL('/dashboard', requestUrl.origin))
    }

    // Default: store
    return NextResponse.redirect(new URL('/store', requestUrl.origin))
  } catch (error) {
    console.error('[auth/callback] Unexpected error:', error)
    return NextResponse.redirect(new URL('/login?error=unexpected', requestUrl.origin))
  }
}
