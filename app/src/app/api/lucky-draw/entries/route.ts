import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaign_id')

    if (!campaignId) {
      return NextResponse.json({ success: false, error: 'campaign_id is required' }, { status: 400 })
    }

    // Get user profile for authorization
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ success: false, error: 'User profile not found' }, { status: 404 })
    }

    // Verify campaign belongs to user's organization
    const { data: campaign, error: campaignError } = await supabase
      .from('lucky_draw_campaigns')
      .select('id, company_id')
      .eq('id', campaignId)
      .eq('company_id', profile.organization_id)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
    }

    // Fetch entries
    const { data: entries, error: entriesError } = await supabase
      .from('lucky_draw_entries')
      .select(`
        id,
        consumer_phone,
        consumer_name,
        entry_number,
        entry_date,
        is_winner,
        prize_won
      `)
      .eq('campaign_id', campaignId)
      .order('entry_date', { ascending: false })

    if (entriesError) {
      console.error('Error fetching entries:', entriesError)
      return NextResponse.json({ success: false, error: entriesError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, entries: entries || [] })
  } catch (error) {
    console.error('Error in lucky-draw/entries:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
