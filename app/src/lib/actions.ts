'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email: userData.email,
      password: userData.password,
      email_confirm: true
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
    const supabase = createClient()
    
    const { data: syncResult, error: syncError } = await supabase
      .rpc('sync_user_profile', {
        p_user_id: authUser.user.id,
        p_email: userData.email,
        p_role_code: userData.role_code,
        p_organization_id: userData.organization_id || null,
        p_full_name: userData.full_name || null,
        p_phone: userData.phone || null
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
      error: error instanceof Error ? error.message : 'Failed to create user'
    }
  }
}

export async function login(formData: FormData) {
  const supabase = createClient()

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

  // Update last_login_at immediately after successful login
  if (authData?.user?.id) {
    try {
      await supabase
        .from('users')
        .update({ 
          last_login_at: new Date().toISOString(),
          last_login_ip: null // You can capture IP if needed
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
  const supabase = createClient()

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

export async function deleteUserWithAuth(userId: string) {
  try {
    const adminClient = createAdminClient()
    
    if (!adminClient) {
      return {
        success: false,
        error: 'Admin client not available. Check service role key configuration.'
      }
    }

    // Step 1: Delete user from public.users table (will cascade to related records)
    const supabase = createClient()
    const { error: dbError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId)

    if (dbError) {
      return {
        success: false,
        error: `Failed to delete user from database: ${dbError.message}`
      }
    }

    // Step 2: Delete user from Supabase Auth
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

    // Step 3: Return success
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