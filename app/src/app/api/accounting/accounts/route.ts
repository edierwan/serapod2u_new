import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { GLAccountInsert, GLAccountUpdate, GLAccountsFilters } from '@/types/accounting'

// Type for Supabase client - allows dynamic table access for new tables
type SupabaseClientAny = ReturnType<typeof createClient> extends Promise<infer T> ? T : never

/**
 * GET /api/accounting/accounts
 * List GL accounts with filtering, pagination, and sorting
 */
export async function GET(request: NextRequest) {
  try {
    // Check feature flag
    if (process.env.NEXT_PUBLIC_ACCOUNTING_ENABLED !== 'true') {
      return NextResponse.json(
        { error: 'Accounting module is not enabled' },
        { status: 403 }
      )
    }

    const supabase = await createClient() as any
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's company_id
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id, role_code, roles!inner(role_level)')
      .eq('id', user.id)
      .single()

    if (userError || !userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get company_id from organization hierarchy
    const { data: companyData, error: companyError } = await supabase
      .rpc('get_company_id', { p_org_id: userData.organization_id })

    if (companyError || !companyData) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    const companyId = companyData

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const accountType = searchParams.get('accountType') || 'ALL'
    const isActive = searchParams.get('isActive') || 'ALL'
    const page = parseInt(searchParams.get('page') || '1', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '25', 10)
    const sortBy = searchParams.get('sortBy') || 'code'
    const sortOrder = searchParams.get('sortOrder') || 'asc'

    // Build query (using 'any' for new table not yet in types)
    let query = supabase
      .from('gl_accounts')
      .select('*', { count: 'exact' })
      .eq('company_id', companyId)

    // Apply filters
    if (search) {
      query = query.or(`code.ilike.%${search}%,name.ilike.%${search}%`)
    }

    if (accountType !== 'ALL') {
      query = query.eq('account_type', accountType)
    }

    if (isActive !== 'ALL') {
      query = query.eq('is_active', isActive === 'true')
    }

    // Apply sorting
    const validSortColumns = ['code', 'name', 'account_type', 'created_at']
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'code'
    query = query.order(sortColumn, { ascending: sortOrder === 'asc' })

    // Apply pagination
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    query = query.range(from, to)

    const { data: accounts, error: queryError, count } = await query

    if (queryError) {
      console.error('Error fetching accounts:', queryError)
      return NextResponse.json(
        { error: 'Failed to fetch accounts' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      accounts: accounts || [],
      total: count || 0,
      page,
      pageSize
    })

  } catch (error) {
    console.error('Error in GET /api/accounting/accounts:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/accounting/accounts
 * Create a new GL account (HQ Admin only)
 */
export async function POST(request: NextRequest) {
  try {
    // Check feature flag
    if (process.env.NEXT_PUBLIC_ACCOUNTING_ENABLED !== 'true') {
      return NextResponse.json(
        { error: 'Accounting module is not enabled' },
        { status: 403 }
      )
    }

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

    // Get company_id
    const { data: companyId, error: companyError } = await supabase
      .rpc('get_company_id', { p_org_id: userData.organization_id })

    if (companyError || !companyId) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    // Parse request body
    const body: GLAccountInsert = await request.json()

    // Validate required fields
    if (!body.code || !body.name || !body.account_type) {
      return NextResponse.json(
        { error: 'Code, name, and account_type are required' },
        { status: 400 }
      )
    }

    // Validate code format (alphanumeric with dots/dashes, 1-20 chars)
    const codeRegex = /^[A-Z0-9][A-Z0-9.\-]{0,19}$/
    const upperCode = body.code.toUpperCase()
    if (!codeRegex.test(upperCode)) {
      return NextResponse.json(
        { error: 'Invalid code format. Must be alphanumeric (A-Z, 0-9, ., -), 1-20 characters.' },
        { status: 400 }
      )
    }

    // Check for duplicate code
    const { data: existing } = await supabase
      .from('gl_accounts')
      .select('id')
      .eq('company_id', companyId)
      .eq('code', upperCode)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: `Account code "${upperCode}" already exists` },
        { status: 409 }
      )
    }

    // Set normal balance based on account type if not provided
    let normalBalance = body.normal_balance
    if (!normalBalance) {
      normalBalance = ['ASSET', 'EXPENSE'].includes(body.account_type) ? 'DEBIT' : 'CREDIT'
    }

    // Insert account
    const { data: account, error: insertError } = await supabase
      .from('gl_accounts')
      .insert({
        company_id: companyId,
        code: upperCode,
        name: body.name.trim(),
        account_type: body.account_type,
        subtype: body.subtype?.trim() || null,
        description: body.description?.trim() || null,
        parent_account_id: body.parent_account_id || null,
        is_active: body.is_active ?? true,
        is_system: body.is_system ?? false,
        normal_balance: normalBalance,
        created_by: user.id,
        updated_by: user.id
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error creating account:', insertError)
      return NextResponse.json(
        { error: 'Failed to create account' },
        { status: 500 }
      )
    }

    return NextResponse.json({ account }, { status: 201 })

  } catch (error) {
    console.error('Error in POST /api/accounting/accounts:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
