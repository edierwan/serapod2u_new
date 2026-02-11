import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/reports/gl-detail
 * GL Detail Report: transaction-level detail for a specific account.
 *
 * Params: account_id (required), from, to, page, per_page
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
    const accountId = searchParams.get('account_id')
    const fromDate = searchParams.get('from')
    const toDate = searchParams.get('to')
    const page = parseInt(searchParams.get('page') || '1')
    const perPage = parseInt(searchParams.get('per_page') || '50')
    const offset = (page - 1) * perPage

    if (!accountId) {
      return NextResponse.json({ error: 'account_id is required' }, { status: 400 })
    }

    // Get account info
    const { data: account } = await supabase
      .from('gl_accounts')
      .select('id, code, name, account_type')
      .eq('id', accountId)
      .eq('company_id', orgId)
      .single()

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Calculate opening balance (all posted lines before fromDate)
    let openingBalance = 0
    if (fromDate) {
      const { data: openingLines } = await supabase
        .from('v_gl_journal_lines' as any)
        .select('debit_amount, credit_amount')
        .eq('company_id', orgId)
        .eq('account_id', accountId)
        .eq('journal_status', 'posted')
        .lt('journal_date', fromDate)

      for (const line of (openingLines as any[]) || []) {
        openingBalance += (Number(line.debit_amount) || 0) - (Number(line.credit_amount) || 0)
      }
    }

    // Get transactions for the period
    let query = supabase
      .from('v_gl_journal_lines' as any)
      .select('*', { count: 'exact' })
      .eq('company_id', orgId)
      .eq('account_id', accountId)
      .eq('journal_status', 'posted')
      .order('journal_date', { ascending: true })
      .order('line_number', { ascending: true })
      .range(offset, offset + perPage - 1)

    if (fromDate) query = query.gte('journal_date', fromDate)
    if (toDate) query = query.lte('journal_date', toDate)

    const { data: transactions, error, count } = await query

    if (error) {
      console.error('GL detail error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Build detail with running balance
    let runningBalance = openingBalance
    const lines = ((transactions as any[]) || []).map((t: any) => {
      const debit = Number(t.debit_amount) || 0
      const credit = Number(t.credit_amount) || 0
      runningBalance += debit - credit
      return {
        journal_id: t.journal_id,
        journal_number: t.journal_number,
        journal_date: t.journal_date,
        description: t.description,
        debit,
        credit,
        running_balance: runningBalance,
        journal_status: t.journal_status,
        memo: t.entity_name || null,
      }
    })

    const total = count || 0
    const totalPages = Math.ceil(total / perPage)

    return NextResponse.json({
      account: { id: account.id, code: account.code, name: account.name, account_type: account.account_type },
      lines,
      openingBalance,
      closingBalance: runningBalance,
      total,
      totalPages,
      page,
      perPage,
    })
  } catch (error) {
    console.error('Error in GL detail API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
