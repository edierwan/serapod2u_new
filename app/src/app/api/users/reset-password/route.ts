import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Reset user password (Super Admin only)
 * 
 * This endpoint allows Super Admins to reset any user's password
 * without knowing their current password.
 * 
 * Security:
 * - Only Super Admin (role_level = 1) can access this endpoint
 * - Requires valid authentication session
 * - Updates password directly via Supabase Admin API
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Verify authentication
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !authUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please log in' },
        { status: 401 }
      )
    }

    // Get current user's profile and role
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('id, role_code, roles(role_level)')
      .eq('id', authUser.id)
      .single()

    if (profileError || !userProfile) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch user profile' },
        { status: 403 }
      )
    }

    // Only Super Admin (role_level = 1) can reset passwords
    const roleLevel = (userProfile.roles as any)?.role_level
    if (roleLevel !== 1) {
      return NextResponse.json(
        { success: false, error: 'Access denied - Only Super Admins can reset passwords' },
        { status: 403 }
      )
    }

    // Parse request body
    const { user_id, new_password } = await request.json()

    if (!user_id || !new_password) {
      return NextResponse.json(
        { success: false, error: 'user_id and new_password are required' },
        { status: 400 }
      )
    }

    // Validate password length
    if (new_password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }

    // Verify target user exists
    const { data: targetUser, error: targetError } = await supabase
      .from('users')
      .select('id, email, full_name')
      .eq('id', user_id)
      .single()

    if (targetError || !targetUser) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      )
    }

    // Update password using Supabase Admin API
    // This requires SUPABASE_SERVICE_ROLE_KEY to be set in environment variables
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (!serviceRoleKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error - Service role key not configured' },
        { status: 500 }
      )
    }

    // Create admin client with service role key
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js')
    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )
    
    // Use the admin updateUserById method to change password
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      user_id,
      { password: new_password }
    )

    if (updateError) {
      console.error('Password reset error:', updateError)
      return NextResponse.json(
        { success: false, error: `Failed to reset password: ${updateError.message}` },
        { status: 500 }
      )
    }

    // Log the password reset for audit purposes
    console.log(`✅ Password reset by Super Admin ${authUser.email} for user ${targetUser.email}`)

    return NextResponse.json({
      success: true,
      message: `Password reset successfully for ${targetUser.full_name}`
    })

  } catch (error: any) {
    console.error('Password reset API error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
