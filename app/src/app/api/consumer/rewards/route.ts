import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  try {
    // Create admin client inside the function to avoid build-time errors
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('org_id')

    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'Organization ID is required' },
        { status: 400 }
      )
    }

    // Fetch rewards for the organization
    // Only show active rewards with stock > 0 (or unlimited stock when stock_quantity is null)
    const { data: rewards, error } = await supabaseAdmin
      .from('redeem_items')
      .select('*')
      .eq('company_id', orgId)
      .eq('is_active', true)
      .or('stock_quantity.is.null,stock_quantity.gt.0')
      .order('points_required', { ascending: true })

    if (error) {
      console.error('Error fetching rewards:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch rewards' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      rewards: rewards || []
    })
  } catch (error: any) {
    console.error('Error in rewards API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
