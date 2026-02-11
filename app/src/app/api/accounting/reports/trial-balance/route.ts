import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/reports/trial-balance
 * Trial balance: aggregate debits/credits per GL account for a period.
 *
 * Schema: gl_accounts has parent_account_id (NOT parent_id), NO is_header column.
 * Header accounts have children; we detect them via parent_account_id references.
 * v_gl_journal_lines has company_id from gl_journals.
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
    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('from')
    const toDate = searchParams.get('to')
    const accountType = searchParams.get('accountType')

    // Fetch all GL accounts for this company
    const { data: accounts, error: accError } = await supabase
      .from('gl_accounts')
      .select('id, code, name, account_type, parent_account_id, is_active, is_system')
      .eq('company_id', orgId)
      .order('code', { ascending: true })

    if (accError) {
      console.error('Error fetching accounts:', accError)
      return NextResponse.json({ error: accError.message }, { status: 500 })
    }

    // Identify header accounts (those that have children)
    const parentIds = new Set((accounts || []).map((a: any) => a.parent_account_id).filter(Boolean))

    // Fetch journal lines (posted only) within date range
    let linesQuery = supabase
      .from('v_gl_journal_lines' as any)
      .select('account_id, debit_amount, credit_amount')
      .eq('company_id', orgId)
      .eq('journal_status', 'posted')

    if (fromDate) linesQuery = linesQuery.gte('journal_date', fromDate)
    if (toDate) linesQuery = linesQuery.lte('journal_date', toDate)

    const { data: lines, error: linesError } = await linesQuery

    if (linesError) {
      console.error('Error fetching journal lines:', linesError)
      return NextResponse.json({ error: linesError.message }, { status: 500 })
    }

    // Aggregate by account
    const balances: Record<string, { debit: number; credit: number }> = {}
    for (const line of (lines as any[]) || []) {
      if (!balances[line.account_id]) balances[line.account_id] = { debit: 0, credit: 0 }
      balances[line.account_id].debit += Number(line.debit_amount) || 0
      balances[line.account_id].credit += Number(line.credit_amount) || 0
    }

    // Build trial balance rows — exclude header accounts (accounts that have children)
    let trialBalance = (accounts || [])
      .filter((a: any) => !parentIds.has(a.id)) // Leaf accounts only
      .map((a: any) => {
        const bal = balances[a.id] || { debit: 0, credit: 0 }
        const netBalance = bal.debit - bal.credit
        return {
          account_id: a.id,
          code: a.code,
          name: a.name,
          account_type: a.account_type,
          is_active: a.is_active,
          total_debit: bal.debit,
          total_credit: bal.credit,
          balance: netBalance,
          debit_balance: netBalance > 0 ? netBalance : 0,
          credit_balance: netBalance < 0 ? Math.abs(netBalance) : 0,
        }
      })
      .filter((r: any) => r.total_debit !== 0 || r.total_credit !== 0)

    if (accountType) {
      trialBalance = trialBalance.filter((r: any) => r.account_type === accountType)
    }

    const totals = trialBalance.reduce(
      (acc: any, r: any) => ({
        total_debit: acc.total_debit + r.total_debit,
        total_credit: acc.total_credit + r.total_credit,
        debit_balance: acc.debit_balance + r.debit_balance,
        credit_balance: acc.credit_balance + r.credit_balance,
      }),
      { total_debit: 0, total_credit: 0, debit_balance: 0, credit_balance: 0 }
    )

    return NextResponse.json({
      trialBalance,
      totals,
      fromDate,
      toDate,
      accountCount: trialBalance.length,
    })
  } catch (error) {
    console.error('Error in trial balance API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
