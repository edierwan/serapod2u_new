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
    const { userId, full_name, phone, address, bank_id, bank_account_number, bank_account_holder_name } = body

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
    
    // Handle name update - also sync to Supabase Auth user_metadata
    if (full_name !== undefined) {
      updateData.full_name = full_name?.trim() || null
      
      // Sync full_name to Supabase Auth user_metadata (display_name)
      try {
        const { error: authMetaError } = await adminClient.auth.admin.updateUserById(userId, {
          user_metadata: { full_name: full_name?.trim() || null }
        })
        
        if (authMetaError) {
          console.error('Auth user_metadata update failed:', authMetaError.message)
          // Don't fail the whole operation for metadata sync failure
        } else {
          console.log('✅ Auth user_metadata.full_name synced to:', full_name?.trim())
        }
      } catch (metaErr) {
        console.error('Auth metadata update exception:', metaErr)
        // Don't fail the whole operation for metadata sync failure
      }
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

    // Handle Bank Details Update
    if (bank_id !== undefined || bank_account_number !== undefined || bank_account_holder_name !== undefined) {
      // Get user's organization
      const { data: userProfile, error: userError } = await adminClient
        .from('users')
        .select('organization_id')
        .eq('id', userId)
        .single()
      
      if (userProfile?.organization_id) {
        // Check if organization is a SHOP
        const { data: orgData } = await adminClient
          .from('organizations')
          .select('org_type_code')
          .eq('id', userProfile.organization_id)
          .single()
        
        if (orgData?.org_type_code === 'SHOP') {
          const orgUpdateData: any = {}
          
          // If bank_id is provided, we need to fetch the bank name
          if (bank_id) {
            const { data: bankData } = await adminClient
              .from('msia_banks')
              .select('short_name')
              .eq('id', bank_id)
              .single()
            
            if (bankData) {
              orgUpdateData.bank_name = bankData.short_name
            }
          }
          
          // Note: We don't save bank_id to organizations table as it doesn't have that column
          // We only save the bank_name which is what the admin view uses
          
          if (bank_account_number !== undefined) orgUpdateData.bank_account_number = bank_account_number
          if (bank_account_holder_name !== undefined) orgUpdateData.bank_account_holder_name = bank_account_holder_name
          
          if (Object.keys(orgUpdateData).length > 0) {
            const { error: orgUpdateError } = await adminClient
              .from('organizations')
              .update(orgUpdateData)
              .eq('id', userProfile.organization_id)
            
            if (orgUpdateError) {
              console.error('Error updating organization bank details:', orgUpdateError)
              // Return error if it's a validation error
              if (orgUpdateError.message.includes('organizations_bank_account_valid_chk')) {
                return NextResponse.json(
                  { success: false, error: 'Invalid bank account number for the selected bank.' },
                  { status: 400 }
                )
              }
              // We continue to update user profile even if org update fails, but log it
            } else {
              console.log('✅ Organization bank details updated')
            }
          }
        }
      } else {
        // Independent Consumer (No Organization)
        // Save bank details directly to users table
        // Convert empty strings to null for UUID fields
        if (bank_id !== undefined) updateData.bank_id = bank_id || null
        if (bank_account_number !== undefined) updateData.bank_account_number = bank_account_number || null
        if (bank_account_holder_name !== undefined) updateData.bank_account_holder_name = bank_account_holder_name || null
      }
    }

    // Handle address update
    if (address !== undefined) {
      // Validate address length (max 255 characters)
      if (address && address.length > 255) {
        return NextResponse.json(
          { success: false, error: 'Address must be 255 characters or less' },
          { status: 400 }
        )
      }
      updateData.address = address?.trim() || null
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
