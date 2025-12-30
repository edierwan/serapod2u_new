import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { GLAccountUpdate } from '@/types/accounting'

/**
 * GET /api/accounting/accounts/[id]
 * Get a single GL account by ID
 */
export async function GET(
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

    // Get user's company_id
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (userError || !userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { data: companyId } = await supabase
      .rpc('get_company_id', { p_org_id: userData.organization_id })

    // Get account (RLS will enforce company scope)
    const { data: account, error: queryError } = await supabase
      .from('gl_accounts')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .single()

    if (queryError || !account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    return NextResponse.json({ account })

  } catch (error) {
    console.error('Error in GET /api/accounting/accounts/[id]:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/accounting/accounts/[id]
 * Update a GL account (HQ Admin only)
 */
export async function PUT(
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

    // Parse request body
    const body: GLAccountUpdate = await request.json()

    // Validate code if being changed
    if (body.code) {
      const codeRegex = /^[A-Z0-9][A-Z0-9.\-]{0,19}$/
      const upperCode = body.code.toUpperCase()
      if (!codeRegex.test(upperCode)) {
        return NextResponse.json(
          { error: 'Invalid code format. Must be alphanumeric (A-Z, 0-9, ., -), 1-20 characters.' },
          { status: 400 }
        )
      }

      // Check for duplicate code (excluding current account)
      const { data: duplicate } = await supabase
        .from('gl_accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('code', upperCode)
        .neq('id', id)
        .single()

      if (duplicate) {
        return NextResponse.json(
          { error: `Account code "${upperCode}" already exists` },
          { status: 409 }
        )
      }

      body.code = upperCode
    }

    // Build update object
    const updateData: Record<string, any> = {
      updated_by: user.id,
      updated_at: new Date().toISOString()
    }

    if (body.code !== undefined) updateData.code = body.code
    if (body.name !== undefined) updateData.name = body.name.trim()
    if (body.account_type !== undefined) updateData.account_type = body.account_type
    if (body.subtype !== undefined) updateData.subtype = body.subtype?.trim() || null
    if (body.description !== undefined) updateData.description = body.description?.trim() || null
    if (body.parent_account_id !== undefined) updateData.parent_account_id = body.parent_account_id
    if (body.is_active !== undefined) updateData.is_active = body.is_active
    if (body.normal_balance !== undefined) updateData.normal_balance = body.normal_balance

    // Update account
    const { data: account, error: updateError } = await supabase
      .from('gl_accounts')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating account:', updateError)
      return NextResponse.json(
        { error: 'Failed to update account' },
        { status: 500 }
      )
    }

    return NextResponse.json({ account })

  } catch (error) {
    console.error('Error in PUT /api/accounting/accounts/[id]:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/accounting/accounts/[id]
 * Delete a GL account (HQ Admin only, non-system accounts only)
 * 
 * DEV-ONLY: Hard delete is only available in non-production environments
 * In production, use the toggle-active endpoint to deactivate accounts
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Check if hard delete is allowed (DEV only)
    const isProduction = process.env.NODE_ENV === 'production'
    const allowDevReset = process.env.ALLOW_DEV_RESET === 'true'
    
    if (isProduction && !allowDevReset) {
      return NextResponse.json(
        { error: 'Hard delete not allowed in production. Use deactivate instead.' },
        { status: 403 }
      )
    }

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

    // Prevent deletion of system accounts
    if (existingAccount.is_system) {
      return NextResponse.json(
        { error: 'System accounts cannot be deleted' },
        { status: 403 }
      )
    }

    // Check if account is used in any journal lines
    const { count: journalLineCount } = await supabase
      .from('gl_journal_lines')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', id)

    if (journalLineCount && journalLineCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete account with existing journal entries. Deactivate instead.' },
        { status: 409 }
      )
    }

    // Delete account
    const { error: deleteError } = await supabase
      .from('gl_accounts')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId)

    if (deleteError) {
      console.error('Error deleting account:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete account' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in DELETE /api/accounting/accounts/[id]:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
