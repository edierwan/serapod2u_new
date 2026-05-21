import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPermissionForUser } from '@/lib/server/permissions'

const extractRoleLevel = (roleRelation: { role_level?: number | null } | Array<{ role_level?: number | null }> | null | undefined) => {
  if (Array.isArray(roleRelation)) {
    const nestedRoleLevel = roleRelation[0]?.role_level
    return typeof nestedRoleLevel === 'number' ? nestedRoleLevel : null
  }

  return typeof roleRelation?.role_level === 'number' ? roleRelation.role_level : null
}

/**
 * Reset user password (Admin access)
 *
 * This endpoint allows admins with reset-password access to reset any user's password
 * without knowing their current password.
 *
 * Security:
 * - Requires valid authentication session
 * - Requires HQ Admin role level or explicit reset-password permission
 * - Cannot reset a higher-privilege account
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

    const permissionCheck = await checkPermissionForUser(authUser.id, 'reset_passwords')
    const currentUserLevel = permissionCheck.context?.role_level ?? null
    const canResetPasswords = permissionCheck.allowed || (typeof currentUserLevel === 'number' && currentUserLevel <= 10)

    if (!permissionCheck.context) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch user profile' },
        { status: 403 }
      )
    }

    if (!canResetPasswords) {
      return NextResponse.json(
        { success: false, error: 'Access denied - Only admins can reset passwords' },
        { status: 403 }
      )
    }

    // Parse request body
    const { user_id, new_password } = await request.json()

    if (typeof user_id !== 'string' || typeof new_password !== 'string' || !user_id.trim() || !new_password) {
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
      .select('id, email, full_name, role_code, roles(role_level)')
      .eq('id', user_id)
      .single()

    if (targetError || !targetUser) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      )
    }

    const targetUserLevel = extractRoleLevel((targetUser as any).roles)
    if (
      typeof currentUserLevel === 'number' &&
      typeof targetUserLevel === 'number' &&
      targetUserLevel < currentUserLevel
    ) {
      return NextResponse.json(
        { success: false, error: 'Access denied - You cannot reset the password for a higher-privilege user' },
        { status: 403 }
      )
    }

    const supabaseAdmin = createAdminClient()
    
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
    console.log(`✅ Password reset by admin ${authUser.email} for user ${targetUser.email}`)

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
