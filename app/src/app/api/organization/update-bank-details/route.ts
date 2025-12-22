import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminClient = createAdminClient()
    
    // Verify authentication
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !authUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

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
        { success: false, error: 'Unauthorized - Admin access required' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { organizationId, bankId, bankAccountNumber, bankAccountHolderName } = body

    if (!organizationId) {
      return NextResponse.json(
        { success: false, error: 'Organization ID is required' },
        { status: 400 }
      )
    }

    const updateData: any = {}
    if (bankId !== undefined) updateData.bank_id = bankId
    if (bankAccountNumber !== undefined) updateData.bank_account_number = bankAccountNumber
    if (bankAccountHolderName !== undefined) updateData.bank_account_holder_name = bankAccountHolderName

    if (Object.keys(updateData).length > 0) {
      const { error } = await adminClient
        .from('organizations')
        .update(updateData)
        .eq('id', organizationId)

      if (error) {
        console.error('Error updating organization bank details:', error)
        if (error.message.includes('organizations_bank_account_valid_chk')) {
          return NextResponse.json(
            { success: false, error: 'Invalid bank account number for the selected bank.' },
            { status: 400 }
          )
        }
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error in update-bank-details:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
