import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/accounting/status
 * Get accounting module status and readiness checklist
 */
export async function GET(request: NextRequest) {
  try {
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

    const { data: companyId } = await supabase
      .rpc('get_company_id', { p_org_id: userData.organization_id })

    // Check feature flag
    const isEnabled = process.env.NEXT_PUBLIC_ACCOUNTING_ENABLED === 'true'

    // Readiness checklist
    const checklist: { item: string; status: 'ok' | 'warning' | 'error'; message: string }[] = []

    // 1. Feature flag status
    checklist.push({
      item: 'Feature Flag',
      status: isEnabled ? 'ok' : 'warning',
      message: isEnabled ? 'Accounting module is enabled' : 'Accounting module is disabled (NEXT_PUBLIC_ACCOUNTING_ENABLED=false)'
    })

    // 2. Check if GL tables exist (try to query)
    let tablesExist = false
    try {
      const { error: tableError } = await supabase
        .from('gl_accounts')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId || '00000000-0000-0000-0000-000000000000')
        .limit(1)
      
      tablesExist = !tableError || !tableError.message?.includes('does not exist')
      
      checklist.push({
        item: 'Database Tables',
        status: tablesExist ? 'ok' : 'error',
        message: tablesExist ? 'GL tables are set up' : 'GL tables not found - run migration'
      })
    } catch {
      checklist.push({
        item: 'Database Tables',
        status: 'error',
        message: 'Unable to verify database tables'
      })
    }

    // 3. Check Chart of Accounts count
    if (tablesExist && companyId) {
      const { count: accountCount } = await supabase
        .from('gl_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)

      const hasAccounts = (accountCount || 0) > 0

      checklist.push({
        item: 'Chart of Accounts',
        status: hasAccounts ? 'ok' : 'warning',
        message: hasAccounts 
          ? `${accountCount} accounts configured` 
          : 'No accounts configured - use "Seed Default Accounts" to set up'
      })
    }

    // 4. Check user permissions
    const roleLevel = (userData.roles as any)?.role_level || 999
    const canManage = roleLevel <= 20

    checklist.push({
      item: 'User Permissions',
      status: canManage ? 'ok' : 'warning',
      message: canManage 
        ? 'You have admin permissions to manage accounting' 
        : 'Read-only access - admin permissions required to manage'
    })

    return NextResponse.json({
      enabled: isEnabled,
      company_id: companyId,
      checklist,
      phase: 'Phase 1 - Foundation',
      features: {
        chart_of_accounts: true,
        journals_view: false, // Scaffolded but not active
        posting: false,
        reports: false
      }
    })

  } catch (error) {
    console.error('Error in GET /api/accounting/status:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
