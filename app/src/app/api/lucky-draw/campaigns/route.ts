import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('order_id')

    if (!orderId) {
      return NextResponse.json({ success: false, error: 'order_id is required' }, { status: 400 })
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

    // Get campaigns linked to this order
    const { data: links, error: linksError } = await supabase
      .from('lucky_draw_order_links')
      .select('campaign_id')
      .eq('order_id', orderId)

    if (linksError) {
      console.error('Error fetching campaign links:', linksError)
      return NextResponse.json({ success: false, error: linksError.message }, { status: 500 })
    }

    if (!links || links.length === 0) {
      return NextResponse.json({ success: true, campaigns: [] })
    }

    const campaignIds = links.map(link => link.campaign_id)

    // Fetch campaigns
    const { data: campaigns, error: campaignsError } = await supabase
      .from('lucky_draw_campaigns')
      .select(`
        id,
        company_id,
        campaign_code,
        campaign_name,
        campaign_description,
        status,
        start_date,
        end_date,
        draw_date,
        prizes_json,
        drawn_at
      `)
      .in('id', campaignIds)
      .eq('company_id', profile.organization_id)
      .order('created_at', { ascending: false })

    if (campaignsError) {
      console.error('Error fetching campaigns:', campaignsError)
      return NextResponse.json({ success: false, error: campaignsError.message }, { status: 500 })
    }

    // Get entry counts for each campaign
    const campaignsWithCounts = await Promise.all(
      (campaigns || []).map(async (campaign) => {
        const { count } = await supabase
          .from('lucky_draw_entries')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaign.id)

        return {
          ...campaign,
          entries_count: count || 0
        }
      })
    )

    return NextResponse.json({ success: true, campaigns: campaignsWithCounts })
  } catch (error) {
    console.error('Error in lucky-draw/campaigns:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()

    const {
      order_id,
      campaign_name,
      campaign_description,
      start_date,
      end_date,
      draw_date,
      prizes_json
    } = body

    if (!order_id || !campaign_name) {
      return NextResponse.json({ 
        success: false, 
        error: 'order_id and campaign_name are required' 
      }, { status: 400 })
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

    // Generate campaign code
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 7)
    const campaign_code = `LD-${timestamp}-${random}`.toUpperCase()

    // Sanitize dates - convert empty strings to null
    const sanitizedStartDate = start_date && start_date.trim() !== '' ? start_date : new Date().toISOString().split('T')[0]
    const sanitizedEndDate = end_date && end_date.trim() !== '' ? end_date : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const sanitizedDrawDate = draw_date && draw_date.trim() !== '' ? draw_date : null

    // Create campaign
    const { data: campaign, error: campaignError } = await supabase
      .from('lucky_draw_campaigns')
      .insert({
        company_id: profile.organization_id,
        campaign_code,
        campaign_name,
        campaign_description: campaign_description || '',
        start_date: sanitizedStartDate,
        end_date: sanitizedEndDate,
        draw_date: sanitizedDrawDate,
        prizes_json: prizes_json || [],
        status: 'draft'
      })
      .select()
      .single()

    if (campaignError) {
      console.error('Error creating campaign:', campaignError)
      return NextResponse.json({ success: false, error: campaignError.message }, { status: 500 })
    }

    // Link campaign to order
    const { error: linkError } = await supabase
      .from('lucky_draw_order_links')
      .insert({
        campaign_id: campaign.id,
        order_id: order_id
      })

    if (linkError) {
      console.error('Error linking campaign to order:', linkError)
      // Try to delete the campaign if linking fails
      await supabase.from('lucky_draw_campaigns').delete().eq('id', campaign.id)
      return NextResponse.json({ success: false, error: linkError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, campaign })
  } catch (error) {
    console.error('Error in lucky-draw/campaigns POST:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { campaign_id, status, prizes_json } = body

    if (!campaign_id) {
      return NextResponse.json({ 
        success: false, 
        error: 'campaign_id is required' 
      }, { status: 400 })
    }

    // Validate status if provided
    if (status) {
      const validStatuses = ['draft', 'active', 'closed', 'drawn', 'completed']
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ 
          success: false, 
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
        }, { status: 400 })
      }
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

    // Verify campaign belongs to user's organization
    const { data: campaign, error: campaignError } = await supabase
      .from('lucky_draw_campaigns')
      .select('id, company_id, status')
      .eq('id', campaign_id)
      .eq('company_id', profile.organization_id)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
    }

    // Build update object dynamically
    const updateData: any = {
      updated_at: new Date().toISOString()
    }

    if (status) {
      updateData.status = status
    }

    if (prizes_json !== undefined) {
      updateData.prizes_json = prizes_json
    }

    // Update campaign
    const { data: updatedCampaign, error: updateError } = await supabase
      .from('lucky_draw_campaigns')
      .update(updateData)
      .eq('id', campaign_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating campaign:', updateError)
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
    }

    // Sync with Journey Builder configuration if status changed
    if (status) {
      try {
        // Find the link to get journey_config_id
        const { data: link } = await supabase
          .from('lucky_draw_order_links')
          .select('journey_config_id')
          .eq('campaign_id', campaign_id)
          .single()

        if (link && link.journey_config_id) {
          // Update journey configuration
          await supabase
            .from('journey_configurations')
            .update({ 
              lucky_draw_enabled: status === 'active',
              updated_at: new Date().toISOString()
            })
            .eq('id', link.journey_config_id)
        }
      } catch (syncError) {
        console.error('Error syncing with journey config:', syncError)
        // Don't fail the request if sync fails, just log it
      }
    }

    let message = 'Campaign updated successfully'
    if (status && prizes_json !== undefined) {
      message = `Campaign status updated to ${status} and prizes updated`
    } else if (status) {
      message = `Campaign status updated to ${status}`
    } else if (prizes_json !== undefined) {
      message = 'Campaign prizes updated successfully'
    }

    return NextResponse.json({ 
      success: true, 
      campaign: updatedCampaign,
      message
    })
  } catch (error) {
    console.error('Error in lucky-draw/campaigns PATCH:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
