import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/reports/profit-loss
 * Profit & Loss: Income minus Expense for a period.
 *
 * Schema: gl_accounts has NO is_header column.
 * We detect headers by checking if any account references them as parent_account_id.
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
    const fromDate = searchParams.get('from') || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
    const toDate = searchParams.get('to') || new Date().toISOString().split('T')[0]

    // Get all accounts to identify headers
    const { data: allAccounts } = await supabase
      .from('gl_accounts')
      .select('id, code, name, account_type, parent_account_id')
      .eq('company_id', orgId)
      .in('account_type', ['INCOME', 'EXPENSE'])
      .order('code', { ascending: true })

    // Identify header accounts
    const parentIds = new Set((allAccounts || []).map((a: any) => a.parent_account_id).filter(Boolean))
    const leafAccounts = (allAccounts || []).filter((a: any) => !parentIds.has(a.id))

    // Get journal lines for the period (posted only)
    const { data: lines } = await supabase
      .from('v_gl_journal_lines' as any)
      .select('account_id, debit_amount, credit_amount')
      .eq('company_id', orgId)
      .eq('journal_status', 'posted')
      .gte('journal_date', fromDate)
      .lte('journal_date', toDate)

    // Aggregate
    const balances: Record<string, { debit: number; credit: number }> = {}
    for (const line of (lines as any[]) || []) {
      if (!balances[line.account_id]) balances[line.account_id] = { debit: 0, credit: 0 }
      balances[line.account_id].debit += Number(line.debit_amount) || 0
      balances[line.account_id].credit += Number(line.credit_amount) || 0
    }

    const incomeAccounts = leafAccounts
      .filter((a: any) => a.account_type === 'INCOME')
      .map((a: any) => {
        const bal = balances[a.id] || { debit: 0, credit: 0 }
        return { code: a.code, name: a.name, amount: bal.credit - bal.debit }
      })

    const expenseAccounts = leafAccounts
      .filter((a: any) => a.account_type === 'EXPENSE')
      .map((a: any) => {
        const bal = balances[a.id] || { debit: 0, credit: 0 }
        return { code: a.code, name: a.name, amount: bal.debit - bal.credit }
      })

    const totalIncome = incomeAccounts.reduce((s: number, a: any) => s + a.amount, 0)
    const totalExpense = expenseAccounts.reduce((s: number, a: any) => s + a.amount, 0)

    return NextResponse.json({
      income: incomeAccounts.filter((a: any) => a.amount !== 0),
      expenses: expenseAccounts.filter((a: any) => a.amount !== 0),
      totalIncome,
      totalExpense,
      netProfitLoss: totalIncome - totalExpense,
      fromDate,
      toDate,
    })
  } catch (error) {
    console.error('Error in P&L API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
