'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/utils'

export async function createUserWithAuth(userData: {
  email: string
  password: string
  full_name: string
  role_code: string
  organization_id?: string
  phone?: string
}) {
  try {
    // Step 1: Create auth user using admin API
    const adminClient = createAdminClient()
    
    if (!adminClient) {
      return {
        success: false,
        error: 'Admin client not available. Check service role key configuration.'
      }
    }

    const phone = userData.phone ? normalizePhone(userData.phone) : undefined

    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email: userData.email,
      password: userData.password,
      email_confirm: true,
      phone: phone,
      phone_confirm: !!phone,
      user_metadata: {
        full_name: userData.full_name // Set display_name in auth user_metadata
      }
    })

    if (authError) {
      return {
        success: false,
        error: authError.message || 'Failed to create auth user'
      }
    }

    if (!authUser?.user?.id) {
      return {
        success: false,
        error: 'No user ID returned from auth creation'
      }
    }

    // Step 2: Sync user profile to public.users table using the sync function
    const supabase = await createClient()
    
    const { data: syncResult, error: syncError } = await supabase
      .rpc('sync_user_profile', {
        p_user_id: authUser.user.id,
        p_email: userData.email,
        p_role_code: userData.role_code,
        p_organization_id: userData.organization_id || undefined,
        p_full_name: userData.full_name || undefined,
        p_phone: phone
      })

    if (syncError) {
      // Rollback: Delete the auth user if sync failed
      try {
        await adminClient.auth.admin.deleteUser(authUser.user.id)
      } catch (deleteError) {
        console.error('Failed to rollback auth user:', deleteError)
      }
      
      return {
        success: false,
        error: `Failed to sync user profile: ${syncError.message}`
      }
    }

    // Step 3: Return success
    revalidatePath('/dashboard')
    return {
      success: true,
      user_id: authUser.user.id,
      message: `User ${userData.email} created successfully`
    }
  } catch (error) {
    console.error('Error creating user:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete user'
    }
  }
}

export async function updateUserWithAuth(userId: string, userData: {
  full_name?: string
  role_code?: string
  organization_id?: string
  phone?: string
  is_active?: boolean
  avatar_url?: string
  location?: string
  shop_name?: string
  address?: string
  referral_phone?: string
  bank_id?: string
  bank_account_number?: string
  bank_account_holder_name?: string
  department_id?: string | null
  manager_user_id?: string | null
}, callerInfo?: { id: string, role_code: string }) {
  try {
    const adminClient = createAdminClient()

    // Use server client to get current user from cookies
    const supabase = await createClient()
    
    // Check permissions: Current user must be admin OR updating themselves
    const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser()
    
    let isAuthorized = false
    let isSelfUpdate = false
    
    // If session check fails, try to use caller info passed from client
    if (!currentUser || authError) {
      console.log('Server action: Session not found via cookies, checking caller info...')
      
      if (callerInfo) {
        // Validate caller info by checking against database
        const { data: callerProfile } = await adminClient
          .from('users')
          .select('id, role_code, roles(role_level)')
          .eq('id', callerInfo.id)
          .single()
        
        if (callerProfile) {
          isSelfUpdate = callerInfo.id === userId
          const roleCode = callerProfile.role_code
          const roleLevel = (callerProfile.roles as any)?.role_level
          const isAdmin = roleCode === 'SUPER' || roleCode === 'SUPERADMIN' || roleCode === 'HQ_ADMIN' || roleLevel === 1 || roleLevel === 10
          isAuthorized = isSelfUpdate || isAdmin
          console.log('Server action: Caller validated from DB -', { roleCode, roleLevel, isAdmin, isSelfUpdate })
        }
      }
      
      if (!isAuthorized) {
        console.log('Server action: Not authorized, no valid session or caller info')
        return { success: false, error: 'Not authenticated. Please refresh the page and try again.' }
      }
    } else {
      // Session exists - check permissions normally
      // Fetch current user role to check if admin (include roles relation for role_level)
      const { data: currentUserProfile } = await supabase
        .from('users')
        .select('role_code, roles(role_level)')
        .eq('id', currentUser.id)
        .single()
      
      isSelfUpdate = currentUser.id === userId
      // Check by role_code OR role_level (level 1 = superadmin, level 10 = HQ_ADMIN)
      const roleCode = currentUserProfile?.role_code
      const roleLevel = (currentUserProfile?.roles as any)?.role_level
      const isAdmin = roleCode === 'SUPER' || roleCode === 'SUPERADMIN' || roleCode === 'HQ_ADMIN' || roleLevel === 1 || roleLevel === 10
      isAuthorized = isSelfUpdate || isAdmin
    }
    
    if (!isAuthorized) {
       return { success: false, error: 'Unauthorized' }
    }

    // Update Auth User metadata (full_name/display_name) - sync to Supabase Auth user_metadata
    if (userData.full_name !== undefined) {
        try {
          const { error: authMetaError } = await adminClient.auth.admin.updateUserById(userId, {
              user_metadata: { full_name: userData.full_name }
          })
          
          if (authMetaError) {
              console.error('Auth user_metadata update failed:', authMetaError.message)
              // Don't fail the whole operation for metadata sync failure
              console.warn('Continuing despite metadata sync failure...')
          } else {
              console.log('✅ Auth user_metadata.full_name synced to:', userData.full_name)
          }
        } catch (metaErr) {
          console.error('Auth metadata update exception:', metaErr)
          // Don't fail the whole operation for metadata sync failure
        }
    }

    // Update Auth User (Phone) - handle both setting and clearing phone
    // We make this BLOCKING to ensure consistency between Auth and Database
    if (userData.phone !== undefined) {
        try {
          if (userData.phone && userData.phone.trim()) {
            // Setting/updating phone number
            const phone = normalizePhone(userData.phone) // Returns E.164 with + prefix
            
            const { data: authData, error: authError } = await adminClient.auth.admin.updateUserById(userId, {
                phone: phone,
                phone_confirm: true
            })
            
            if (authError) {
                console.error('Auth phone update failed:', authError.message)
                return { success: false, error: `Failed to update phone in Auth: ${authError.message}` }
            }
            
            // Verify the update actually happened
            if (authData?.user?.phone !== phone) {
                console.warn(`Auth phone mismatch after update. Expected: ${phone}, Got: ${authData?.user?.phone}`)
                
                // Check if digits match (ignoring formatting differences)
                const expectedDigits = phone.replace(/\D/g, '')
                const gotDigits = (authData?.user?.phone || '').replace(/\D/g, '')
                
                if (expectedDigits !== gotDigits) {
                     console.error('Auth phone update failed silently (digits mismatch)')
                     return { success: false, error: 'Failed to update phone in Auth (Silent Failure). Please try again.' }
                }
            }
            
            console.log('✅ Auth phone updated to:', phone)
          } else {
            // Clearing/removing phone number - set to empty string or null
            const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
                phone: '',
                phone_confirm: false
            })
            
            if (authError) {
                console.error('Auth phone clear failed:', authError.message)
                return { success: false, error: `Failed to clear phone in Auth: ${authError.message}` }
            } else {
                console.log('✅ Auth phone cleared')
            }
          }
        } catch (authErr) {
          console.error('Auth phone update exception:', authErr)
          return { success: false, error: `Auth phone update exception: ${authErr}` }
        }
    }

    // Update Public User - prepare data for database update
    // Phone is normalized to E.164 format with + prefix for consistency, or null if cleared
    const updateData: any = { ...userData }
    if (updateData.phone && updateData.phone.trim()) {
      updateData.phone = normalizePhone(updateData.phone)
      // Also update phone_verified_at since we confirmed it in Auth
      updateData.phone_verified_at = new Date().toISOString()
    } else if (updateData.phone !== undefined) {
      updateData.phone = null // Explicitly set to null when cleared
      updateData.phone_verified_at = null
    }
    
    // Use adminClient to ensure update happens even if RLS is tricky (though RLS should allow self update)
    const { error: dbError } = await adminClient
        .from('users')
        .update(updateData)
        .eq('id', userId)

    if (dbError) {
        console.error('Database update error:', dbError)
        return { success: false, error: `Failed to update database user: ${dbError.message}` }
    }

    revalidatePath('/dashboard')
    return { success: true }

  } catch (error) {
      console.error('Error updating user:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function login(formData: FormData) {
  const supabase = await createClient()

  // type-casting here for convenience
  // in practice, you should validate your inputs
  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { data: authData, error } = await supabase.auth.signInWithPassword(data)

  if (error) {
    redirect('/error')
  }

  // Update last_login_at and capture IP immediately after successful login
  if (authData?.user?.id) {
    try {
      // Capture client IP address from headers
      let clientIp: string | null = null
      
      // Note: In server actions, we can't directly access request headers
      // The IP will be captured via middleware or we'll use a client-side approach
      // For now, we'll set a placeholder and update it via a client-side call
      // after successful login
      
      await supabase
        .from('users')
        .update({ 
          last_login_at: new Date().toISOString(),
          last_login_ip: clientIp // Will be updated by client-side IP capture
        })
        .eq('id', authData.user.id)
    } catch (loginError) {
      console.error('Failed to update last_login_at:', loginError)
      // Don't fail the login if this fails
    }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(formData: FormData) {
  const supabase = await createClient()

  // type-casting here for convenience
  // in practice, you should validate your inputs
  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await supabase.auth.signUp(data)

  if (error) {
    redirect('/error')
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function deleteUserWithAuth(userId: string, callerInfo?: { id: string, role_code: string }) {
  try {
    const adminClient = createAdminClient()
    
    if (!adminClient) {
      return {
        success: false,
        error: 'Admin client not available. Check service role key configuration.'
      }
    }

    const supabase = await createClient()
    
    // Verify caller has permission to delete users
    let isAuthorized = false
    
    // Try to get current user from session first
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    
    if (currentUser) {
      // Check if current user is admin
      const { data: currentUserProfile } = await adminClient
        .from('users')
        .select('role_code, roles(role_level)')
        .eq('id', currentUser.id)
        .single()
      
      const roleLevel = (currentUserProfile?.roles as any)?.role_level
      isAuthorized = roleLevel === 1 || roleLevel === 10 // Super Admin or HQ Admin
    } else if (callerInfo) {
      // Fallback to caller info for validation
      const { data: callerProfile } = await adminClient
        .from('users')
        .select('id, role_code, roles(role_level)')
        .eq('id', callerInfo.id)
        .single()
      
      if (callerProfile) {
        const roleLevel = (callerProfile.roles as any)?.role_level
        isAuthorized = roleLevel === 1 || roleLevel === 10
      }
    }
    
    if (!isAuthorized) {
      return {
        success: false,
        error: 'Unauthorized: Only administrators can delete users'
      }
    }

    // First, get user's email and phone for consumer_activations lookup
    const { data: targetUser } = await adminClient
      .from('users')
      .select('email, phone')
      .eq('id', userId)
      .single()

    // Step 1: Delete audit_logs first to avoid foreign key constraint
    // Use admin client to bypass RLS policies
    const { error: auditError } = await adminClient
      .from('audit_logs')
      .delete()
      .eq('user_id', userId)

    if (auditError) {
      console.error('Failed to delete audit logs:', auditError)
      // Don't fail on audit log deletion - continue with user deletion
    }

    // Step 2: Delete points_transactions for this user
    const { error: pointsError } = await adminClient
      .from('points_transactions')
      .delete()
      .eq('user_id', userId)
    
    if (pointsError) {
      console.error('Failed to delete points_transactions:', pointsError)
      // Continue anyway
    }

    // Step 3: Delete consumer_activations for this user by email or phone
    if (targetUser?.email) {
      const { error: activationsEmailError } = await adminClient
        .from('consumer_activations')
        .delete()
        .eq('consumer_email', targetUser.email)
      
      if (activationsEmailError) {
        console.error('Failed to delete consumer_activations by email:', activationsEmailError)
      }
    }

    if (targetUser?.phone) {
      const { error: activationsPhoneError } = await adminClient
        .from('consumer_activations')
        .delete()
        .eq('consumer_phone', targetUser.phone)
      
      if (activationsPhoneError) {
        console.error('Failed to delete consumer_activations by phone:', activationsPhoneError)
      }
    }

    // Step 4: Set null on consumer_qr_scans for this user (FK has SET NULL rule)
    const { error: scansError } = await adminClient
      .from('consumer_qr_scans')
      .update({ consumer_id: null })
      .eq('consumer_id', userId)
    
    if (scansError) {
      console.error('Failed to nullify consumer_qr_scans:', scansError)
    }

    // Step 5: Delete user from public.users table using admin client to bypass RLS
    const { error: dbError } = await adminClient
      .from('users')
      .delete()
      .eq('id', userId)

    if (dbError) {
      console.error('Database delete error:', dbError)
      return {
        success: false,
        error: `Failed to delete user from database: ${dbError.message}`
      }
    }

    // Step 6: Delete user from Supabase Auth
    const { error: authError } = await adminClient.auth.admin.deleteUser(userId)

    if (authError) {
      console.error('Failed to delete auth user (but database user deleted):', authError)
      // We still return success since the main user record is deleted
      // The auth record will be orphaned but won't cause issues
      return {
        success: true,
        warning: 'User deleted from database but auth deletion failed',
        message: 'User deleted successfully'
      }
    }

    // Step 7: Return success
    revalidatePath('/dashboard')
    return {
      success: true,
      message: 'User deleted successfully from both database and auth'
    }
  } catch (error) {
    console.error('Error deleting user:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete user'
    }
  }
}

export async function registerConsumer(userData: {
  email: string
  password: string
  full_name: string
  phone?: string
  location?: string
}) {
  try {
    const adminClient = createAdminClient()
    if (!adminClient) {
      return {
        success: false,
        error: 'System configuration error'
      }
    }

    const phone = userData.phone ? normalizePhone(userData.phone) : undefined

    // Create user with auto-confirm to bypass rate limits and verification
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email: userData.email,
      password: userData.password,
      email_confirm: true,
      phone: phone,
      phone_confirm: !!phone,
      user_metadata: {
        full_name: userData.full_name,
        phone: phone, // Ensure phone is in metadata for the trigger
        location: userData.location
      }
    })

    if (authError) {
      return {
        success: false,
        error: authError.message
      }
    }

    if (!authUser?.user) {
      return {
        success: false,
        error: 'User creation failed'
      }
    }

    // Explicitly sync user profile to ensure it exists before login
    const supabase = await createClient()
    const { error: syncError } = await supabase
      .rpc('sync_user_profile', {
        p_user_id: authUser.user.id,
        p_email: userData.email,
        p_full_name: userData.full_name,
        p_phone: phone,
        p_role_code: 'CONSUMER' // Default role for consumers
      })

    if (syncError) {
      console.warn('Manual sync_user_profile failed, relying on trigger:', syncError)
      // Don't fail the registration, as the trigger might still work
    } else if (userData.location) {
        // Update location if provided (since sync_user_profile might not handle it yet)
        await adminClient
            .from('users')
            .update({ location: userData.location })
            .eq('id', authUser.user.id)
    }

    return {
      success: true,
      user: authUser.user
    }
  } catch (error) {
    console.error('Error registering consumer:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to register consumer'
    }
  }
}