import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/**
 * POST /api/user/lookup-phone
 * Lookup a user's name by their phone number (for referral checks)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { phone } = body

    if (!phone) {
      return NextResponse.json(
        { success: false, error: 'Phone number is required' },
        { status: 400 }
      )
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase environment variables')
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Service role client to bypass RLS
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Lookup user by phone
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('full_name') // Only select name for privacy
      .eq('phone', phone)
      .single()

    if (error || !user) {
      return NextResponse.json({ 
        success: false, 
        message: 'User not found' 
      })
    }

    return NextResponse.json({
      success: true,
      name: user.full_name
    })

  } catch (error) {
    console.error('Error looking up phone:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
