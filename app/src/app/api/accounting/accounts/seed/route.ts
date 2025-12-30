import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { STARTER_COA_TEMPLATE, DEFAULT_COA_TEMPLATE } from '@/types/accounting'

// Known account code to settings field mapping
const STARTER_ACCOUNT_MAPPINGS: Record<string, string> = {
  '1100': 'cash_account_id',
  '1200': 'ar_control_account_id',
  '1400': 'supplier_deposit_account_id',
  '2100': 'ap_control_account_id',
  '4100': 'sales_revenue_account_id',
  '5100': 'cogs_account_id',
}

/**
 * POST /api/accounting/accounts/seed
 * Seed Chart of Accounts for a company (HQ Admin only)
 * 
 * Query params:
 * - template: 'starter' (default) | 'full'
 *   - starter: Minimal 6 accounts for basic setup
 *   - full: Complete 33 account CoA template
 * - autoConfig: 'true' (default) | 'false'
 *   - If true, automatically configure gl_settings with known account codes
 * 
 * This is idempotent - only creates accounts that don't exist
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
    
    // Get query params
    const { searchParams } = new URL(request.url)
    const templateType = searchParams.get('template') || 'starter'
    const autoConfig = searchParams.get('autoConfig') !== 'false' // default true
    
    // Select template based on type
    const template = templateType === 'full' 
      ? DEFAULT_COA_TEMPLATE 
      : STARTER_COA_TEMPLATE
    
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

    // Get existing account codes for this company
    const { data: existingAccounts, error: existingError } = await supabase
      .from('gl_accounts')
      .select('id, code')
      .eq('company_id', companyId)

    if (existingError) {
      console.error('Error fetching existing accounts:', existingError)
      return NextResponse.json(
        { error: 'Failed to check existing accounts' },
        { status: 500 }
      )
    }

    const existingCodes = new Set(existingAccounts?.map((a: any) => a.code) || [])

    // Filter template to only accounts that don't exist
    const accountsToCreate = template
      .filter(account => !existingCodes.has(account.code))
      .map(account => ({
        ...account,
        company_id: companyId,
        created_by: user.id,
        updated_by: user.id
      }))

    let createdAccounts: any[] = []
    
    if (accountsToCreate.length > 0) {
      // Insert new accounts
      const { data, error: insertError } = await supabase
        .from('gl_accounts')
        .insert(accountsToCreate)
        .select('id, code')

      if (insertError) {
        console.error('Error seeding accounts:', insertError)
        return NextResponse.json(
          { error: 'Failed to seed accounts' },
          { status: 500 }
        )
      }
      createdAccounts = data || []
    }

    // Auto-configure gl_settings if enabled
    let settingsConfigured = 0
    if (autoConfig && (createdAccounts.length > 0 || existingAccounts?.length > 0)) {
      // Combine existing and new accounts to build settings
      const allAccounts = [...(existingAccounts || []), ...createdAccounts]
      const codeToIdMap = new Map(allAccounts.map((a: any) => [a.code, a.id]))
      
      // Build settings update object
      const settingsUpdate: Record<string, string | null> = {
        updated_by: user.id
      }
      
      for (const [code, settingKey] of Object.entries(STARTER_ACCOUNT_MAPPINGS)) {
        const accountId = codeToIdMap.get(code)
        if (accountId) {
          settingsUpdate[settingKey] = accountId
          settingsConfigured++
        }
      }

      if (settingsConfigured > 0) {
        // Upsert gl_settings
        const { error: settingsError } = await supabase
          .from('gl_settings')
          .upsert({
            company_id: companyId,
            created_by: user.id,
            ...settingsUpdate
          }, {
            onConflict: 'company_id'
          })

        if (settingsError) {
          console.error('Error auto-configuring settings:', settingsError)
          // Don't fail the whole operation, just log
        }
      }
    }

    return NextResponse.json({
      message: templateType === 'starter' 
        ? 'Starter accounts created successfully' 
        : 'Full Chart of Accounts seeded successfully',
      template: templateType,
      created: createdAccounts.length,
      skipped: template.length - accountsToCreate.length,
      settingsConfigured: autoConfig ? settingsConfigured : 0
    }, { status: 201 })

  } catch (error) {
    console.error('Error in POST /api/accounting/accounts/seed:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
