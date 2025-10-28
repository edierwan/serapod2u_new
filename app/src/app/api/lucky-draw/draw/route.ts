import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { campaign_id } = body

    if (!campaign_id) {
      return NextResponse.json({ success: false, error: 'campaign_id is required' }, { status: 400 })
    }

    // Get user profile
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

    // Verify campaign belongs to user's organization and get campaign details
    const { data: campaign, error: campaignError } = await supabase
      .from('lucky_draw_campaigns')
      .select('id, company_id, status, prizes_json, drawn_at')
      .eq('id', campaign_id)
      .eq('company_id', profile.organization_id)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
    }

    // Check if already drawn
    if (campaign.drawn_at) {
      return NextResponse.json({ 
        success: false, 
        error: 'This campaign has already been drawn' 
      }, { status: 400 })
    }

    // Check if campaign is active
    if (campaign.status !== 'active') {
      return NextResponse.json({ 
        success: false, 
        error: 'Campaign must be active to perform draw' 
      }, { status: 400 })
    }

    // Get all eligible entries (not yet winners)
    const { data: entries, error: entriesError } = await supabase
      .from('lucky_draw_entries')
      .select('id, entry_number, consumer_phone, consumer_name')
      .eq('campaign_id', campaign_id)
      .eq('is_winner', false)

    if (entriesError) {
      console.error('Error fetching entries:', entriesError)
      return NextResponse.json({ success: false, error: entriesError.message }, { status: 500 })
    }

    if (!entries || entries.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'No eligible entries found for this campaign' 
      }, { status: 400 })
    }

    // Get prizes from campaign
    const prizes = campaign.prizes_json as Array<{
      name: string
      description: string
      quantity: number
    }>

    if (!prizes || prizes.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'No prizes configured for this campaign' 
      }, { status: 400 })
    }

    // Calculate total prizes
    const totalPrizes = prizes.reduce((sum, prize) => sum + prize.quantity, 0)

    if (totalPrizes > entries.length) {
      return NextResponse.json({ 
        success: false, 
        error: 'Not enough entries for all prizes' 
      }, { status: 400 })
    }

    // Perform random draw
    const shuffled = [...entries].sort(() => Math.random() - 0.5)
    const winners: any[] = []
    let prizeIndex = 0
    let prizeCount = 0

    for (let i = 0; i < totalPrizes && i < shuffled.length; i++) {
      const entry = shuffled[i]
      const currentPrize = prizes[prizeIndex]

      // Update entry to mark as winner
      const { error: updateError } = await supabase
        .from('lucky_draw_entries')
        .update({
          is_winner: true,
          prize_won: {
            name: currentPrize.name,
            description: currentPrize.description
          }
        })
        .eq('id', entry.id)

      if (updateError) {
        console.error('Error updating entry:', updateError)
        continue
      }

      winners.push({
        entry_number: entry.entry_number,
        consumer_phone: entry.consumer_phone,
        consumer_name: entry.consumer_name,
        prize: currentPrize.name
      })

      prizeCount++
      if (prizeCount >= currentPrize.quantity) {
        prizeIndex++
        prizeCount = 0
      }
    }

    // Update campaign status
    const { error: campaignUpdateError } = await supabase
      .from('lucky_draw_campaigns')
      .update({
        status: 'drawn',
        drawn_at: new Date().toISOString(),
        drawn_by: user.id,
        winners: winners
      })
      .eq('id', campaign_id)

    if (campaignUpdateError) {
      console.error('Error updating campaign:', campaignUpdateError)
      return NextResponse.json({ 
        success: false, 
        error: 'Draw completed but failed to update campaign' 
      }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      winners,
      message: `Successfully selected ${winners.length} winners`
    })
  } catch (error) {
    console.error('Error in lucky-draw/draw:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
