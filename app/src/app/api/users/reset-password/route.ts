import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
 * - Requires exact HQ Admin role level 10
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

    const supabaseAdmin = createAdminClient()
    const { data: currentUserProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id, email, roles(role_level)')
      .eq('id', authUser.id)
      .single()
    const currentUserLevel = extractRoleLevel((currentUserProfile as any)?.roles)

    if (profileError || !currentUserProfile) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch user profile' },
        { status: 403 }
      )
    }

    if (currentUserLevel !== 10) {
      return NextResponse.json(
        { success: false, error: 'Forbidden - Password reset requires role level 10' },
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
    if (new_password.length < 8) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    // Verify target user exists
    const { data: targetUser, error: targetError } = await supabaseAdmin
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

    // Audit metadata deliberately excludes the password.
    const { error: auditError } = await supabaseAdmin.from('audit_logs').insert({
      user_id: authUser.id,
      user_email: currentUserProfile.email || authUser.email || null,
      action: 'PASSWORD_RESET',
      entity_type: 'user',
      entity_id: user_id,
      changed_fields: ['password'],
      new_values: { reset_by_admin: true },
      user_agent: request.headers.get('user-agent'),
    })
    if (auditError) console.error('Password reset audit log error:', auditError)

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
