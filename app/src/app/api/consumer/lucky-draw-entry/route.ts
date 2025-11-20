import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getBaseCode } from '@/lib/security/qr-hash'

/**
 * POST /api/consumer/lucky-draw-entry
 * Submit a lucky draw entry from a consumer scanning a QR code
 * 
 * Body:
 *   qr_code: string - The QR code that was scanned (with or without hash suffix)
 *   consumer_name: string - Consumer's name
 *   consumer_phone: string - Consumer's phone number
 *   consumer_email?: string - Consumer's email (optional)
 */
export async function POST(request: NextRequest) {
  try {
    // Use service role for consumer operations (no auth required)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )
    
    const { qr_code, consumer_name, consumer_phone, consumer_email } = await request.json()

    // Validate required fields
    if (!qr_code || !consumer_name || !consumer_phone) {
      return NextResponse.json(
        { success: false, error: 'QR code, name, and phone are required' },
        { status: 400 }
      )
    }

    // Extract base code (remove hash suffix if present)
    const baseCode = getBaseCode(qr_code)
    console.log('🔐 Lucky Draw Entry - Scanned code:', qr_code)
    console.log('🔐 Lucky Draw Entry - Base code:', baseCode)

    // 1. Find the QR code and get its order_id
    // Try exact match first (for codes stored with hash), then try base code (for legacy codes)
    let qrCodeData: any = null
    let qrError: any = null

    // First attempt: exact match with full code (including hash if present)
    const { data: exactMatch, error: exactError } = await supabase
      .from('qr_codes')
      .select('id, order_id, status, code')
      .eq('code', qr_code)
      .maybeSingle()

    if (exactMatch) {
      console.log('✅ Found exact match with full code')
      qrCodeData = exactMatch
    } else {
      console.log('⚠️ Exact match not found, trying base code:', baseCode)
      // Second attempt: try with base code (for legacy codes without hash suffix)
      const { data: baseMatch, error: baseError } = await supabase
        .from('qr_codes')
        .select('id, order_id, status, code')
        .eq('code', baseCode)
        .maybeSingle()

      if (baseMatch) {
        console.log('✅ Found match with base code')
        qrCodeData = baseMatch
      } else {
        qrError = baseError || exactError
      }
    }

    if (!qrCodeData) {
      console.error('QR code not found:', qrError)
      console.error('Tried codes:', { full: qr_code, base: baseCode })
      return NextResponse.json(
        { 
          success: false, 
          error: 'This QR code is not yet active in the system. This is a preview/demo code.',
          preview: true
        },
        { status: 404 }
      )
    }

    console.log('✅ QR Code found:', qrCodeData.code)

    // Only allow valid statuses to participate (not printed/inactive)
    const validStatuses = ['received_warehouse', 'warehouse_packed', 'shipped_distributor', 'activated', 'verified']
    if (!qrCodeData.status || !validStatuses.includes(qrCodeData.status)) {
      return NextResponse.json(
        { success: false, error: 'QR code is not active or has not been shipped yet' },
        { status: 400 }
      )
    }

    // 2. Get the order details
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select('id, company_id, order_no')
      .eq('id', qrCodeData.order_id)
      .single()

    if (orderError || !orderData) {
      console.error('Order not found:', orderError)
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      )
    }

    // 3. Find active lucky draw campaigns for this order
    const { data: campaigns, error: campaignError } = await supabase
      .from('lucky_draw_order_links')
      .select(`
        campaign_id,
        lucky_draw_campaigns (
          id,
          company_id,
          campaign_name,
          status,
          start_date,
          end_date
        )
      `)
      .eq('order_id', orderData.id)

    if (campaignError) {
      console.error('Error fetching campaigns:', campaignError)
      return NextResponse.json(
        { success: false, error: 'Error fetching campaigns' },
        { status: 500 }
      )
    }

    // Filter to only active campaigns within date range
    const now = new Date()
    const activeCampaigns = campaigns?.filter((link: any) => {
      const campaign = Array.isArray(link.lucky_draw_campaigns) 
        ? link.lucky_draw_campaigns[0] 
        : link.lucky_draw_campaigns
      
      if (!campaign || campaign.status !== 'active') return false
      
      const startDate = campaign.start_date ? new Date(campaign.start_date) : null
      const endDate = campaign.end_date ? new Date(campaign.end_date) : null
      
      if (startDate && now < startDate) return false
      if (endDate && now > endDate) return false
      
      return true
    }) || []

    if (activeCampaigns.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No active lucky draw campaigns available for this product' },
        { status: 404 }
      )
    }

    // Use the first active campaign - handle both array and object response
    const campaignData = activeCampaigns[0].lucky_draw_campaigns
    const selectedCampaign = Array.isArray(campaignData) ? campaignData[0] : campaignData

    // 4. Check if this QR code has already been used for entry in this campaign
    // Each QR code can only create one entry per campaign
    const { data: existingEntry, error: existingError } = await supabase
      .from('lucky_draw_entries')
      .select('id, entry_number, consumer_name')
      .eq('campaign_id', selectedCampaign.id)
      .eq('qr_code_id', qrCodeData.id)
      .maybeSingle()

    if (existingEntry) {
      return NextResponse.json({
        success: true,
        already_entered: true,
        entry: {
          entry_number: existingEntry.entry_number,
          campaign_name: selectedCampaign.campaign_name,
          consumer_name: existingEntry.consumer_name
        },
        message: 'This QR code has already been used to enter this lucky draw'
      })
    }

    // 5. Generate unique entry number using QR code sequence
    // Format: ENTRY-{campaign_id_prefix}-{qr_code_id_suffix}
    const campaignPrefix = selectedCampaign.id.slice(0, 8)
    const qrSuffix = qrCodeData.id.slice(-8)
    const entryNumber = `ENTRY-${campaignPrefix}-${qrSuffix}`.toUpperCase()

    // 6. Create the lucky draw entry
    const { data: newEntry, error: insertError } = await supabase
      .from('lucky_draw_entries')
      .insert({
        campaign_id: selectedCampaign.id,
        company_id: orderData.company_id,
        consumer_phone: consumer_phone,
        consumer_email: consumer_email || null,
        consumer_name: consumer_name,
        qr_code_id: qrCodeData.id,
        entry_number: entryNumber,
        entry_date: new Date().toISOString(),
        entry_status: 'entered',
        is_winner: false,
        prize_claimed: false
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error creating entry:', insertError)
      return NextResponse.json(
        { success: false, error: 'Failed to create lucky draw entry: ' + insertError.message },
        { status: 500 }
      )
    }

    // 7. Track the consumer scan activity (optional - for analytics)
    try {
      await supabase
        .from('consumer_qr_scans')
        .insert({
          qr_code_id: qrCodeData.id,
          order_id: orderData.id,
          company_id: orderData.company_id,
          consumer_phone: consumer_phone,
          consumer_email: consumer_email || null,
          scan_date: new Date().toISOString(),
          entered_lucky_draw: true
        })
    } catch (trackError) {
      console.error('Error tracking scan (non-blocking):', trackError)
      // Don't fail the request if tracking fails
    }

    return NextResponse.json({
      success: true,
      entry: {
        id: newEntry.id,
        entry_number: newEntry.entry_number,
        campaign_name: selectedCampaign.campaign_name,
        entry_date: newEntry.entry_date
      },
      message: 'Successfully entered lucky draw!'
    })

  } catch (error) {
    console.error('Error in consumer/lucky-draw-entry:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
