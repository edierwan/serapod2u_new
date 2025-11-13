import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateQRCodeSecurity, getBaseCode } from '@/lib/security/qr-hash'

/**
 * Track consumer QR code scan
 * POST /api/consumer/track-scan
 * 
 * Body:
 * {
 *   qr_code: string,
 *   journey_config_id?: string,
 *   action?: 'view' | 'collect_points' | 'lucky_draw' | 'redeem'
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { qr_code, journey_config_id, action = 'view' } = body

    if (!qr_code) {
      return NextResponse.json(
        { success: false, error: 'QR code is required' },
        { status: 400 }
      )
    }

    // ===== NEW: Validate QR code security hash =====
    const securityCheck = validateQRCodeSecurity(qr_code, true) // Allow legacy codes
    
    if (!securityCheck.isValid) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid or tampered QR code',
          details: securityCheck.reason 
        },
        { status: 400 }
      )
    }
    
    // Use base code (without hash) for database lookup
    const baseCode = securityCheck.baseCode
    console.log('🔐 Security check passed. Using base code:', baseCode)
    // ===== END SECURITY CHECK =====

    // Use service role for server-side operations
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Get QR code ID - use base code
    const { data: qrCodeData, error: qrError } = await supabaseAdmin
      .from('qr_codes')
      .select('id')
      .eq('code', baseCode) // Use base code for lookup
      .maybeSingle()

    if (qrError || !qrCodeData) {
      // QR code doesn't exist in database yet (preview/test code)
      // Return success without tracking to avoid blocking user experience
      console.log('⚠️ QR code not found in database (preview mode):', baseCode)
      return NextResponse.json({
        success: true,
        preview: true,
        message: 'Scan tracked (preview mode - code not in database yet)'
      })
    }

    // Get user info if authenticated (optional)
    const authHeader = request.headers.get('authorization')
    let userId = null
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '')
      const { data: { user } } = await supabaseAdmin.auth.getUser(token)
      userId = user?.id || null
    }

    // Get request metadata
    const ipAddress = request.headers.get('x-forwarded-for') || 
                      request.headers.get('x-real-ip') || 
                      'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // Prepare scan data
    const scanData: any = {
      qr_code_id: qrCodeData.id,
      consumer_id: userId,
      journey_config_id: journey_config_id || null,
      ip_address: ipAddress,
      user_agent: userAgent,
      viewed_welcome: true
    }

    // Set action flags
    if (action === 'collect_points') {
      scanData.collected_points = true
      scanData.points_collected_at = new Date().toISOString()
    } else if (action === 'lucky_draw') {
      scanData.entered_lucky_draw = true
    } else if (action === 'redeem') {
      scanData.redeemed_gift = true
    }

    // Insert consumer scan record
    const { data: scanRecord, error: scanError } = await supabaseAdmin
      .from('consumer_qr_scans')
      .insert(scanData)
      .select()
      .single()

    if (scanError) {
      console.error('Error recording consumer scan:', scanError)
      return NextResponse.json(
        { success: false, error: 'Failed to record scan' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        scan_id: scanRecord.id,
        scanned_at: scanRecord.scanned_at
      }
    })

  } catch (error: any) {
    console.error('Error in track-scan API:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Get consumer scan statistics
 * GET /api/consumer/track-scan?qr_code=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const qrCode = searchParams.get('qr_code')

    if (!qrCode) {
      return NextResponse.json(
        { success: false, error: 'QR code is required' },
        { status: 400 }
      )
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Get QR code with scan stats
    const { data: qrCodeData, error } = await supabaseAdmin
      .from('qr_codes')
      .select(`
        id,
        code,
        first_consumer_scan_at,
        total_consumer_scans,
        consumer_qr_scans (
          id,
          scanned_at,
          collected_points,
          entered_lucky_draw,
          redeemed_gift,
          consumer_id
        )
      `)
      .eq('code', qrCode)
      .single()

    if (error || !qrCodeData) {
      return NextResponse.json(
        { success: false, error: 'QR code not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        total_scans: qrCodeData.total_consumer_scans || 0,
        first_scan: qrCodeData.first_consumer_scan_at,
        scans: qrCodeData.consumer_qr_scans || []
      }
    })

  } catch (error: any) {
    console.error('Error fetching scan stats:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
