import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/reports/balance-sheet
 * Balance Sheet: Assets, Liabilities, Equity as at a specific date.
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
    const asAtDate = searchParams.get('as_at') || searchParams.get('asAt') || new Date().toISOString().split('T')[0]

    // Get all accounts
    const { data: allAccounts } = await supabase
      .from('gl_accounts')
      .select('id, code, name, account_type, parent_account_id')
      .eq('company_id', orgId)
      .order('code', { ascending: true })

    // Identify headers
    const parentIds = new Set((allAccounts || []).map((a: any) => a.parent_account_id).filter(Boolean))

    // BS accounts
    const bsAccounts = (allAccounts || []).filter(
      (a: any) => ['ASSET', 'LIABILITY', 'EQUITY'].includes(a.account_type) && !parentIds.has(a.id)
    )

    // P&L accounts for retained earnings
    const plAccounts = (allAccounts || []).filter(
      (a: any) => ['INCOME', 'EXPENSE'].includes(a.account_type)
    )
    const plAccountIds = new Set(plAccounts.map((a: any) => a.id))
    const plAccountTypes: Record<string, string> = {}
    for (const a of plAccounts) plAccountTypes[a.id] = a.account_type

    // Get all cumulative journal lines up to asAtDate
    const { data: lines } = await supabase
      .from('v_gl_journal_lines' as any)
      .select('account_id, debit_amount, credit_amount')
      .eq('company_id', orgId)
      .eq('journal_status', 'posted')
      .lte('journal_date', asAtDate)

    // Aggregate
    const balances: Record<string, { debit: number; credit: number }> = {}
    let retainedEarnings = 0

    for (const line of (lines as any[]) || []) {
      if (!balances[line.account_id]) balances[line.account_id] = { debit: 0, credit: 0 }
      balances[line.account_id].debit += Number(line.debit_amount) || 0
      balances[line.account_id].credit += Number(line.credit_amount) || 0

      if (plAccountIds.has(line.account_id)) {
        const type = plAccountTypes[line.account_id]
        if (type === 'INCOME') {
          retainedEarnings += (Number(line.credit_amount) || 0) - (Number(line.debit_amount) || 0)
        } else if (type === 'EXPENSE') {
          retainedEarnings -= (Number(line.debit_amount) || 0) - (Number(line.credit_amount) || 0)
        }
      }
    }

    const buildSection = (type: string) => {
      const accts = bsAccounts
        .filter((a: any) => a.account_type === type)
        .map((a: any) => {
          const bal = balances[a.id] || { debit: 0, credit: 0 }
          const balance = type === 'ASSET' ? bal.debit - bal.credit : bal.credit - bal.debit
          return { code: a.code, name: a.name, balance }
        })
        .filter((a: any) => Math.abs(a.balance) > 0.001)

      return { accounts: accts, total: accts.reduce((s: number, a: any) => s + a.balance, 0) }
    }

    const assets = buildSection('ASSET')
    const liabilities = buildSection('LIABILITY')
    const equity = buildSection('EQUITY')

    return NextResponse.json({
      assets,
      liabilities,
      equity,
      retainedEarnings,
      totalAssets: assets.total,
      totalLiabilities: liabilities.total,
      totalEquity: equity.total,
      totalLiabilitiesAndEquity: liabilities.total + equity.total + retainedEarnings,
      asAtDate,
    })
  } catch (error) {
    console.error('Error in balance sheet API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
