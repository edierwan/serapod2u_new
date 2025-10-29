import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await context.params

    if (!code) {
      return NextResponse.json(
        { success: false, error: 'No code provided' },
        { status: 400 }
      )
    }

    // Create Supabase client with service role key for server-side operations
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Call the public verification RPC function
    const { data, error } = await supabaseAdmin.rpc('verify_case_public', {
      p_code: code
    })

    if (error) {
      console.error('Error verifying code:', error)
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    // Return the verification result
    return NextResponse.json({
      success: true,
      data: data || null
    })

  } catch (error) {
    console.error('Unexpected error in verify API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Enable caching for valid codes (optional)
export const revalidate = 300 // Cache for 5 minutes
