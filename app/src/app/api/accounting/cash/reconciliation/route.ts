import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET  /api/accounting/cash/reconciliation — List reconciliations
 * POST /api/accounting/cash/reconciliation — Create a new reconciliation session
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
    const bankAccountId = searchParams.get('bank_account_id')
    const status = searchParams.get('status') // draft | in_progress | completed | void

    let query = supabase
      .from('bank_reconciliations')
      .select(`
        id, bank_account_id, period_start, period_end,
        statement_balance, book_balance, difference,
        status, reconciled_at, reconciled_by, notes,
        created_at, updated_at
      `)
      .eq('company_id', orgId)
      .order('period_end', { ascending: false })

    if (bankAccountId) query = query.eq('bank_account_id', bankAccountId)
    if (status) query = query.eq('status', status)

    const { data: reconciliations, error } = await query

    if (error) {
      console.error('Error fetching reconciliations:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Attach bank account names
    const bankIds = [...new Set((reconciliations || []).map((r: any) => r.bank_account_id))]
    const bankMap: Record<string, string> = {}
    if (bankIds.length > 0) {
      const { data: banks } = await supabase
        .from('bank_accounts')
        .select('id, account_name, bank_name')
        .in('id', bankIds)
      if (banks) {
        for (const b of banks) bankMap[b.id] = `${b.bank_name} - ${b.account_name}`
      }
    }

    const result = (reconciliations || []).map((r: any) => ({
      ...r,
      bank_account_label: bankMap[r.bank_account_id] || 'Unknown',
    }))

    return NextResponse.json({ reconciliations: result, total: result.length })
  } catch (error) {
    console.error('Error in reconciliation list API:', error)
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
    const { bank_account_id, period_start, period_end, statement_balance, notes } = body

    if (!bank_account_id || !period_start || !period_end) {
      return NextResponse.json({ error: 'Bank account, period start, and period end are required' }, { status: 400 })
    }

    if (statement_balance === undefined || statement_balance === null) {
      return NextResponse.json({ error: 'Statement balance is required' }, { status: 400 })
    }

    // Get the book balance from the bank_accounts table current_balance
    const { data: bankAccount } = await supabase
      .from('bank_accounts')
      .select('current_balance')
      .eq('id', bank_account_id)
      .eq('company_id', userData.organization_id)
      .single()

    const bookBalance = bankAccount?.current_balance || 0

    const { data: recon, error } = await supabase
      .from('bank_reconciliations')
      .insert({
        company_id: userData.organization_id,
        bank_account_id,
        period_start,
        period_end,
        statement_balance: parseFloat(statement_balance),
        book_balance: bookBalance,
        status: 'draft',
        notes: notes || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating reconciliation:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ reconciliation: recon }, { status: 201 })
  } catch (error) {
    console.error('Error in reconciliation create API:', error)
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
    const { id, action, lines } = body

    if (!id) {
      return NextResponse.json({ error: 'Reconciliation id is required' }, { status: 400 })
    }

    // If action is 'complete', set status to completed
    if (action === 'complete') {
      const { data: updated, error } = await supabase
        .from('bank_reconciliations')
        .update({
          status: 'completed',
          reconciled_at: new Date().toISOString(),
          reconciled_by: user.id,
        })
        .eq('id', id)
        .eq('company_id', userData.organization_id)
        .select()
        .single()

      if (error) {
        console.error('Error completing reconciliation:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ reconciliation: updated })
    }

    // If action is 'void', void it
    if (action === 'void') {
      const { data: updated, error } = await supabase
        .from('bank_reconciliations')
        .update({ status: 'void' })
        .eq('id', id)
        .eq('company_id', userData.organization_id)
        .select()
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ reconciliation: updated })
    }

    // If action is 'add_lines', add reconciliation lines
    if (action === 'add_lines' && Array.isArray(lines)) {
      const insertLines = lines.map((l: any) => ({
        reconciliation_id: id,
        transaction_date: l.transaction_date,
        description: l.description || '',
        reference: l.reference || null,
        debit_amount: l.debit_amount || 0,
        credit_amount: l.credit_amount || 0,
        source: l.source || 'statement', // statement | book
        matched: l.matched || false,
        matched_journal_id: l.matched_journal_id || null,
      }))

      const { data: inserted, error } = await supabase
        .from('bank_reconciliation_lines')
        .insert(insertLines)
        .select()

      if (error) {
        console.error('Error adding reconciliation lines:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ lines: inserted })
    }

    // If action is 'match_line', mark a line as matched
    if (action === 'match_line' && body.line_id) {
      const { data: updated, error } = await supabase
        .from('bank_reconciliation_lines')
        .update({
          matched: true,
          matched_journal_id: body.journal_id || null,
        })
        .eq('id', body.line_id)
        .eq('reconciliation_id', id)
        .select()
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ line: updated })
    }

    // Default: update reconciliation fields
    const { statement_balance, book_balance, notes, status } = body
    const updateFields: any = {}
    if (statement_balance !== undefined) updateFields.statement_balance = statement_balance
    if (book_balance !== undefined) updateFields.book_balance = book_balance
    if (notes !== undefined) updateFields.notes = notes
    if (status) updateFields.status = status

    const { data: updated, error } = await supabase
      .from('bank_reconciliations')
      .update(updateFields)
      .eq('id', id)
      .eq('company_id', userData.organization_id)
      .select()
      .single()

    if (error) {
      console.error('Error updating reconciliation:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ reconciliation: updated })
  } catch (error) {
    console.error('Error in reconciliation update API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
