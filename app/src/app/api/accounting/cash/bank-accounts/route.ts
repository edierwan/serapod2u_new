import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET  /api/accounting/cash/bank-accounts — List bank accounts
 * POST /api/accounting/cash/bank-accounts — Create a new bank account
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (!userData?.organization_id) {
      return NextResponse.json({ error: 'User has no organization' }, { status: 400 })
    }

    const orgId = userData.organization_id

    // Fetch bank accounts with their linked GL account info
    const { data: accounts, error } = await supabase
      .from('bank_accounts')
      .select(`
        id, account_name, bank_name, account_number, bank_code, branch,
        currency_code, gl_account_id, opening_balance, current_balance,
        is_active, is_default, notes, created_at, updated_at
      `)
      .eq('company_id', orgId)
      .order('is_default', { ascending: false })
      .order('account_name', { ascending: true })

    if (error) {
      console.error('Error fetching bank accounts:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get linked GL account details
    const glAccountIds = (accounts || []).map((a: any) => a.gl_account_id).filter(Boolean)
    const glMap: Record<string, { code: string; name: string }> = {}
    if (glAccountIds.length > 0) {
      const { data: glAccounts } = await supabase
        .from('gl_accounts')
        .select('id, code, name')
        .in('id', glAccountIds)
      if (glAccounts) {
        for (const g of glAccounts) glMap[g.id] = { code: g.code, name: g.name }
      }
    }

    // Get available GL cash/bank accounts for linking
    const { data: cashAccounts } = await supabase
      .from('gl_accounts')
      .select('id, code, name, account_type')
      .eq('company_id', orgId)
      .eq('account_type', 'ASSET')
      .eq('is_active', true)
      .order('code', { ascending: true })

    const result = (accounts || []).map((a: any) => ({
      ...a,
      gl_account: glMap[a.gl_account_id] || null,
    }))

    return NextResponse.json({
      accounts: result,
      availableGLAccounts: cashAccounts || [],
      total: result.length,
    })
  } catch (error) {
    console.error('Error in bank accounts API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (!userData?.organization_id) {
      return NextResponse.json({ error: 'User has no organization' }, { status: 400 })
    }

    const body = await request.json()
    const { account_name, bank_name, account_number, bank_code, branch, currency_code, gl_account_id, opening_balance, is_default, notes } = body

    if (!account_name || !bank_name || !account_number) {
      return NextResponse.json({ error: 'Account name, bank name, and account number are required' }, { status: 400 })
    }

    // If setting as default, unset existing default first
    if (is_default) {
      await supabase
        .from('bank_accounts')
        .update({ is_default: false })
        .eq('company_id', userData.organization_id)
        .eq('is_default', true)
    }

    const { data: newAccount, error } = await supabase
      .from('bank_accounts')
      .insert({
        company_id: userData.organization_id,
        account_name,
        bank_name,
        account_number,
        bank_code: bank_code || null,
        branch: branch || null,
        currency_code: currency_code || 'MYR',
        gl_account_id: gl_account_id || null,
        opening_balance: opening_balance || 0,
        current_balance: opening_balance || 0,
        is_default: is_default || false,
        notes: notes || null,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating bank account:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ account: newAccount }, { status: 201 })
  } catch (error) {
    console.error('Error in bank accounts create API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (!userData?.organization_id) {
      return NextResponse.json({ error: 'User has no organization' }, { status: 400 })
    }

    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Bank account id is required' }, { status: 400 })
    }

    // If setting as default, unset existing default first
    if (updates.is_default) {
      await supabase
        .from('bank_accounts')
        .update({ is_default: false })
        .eq('company_id', userData.organization_id)
        .eq('is_default', true)
    }

    const { data: updated, error } = await supabase
      .from('bank_accounts')
      .update({ ...updates, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', userData.organization_id)
      .select()
      .single()

    if (error) {
      console.error('Error updating bank account:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ account: updated })
  } catch (error) {
    console.error('Error in bank accounts update API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
