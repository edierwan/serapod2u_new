import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * PATCH /api/accounting/accounts/[id]/toggle-active
 * Toggle the is_active status of a GL account (HQ Admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check feature flag
    if (process.env.NEXT_PUBLIC_ACCOUNTING_ENABLED !== 'true') {
      return NextResponse.json(
        { error: 'Accounting module is not enabled' },
        { status: 403 }
      )
    }

    const { id } = await params
    const supabase = await createClient() as any
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user details and check permissions
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id, role_code, roles!inner(role_level)')
      .eq('id', user.id)
      .single()

    if (userError || !userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Check if user is HQ Admin (role_level <= 20)
    const roleLevel = (userData.roles as any)?.role_level || 999
    if (roleLevel > 20) {
      return NextResponse.json(
        { error: 'Insufficient permissions. HQ Admin required.' },
        { status: 403 }
      )
    }

    const { data: companyId } = await supabase
      .rpc('get_company_id', { p_org_id: userData.organization_id })

    // Get existing account
    const { data: existingAccount, error: fetchError } = await supabase
      .from('gl_accounts')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .single()

    if (fetchError || !existingAccount) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Toggle is_active
    const newActiveStatus = !existingAccount.is_active

    const { data: account, error: updateError } = await supabase
      .from('gl_accounts')
      .update({
        is_active: newActiveStatus,
        updated_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single()

    if (updateError) {
      console.error('Error toggling account status:', updateError)
      return NextResponse.json(
        { error: 'Failed to update account status' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      account,
      message: newActiveStatus ? 'Account activated' : 'Account deactivated'
    })

  } catch (error) {
    console.error('Error in PATCH /api/accounting/accounts/[id]/toggle-active:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
