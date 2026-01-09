import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/fiscal-years
 * Get all fiscal years for the company
 */
export async function GET() {
  try {
    const supabase = await createClient() as any
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { data: companyId } = await supabase.rpc('get_company_id', {
      p_org_id: userData.organization_id
    })

    const { data: fiscalYears, error } = await supabase
      .from('fiscal_years')
      .select(`
        *,
        fiscal_periods (
          id, period_number, period_name, start_date, end_date, status, period_type,
          closed_at, closed_by
        )
      `)
      .eq('company_id', companyId)
      .order('start_date', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Sort periods within each fiscal year
    const sortedFiscalYears = fiscalYears?.map((fy: any) => ({
      ...fy,
      fiscal_periods: fy.fiscal_periods?.sort((a: any, b: any) => a.period_number - b.period_number)
    }))

    return NextResponse.json({ fiscalYears: sortedFiscalYears || [] })
  } catch (error) {
    console.error('Error fetching fiscal years:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/accounting/fiscal-years
 * Create a new fiscal year
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient() as any
    const body = await request.json()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from('users')
      .select(`
        organization_id,
        roles!inner(role_level)
      `)
      .eq('id', user.id)
      .single()

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (userData.roles.role_level > 20) {
      return NextResponse.json({ error: 'Forbidden - HQ Admin only' }, { status: 403 })
    }

    const { data: companyId } = await supabase.rpc('get_company_id', {
      p_org_id: userData.organization_id
    })

    // Validate required fields
    if (!body.fiscal_year_name || !body.fiscal_year_code || !body.start_date || !body.end_date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Validate dates
    const startDate = new Date(body.start_date)
    const endDate = new Date(body.end_date)
    if (endDate <= startDate) {
      return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 })
    }

    // Check for overlapping fiscal years
    const { data: overlapping } = await supabase
      .from('fiscal_years')
      .select('id, fiscal_year_name')
      .eq('company_id', companyId)
      .or(`and(start_date.lte.${body.end_date},end_date.gte.${body.start_date})`)

    if (overlapping && overlapping.length > 0) {
      return NextResponse.json({ 
        error: `Dates overlap with existing fiscal year: ${overlapping[0].fiscal_year_name}` 
      }, { status: 400 })
    }

    // Create fiscal year
    const { data: fiscalYear, error: createError } = await supabase
      .from('fiscal_years')
      .insert({
        company_id: companyId,
        fiscal_year_name: body.fiscal_year_name,
        fiscal_year_code: body.fiscal_year_code,
        start_date: body.start_date,
        end_date: body.end_date,
        status: 'open',
        created_by: user.id
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating fiscal year:', createError)
      return NextResponse.json({ error: createError.message }, { status: 400 })
    }

    // Auto-generate periods if requested
    let periodsCreated = 0
    if (body.generate_periods !== false) {
      const periodType = body.period_type || 'monthly'
      const { data: count, error: periodError } = await supabase.rpc('generate_fiscal_periods', {
        p_fiscal_year_id: fiscalYear.id,
        p_period_type: periodType
      })
      
      if (periodError) {
        console.error('Error generating periods:', periodError)
      } else {
        periodsCreated = count || 0
      }
    }

    return NextResponse.json({
      success: true,
      fiscalYear,
      periodsCreated
    })
  } catch (error) {
    console.error('Error creating fiscal year:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
