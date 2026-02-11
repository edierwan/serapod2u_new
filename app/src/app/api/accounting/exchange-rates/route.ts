import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/accounting/exchange-rates
 * Fetch exchange rates for the company
 */
export async function GET(request: Request) {
    try {
        const supabase = await createClient() as any
        const { searchParams } = new URL(request.url)
        const limit = parseInt(searchParams.get('limit') || '50')

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

        const { data: rates, error } = await supabase
            .from('exchange_rates')
            .select('*')
            .eq('company_id', companyId)
            .order('effective_date', { ascending: false })
            .order('from_currency', { ascending: true })
            .limit(limit)

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 400 })
        }

        return NextResponse.json({ rates: rates || [], company_id: companyId })
    } catch (error) {
        console.error('Error fetching exchange rates:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * POST /api/accounting/exchange-rates
 * Create or update an exchange rate
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
            .select('organization_id, roles!inner(role_level)')
            .eq('id', user.id)
            .single()

        if (!userData) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        if (userData.roles.role_level > 20) {
            return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
        }

        const { data: companyId } = await supabase.rpc('get_company_id', {
            p_org_id: userData.organization_id
        })

        const { data: rate, error } = await supabase
            .from('exchange_rates')
            .upsert({
                company_id: companyId,
                from_currency: body.from_currency,
                to_currency: body.to_currency,
                rate: body.rate,
                effective_date: body.effective_date,
                source: body.source || 'manual'
            }, {
                onConflict: 'company_id,from_currency,to_currency,effective_date'
            })
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 400 })
        }

        return NextResponse.json({ success: true, rate })
    } catch (error) {
        console.error('Error saving exchange rate:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * DELETE /api/accounting/exchange-rates
 * Delete an exchange rate by id
 */
export async function DELETE(request: Request) {
    try {
        const supabase = await createClient() as any
        const { searchParams } = new URL(request.url)
        const id = searchParams.get('id')

        if (!id) {
            return NextResponse.json({ error: 'Missing id' }, { status: 400 })
        }

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { error } = await supabase
            .from('exchange_rates')
            .delete()
            .eq('id', id)

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 400 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting exchange rate:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
