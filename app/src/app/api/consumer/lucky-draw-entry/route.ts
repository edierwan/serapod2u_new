import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveQrCodeRecord } from '@/lib/utils/qr-resolver'

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

    console.log('🎰 Lucky Draw Entry - QR Code:', qr_code)

    // 1. Resolve the QR code to get full record
    const qrCodeData = await resolveQrCodeRecord(supabase, qr_code)
    
    if (!qrCodeData) {
      console.log('❌ QR code not found')
      return NextResponse.json(
        { success: false, error: 'QR code not found', code: 'QR_NOT_FOUND' },
        { status: 404 }
      )
    }

    console.log('✅ QR Code found:', qrCodeData.code, 'Order ID:', qrCodeData.order_id)

    // 2. Get order details
    if (!qrCodeData.order_id) {
      return NextResponse.json(
        { success: false, error: 'No order associated with this QR code' },
        { status: 400 }
      )
    }

    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .select('id, company_id, order_no')
      .eq('id', qrCodeData.order_id)
      .single()

    if (orderError || !orderData) {
      console.error('❌ Order not found:', orderError)
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      )
    }

    console.log('✅ Order found:', orderData.order_no, 'Company ID:', orderData.company_id)

    // 3. Find active lucky draw campaign for this company
    const now = new Date().toISOString()
    const { data: campaign, error: campaignError } = await supabase
      .from('lucky_draw_campaigns')
      .select('id, campaign_name, status, start_date, end_date, max_entries_per_consumer')
      .eq('company_id', orderData.company_id)
      .eq('status', 'active')
      .lte('start_date', now)
      .gte('end_date', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (campaignError) {
      console.error('❌ Campaign lookup error:', campaignError)
      return NextResponse.json(
        { success: false, error: 'Error looking up campaign' },
        { status: 500 }
      )
    }

    if (!campaign) {
      console.log('❌ No active campaign found for company:', orderData.company_id)
      return NextResponse.json(
        { success: false, error: 'No active lucky draw campaign found', code: 'NO_CAMPAIGN' },
        { status: 404 }
      )
    }

    console.log('✅ Active campaign found:', campaign.campaign_name)

    // 4. Check if QR code already used for lucky draw (CRITICAL: Check QR code flag first!)
    if (qrCodeData.is_lucky_draw_entered) {
      console.log('⚠️ QR code already used for lucky draw (flag check)')
      // Try to find the entry to return details
      const { data: existingEntry } = await supabase
        .from('lucky_draw_entries')
        .select('id, entry_number, consumer_name')
        .eq('qr_code_id', qrCodeData.id)
        .maybeSingle()
      
      return NextResponse.json({
        success: true,
        already_entered: true,
        entry_number: existingEntry?.entry_number || 'N/A',
        message: 'This QR code has already been used to enter the lucky draw!'
      })
    }

    // 4b. BULLETPROOF: Also check lucky_draw_entries table directly (in case flag wasn't set)
    const { data: qrExistingEntry } = await supabase
      .from('lucky_draw_entries')
      .select('id, entry_number, consumer_name')
      .eq('qr_code_id', qrCodeData.id)
      .maybeSingle()
    
    if (qrExistingEntry) {
      console.log('⚠️ QR code already has entry in table (flag was not set!):', qrExistingEntry.entry_number)
      // Fix the flag for future checks
      await supabase
        .from('qr_codes')
        .update({ 
          is_lucky_draw_entered: true,
          lucky_draw_entered_at: new Date().toISOString()
        })
        .eq('id', qrCodeData.id)
      
      return NextResponse.json({
        success: true,
        already_entered: true,
        entry_number: qrExistingEntry.entry_number,
        message: 'This QR code has already been used to enter the lucky draw!'
      })
    }

    // 5. Also check by consumer phone (secondary check)
    const { data: existingEntry } = await supabase
      .from('lucky_draw_entries')
      .select('id, entry_number')
      .eq('campaign_id', campaign.id)
      .eq('consumer_phone', consumer_phone)
      .maybeSingle()

    if (existingEntry) {
      console.log('⚠️ Consumer already entered this campaign:', existingEntry.entry_number)
      return NextResponse.json({
        success: true,
        already_entered: true,
        entry_number: existingEntry.entry_number,
        message: 'You have already entered this lucky draw campaign!'
      })
    }

    // 6. Generate unique entry number
    const { count: entryCount } = await supabase
      .from('lucky_draw_entries')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)

    const entryNumber = `LD-${String((entryCount || 0) + 1).padStart(6, '0')}`

    // 7. Insert the entry
    const { data: newEntry, error: insertError } = await supabase
      .from('lucky_draw_entries')
      .insert({
        campaign_id: campaign.id,
        company_id: orderData.company_id,
        qr_code_id: qrCodeData.id,
        consumer_name: consumer_name,
        consumer_phone: consumer_phone,
        consumer_email: consumer_email || null,
        entry_number: entryNumber,
        entry_status: 'pending',
        entry_date: new Date().toISOString()
      })
      .select('id, entry_number')
      .single()

    if (insertError) {
      console.error('❌ Insert error:', insertError)
      return NextResponse.json(
        { success: false, error: 'Failed to create entry: ' + insertError.message },
        { status: 500 }
      )
    }

    console.log('✅ Entry created:', newEntry.entry_number)

    // 8. CRITICAL: Set the QR code flag to prevent duplicate entries
    const { error: flagError } = await supabase
      .from('qr_codes')
      .update({
        is_lucky_draw_entered: true,
        lucky_draw_entered_at: new Date().toISOString()
      })
      .eq('id', qrCodeData.id)
    
    if (flagError) {
      console.error('⚠️ Failed to set QR flag (entry created but flag not set):', flagError)
      // Entry was created, so we still return success but log the warning
    } else {
      console.log('✅ QR code flag set successfully')
    }

    return NextResponse.json({
      success: true,
      entry_number: newEntry.entry_number,
      campaign_name: campaign.campaign_name,
      message: 'Successfully entered the lucky draw!'
    })

  } catch (error) {
    console.error('Error in consumer/lucky-draw-entry:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
