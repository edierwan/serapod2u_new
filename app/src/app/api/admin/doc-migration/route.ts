import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/admin/doc-migration
 * Get document migration status
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile to check permissions
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id, role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 403 })
    }

    // Get company ID - handle null organization_id
    if (!profile.organization_id) {
      return NextResponse.json({ error: 'User has no organization' }, { status: 403 })
    }

    const { data: companyId, error: companyError } = await supabase.rpc('get_company_id', {
      p_org_id: profile.organization_id
    })

    if (companyError || !companyId) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    // Get migration status
    const { data: status, error: statusError } = await supabase.rpc('get_doc_migration_status', {
      p_company_id: companyId
    })

    if (statusError) {
      console.error('Error getting migration status:', statusError)
      return NextResponse.json({ error: statusError.message }, { status: 500 })
    }

    // Get current sequences
    const { data: sequences, error: seqError } = await supabase.rpc('get_doc_sequences', {
      p_company_id: companyId
    })

    if (seqError) {
      console.error('Error getting sequences:', seqError)
    }

    return NextResponse.json({
      success: true,
      status,
      sequences: sequences || []
    })

  } catch (error: any) {
    console.error('Doc migration status error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/admin/doc-migration
 * Start document number migration
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile to check permissions
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id, role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 403 })
    }

    // Only Super Admin (1) or HQ Admin (10) can run migration
    const roleLevel = (profile.roles as any)?.role_level
    if (roleLevel > 10) {
      return NextResponse.json({ error: 'Only administrators can run migration' }, { status: 403 })
    }

    // Get company ID - handle null organization_id
    if (!profile.organization_id) {
      return NextResponse.json({ error: 'User has no organization' }, { status: 403 })
    }

    const { data: companyId, error: companyError } = await supabase.rpc('get_company_id', {
      p_org_id: profile.organization_id
    })

    if (companyError || !companyId) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    // Start migration
    const { data: result, error: migrationError } = await supabase.rpc('backfill_display_doc_numbers', {
      p_company_id: companyId
    })

    if (migrationError) {
      console.error('Migration error:', migrationError)
      return NextResponse.json({ error: migrationError.message }, { status: 500 })
    }

    // Parse result - it's a JSONB object
    const migrationResult = result as { success?: boolean; job_id?: string; records_processed?: number; records_failed?: number; error?: string } | null

    return NextResponse.json({
      success: migrationResult?.success ?? false,
      job_id: migrationResult?.job_id ?? null,
      records_processed: migrationResult?.records_processed ?? 0,
      records_failed: migrationResult?.records_failed ?? 0,
      error: migrationResult?.error ?? null
    })

  } catch (error: any) {
    console.error('Doc migration error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
