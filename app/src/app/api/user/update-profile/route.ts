import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone, validatePhoneNumber } from '@/lib/utils'

/**
 * POST /api/user/update-profile
 * Update user profile (name, phone) with phone sync to Supabase Auth
 * 
 * Body:
 *   userId: string - The user ID to update
 *   full_name?: string - New name
 *   phone?: string - New phone number (will be synced to Supabase Auth)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminClient = createAdminClient()
    
    // Verify authentication
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !authUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please log in' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { userId, full_name, phone } = body

    // Verify user is updating their own profile
    if (authUser.id !== userId) {
      // Check if user is admin
      const { data: userProfile } = await supabase
        .from('users')
        .select('role_code, roles(role_level)')
        .eq('id', authUser.id)
        .single()
      
      const roleLevel = (userProfile?.roles as any)?.role_level
      const roleCode = userProfile?.role_code
      const isAdmin = roleCode === 'SUPER' || roleCode === 'SUPERADMIN' || roleCode === 'HQ_ADMIN' || roleLevel === 1 || roleLevel === 10
      
      if (!isAdmin) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized - Can only update your own profile' },
          { status: 403 }
        )
      }
    }

    const updateData: any = {}
    
    // Handle name update
    if (full_name !== undefined) {
      updateData.full_name = full_name?.trim() || null
    }

    // Handle phone update with Auth sync
    if (phone !== undefined) {
      if (phone && phone.trim()) {
        // Validate phone format first (Malaysia/China)
        const validation = validatePhoneNumber(phone)
        if (!validation.isValid) {
          return NextResponse.json(
            { success: false, error: validation.error || 'Invalid phone number format' },
            { status: 400 }
          )
        }
        
        const normalizedPhone = normalizePhone(phone)
        
        // Check if phone is already in use in users table
        const { data: existingUser, error: checkError } = await adminClient
          .from('users')
          .select('id')
          .eq('phone', normalizedPhone)
          .neq('id', userId)
          .maybeSingle()
        
        if (checkError) {
          console.error('Error checking phone in users table:', checkError)
        }
        
        if (existingUser) {
          return NextResponse.json(
            { success: false, error: 'This phone number is already registered to another account' },
            { status: 400 }
          )
        }
        
        // Also check auth.users for duplicate phone (Supabase Auth unique constraint)
        const { data: authUsers, error: authListError } = await adminClient.auth.admin.listUsers({
          page: 1,
          perPage: 1
        })
        
        // We can't directly query auth.users by phone, so we'll let the update fail gracefully
        // and provide a better error message
        
        // Update phone in Supabase Auth first
        const { error: authPhoneError } = await adminClient.auth.admin.updateUserById(userId, {
          phone: normalizedPhone,
          phone_confirm: true
        })
        
        if (authPhoneError) {
          console.error('Auth phone update failed:', authPhoneError)
          
          // Check for duplicate phone error from Supabase Auth
          const errorMessage = authPhoneError.message.toLowerCase()
          if (errorMessage.includes('duplicate') || 
              errorMessage.includes('already') || 
              errorMessage.includes('unique') ||
              errorMessage.includes('phone')) {
            return NextResponse.json(
              { success: false, error: 'This phone number is already registered. Please use a different number.' },
              { status: 400 }
            )
          }
          
          return NextResponse.json(
            { success: false, error: `Failed to update phone: ${authPhoneError.message}` },
            { status: 500 }
          )
        }
        
        updateData.phone = normalizedPhone
        updateData.phone_verified_at = new Date().toISOString()
      } else {
        // Clearing phone
        const { error: authPhoneError } = await adminClient.auth.admin.updateUserById(userId, {
          phone: '',
          phone_confirm: false
        })
        
        if (authPhoneError) {
          console.error('Auth phone clear failed:', authPhoneError)
        }
        
        updateData.phone = null
        updateData.phone_verified_at = null
      }
    }

    // Update database
    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = new Date().toISOString()
      
      const { error: dbError } = await adminClient
        .from('users')
        .update(updateData)
        .eq('id', userId)
      
      if (dbError) {
        console.error('Database update error:', dbError)
        return NextResponse.json(
          { success: false, error: `Failed to update profile: ${dbError.message}` },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Profile updated successfully' 
    })
    
  } catch (error: any) {
    console.error('Error updating profile:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
