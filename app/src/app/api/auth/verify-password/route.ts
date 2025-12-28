import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * API route to verify user's current password
 * This uses a fresh Supabase client (not session-based) to verify credentials
 */
export async function POST(req: NextRequest) {
  console.log('🔐 API /api/auth/verify-password called')

  try {
    const { email, password } = await req.json()
    console.log('🔐 Verifying password for email:', email)

    if (!email || !password) {
      console.error('❌ Missing email or password')
      return NextResponse.json(
        { valid: false, error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Create a fresh Supabase client for authentication verification
    // This ensures we're actually verifying credentials, not using existing session
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ Missing Supabase environment variables')
      return NextResponse.json(
        { valid: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    console.log('🔐 Creating fresh Supabase client...')
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Attempt to sign in with the provided credentials
    console.log('🔐 Attempting signInWithPassword...')
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    console.log('🔐 Sign-in result:', {
      hasData: !!data,
      hasUser: !!data?.user,
      hasSession: !!data?.session,
      hasError: !!error,
      errorMessage: error?.message
    })

    if (error) {
      console.log('❌ Password verification FAILED:', error.message)
      return NextResponse.json(
        { valid: false, error: error.message },
        { status: 200 } // Return 200 with valid: false
      )
    }

    if (!data.user) {
      console.log('❌ No user data returned')
      return NextResponse.json(
        { valid: false, error: 'Authentication failed' },
        { status: 200 }
      )
    }

    console.log('✅ Password verification SUCCESS for:', email)
    return NextResponse.json(
      { valid: true },
      { status: 200 }
    )

  } catch (error: any) {
    console.error('Error in password verification:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
