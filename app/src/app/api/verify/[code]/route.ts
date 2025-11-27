import { NextRequest, NextResponse } from 'next/server'
import { parseQRCode } from '@/lib/qr-code-utils'
import { Database } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateQRCodeSecurity, getBaseCode, extractQRCodeParts } from '@/lib/security/qr-hash'

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

const PRODUCT_CONSUMER_READY_STATUSES = new Set([
  'received_warehouse',
  'shipped_distributor',
  'activated',
  'redeemed'
])

const MASTER_CONSUMER_READY_STATUSES = new Set([
  'in_transit',
  'received_warehouse',
  'shipped_distributor',
  'opened'
])

type OrderInfo = {
  id: string
  order_no: string
  company_id: string
  has_points?: boolean | null
  has_lucky_draw?: boolean | null
  has_redeem?: boolean | null
}

type QRCodeRow = {
  id: string
  order_id?: string | null
  status: string | null
  is_active: boolean | null
  order: OrderInfo | null
  product?: { product_name?: string | null } | null
  variant?: { variant_name?: string | null } | null
}

type MasterCodeRow = {
  status: string | null
}

type JourneyLinkRow = {
  journey_configurations: any | null
}

function buildInvalidResponse(message: string, status?: string | null) {
  return NextResponse.json({
    success: true,
    data: {
      is_valid: false,
      is_blocked: false,
      message,
      status: status ?? undefined
    }
  })
}

function buildBlockedResponse(message: string) {
  return NextResponse.json({
    success: true,
    data: {
      is_valid: false,
      is_blocked: true,
      message
    }
  })
}

function isJourneyActive(journey: any): boolean {
  if (!journey?.is_active) {
    return false
  }

  const now = new Date()

  if (journey.start_at) {
    const start = new Date(journey.start_at)
    if (Number.isFinite(start.valueOf()) && now < start) {
      return false
    }
  }

  if (journey.end_at) {
    const end = new Date(journey.end_at)
    if (Number.isFinite(end.valueOf()) && now > end) {
      return false
    }
  }

  return true
}

async function resolveJourneyConfig(
  supabaseAdmin: SupabaseAdminClient,
  orderId: string,
  companyId: string
) {
  try {
    const { data: linkedJourneysRaw, error: linkError } = await supabaseAdmin
      .from('journey_order_links')
      .select(
        `
          id,
          created_at,
          journey_configurations (*)
        `
      )
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })

    if (linkError) {
      console.error('Error fetching journey links:', linkError)
    }

    const linkedJourneys = linkedJourneysRaw as JourneyLinkRow[] | null

    if (linkedJourneys && linkedJourneys.length > 0) {
      for (const link of linkedJourneys) {
        const config = link.journey_configurations
        if (config && isJourneyActive(config)) {
          return config
        }
      }

      const fallback = linkedJourneys.find((link) => link.journey_configurations)
      if (fallback?.journey_configurations) {
        return fallback.journey_configurations
      }
    }

    const { data: defaultJourney, error: defaultError } = await supabaseAdmin
      .from('journey_configurations')
      .select('*')
      .eq('org_id', companyId)
      .eq('is_default', true)
      .eq('is_active', true)
      .limit(1)

    if (defaultError) {
      console.error('Error fetching default journey:', defaultError)
    }

    if (defaultJourney && defaultJourney.length > 0) {
      const config = defaultJourney[0]
      if (isJourneyActive(config)) {
        return config
      }
    }

    const { data: anyJourney, error: anyError } = await supabaseAdmin
      .from('journey_configurations')
      .select('*')
      .eq('org_id', companyId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)

    if (anyError) {
      console.error('Error fetching fallback journey:', anyError)
    }

    if (anyJourney && anyJourney.length > 0) {
      const config = anyJourney[0]
      if (isJourneyActive(config)) {
        return config
      }
      return config
    }

    return null
  } catch (error) {
    console.error('Unexpected error resolving journey configuration:', error)
    return null
  }
}

function normalizeJourneyConfig(journey: any, order?: OrderInfo | null) {
  const orderHasPoints = typeof order?.has_points === 'boolean' ? order.has_points : true
  const orderHasLuckyDraw = typeof order?.has_lucky_draw === 'boolean' ? order.has_lucky_draw : false
  const orderHasRedeem = typeof order?.has_redeem === 'boolean' ? order.has_redeem : false

  const pointsEnabled = typeof journey?.points_enabled === 'boolean'
    ? journey.points_enabled && orderHasPoints
    : orderHasPoints

  const luckyDrawEnabled = typeof journey?.lucky_draw_enabled === 'boolean'
    ? journey.lucky_draw_enabled && orderHasLuckyDraw
    : orderHasLuckyDraw

  const redemptionEnabled = typeof journey?.redemption_enabled === 'boolean'
    ? journey.redemption_enabled && orderHasRedeem
    : orderHasRedeem

  const redemptionRequiresLogin = !!journey?.require_customer_otp_for_redemption

  return {
    welcome_title: journey?.welcome_title ?? 'Welcome!',
    welcome_message:
      journey?.welcome_message ?? 'Thank you for scanning our QR code. Enjoy exclusive rewards and benefits!',
    thank_you_message: journey?.thank_you_message ?? 'Thank you for your participation!',
    primary_color: journey?.primary_color ?? '#2563eb',
    button_color: journey?.button_color ?? '#3b82f6',
    points_enabled: pointsEnabled,
    lucky_draw_enabled: luckyDrawEnabled,
    redemption_enabled: redemptionEnabled,
    show_product_image: journey?.show_product_image ?? false,
    product_image_source: journey?.product_image_source ?? 'genuine_badge',
    custom_image_url: journey?.custom_image_url ?? null,
    genuine_badge_style: journey?.genuine_badge_style ?? 'gold',
    redemption_requires_login: redemptionRequiresLogin,
    require_customer_otp_for_redemption: redemptionRequiresLogin
  }
}

async function handleProductCodeVerification(
  supabaseAdmin: SupabaseAdminClient,
  code: string
) {
  console.log('🔍 handleProductCodeVerification - Starting for code:', code)
  
  // Try to fetch the QR code directly first (exact match)
  console.log('🔍 Looking up code (exact match):', code)
  
  let qrRowsRaw: any = null
  let qrError: any = null
  
  // First attempt: exact match with full code
  const result1 = await supabaseAdmin
    .from('qr_codes')
    .select(
      `
        id,
        code,
        qr_hash,
        status,
        is_active,
        order_id,
        product:products!qr_codes_product_id_fkey ( product_name ),
        variant:product_variants!qr_codes_variant_id_fkey ( variant_name, image_url ),
        order:orders!qr_codes_order_id_fkey (
          id,
          order_no,
          company_id,
          has_points,
          has_lucky_draw,
          has_redeem
        )
      `
    )
    .eq('code', code)
    .limit(1)
  
  qrRowsRaw = result1.data
  qrError = result1.error
  
  // If not found and code looks like it might have a hash, try without the last segment
  if ((!qrRowsRaw || qrRowsRaw.length === 0) && !qrError) {
    const possibleBaseCode = getBaseCode(code)
    if (possibleBaseCode !== code) {
      console.log('🔍 Code not found, trying base code:', possibleBaseCode)
      const result2 = await supabaseAdmin
        .from('qr_codes')
        .select(
          `
            id,
            code,
            qr_hash,
            status,
            is_active,
            order_id,
            product:products!qr_codes_product_id_fkey ( product_name ),
            variant:product_variants!qr_codes_variant_id_fkey ( variant_name, image_url ),
            order:orders!qr_codes_order_id_fkey (
              id,
              order_no,
              company_id,
              has_points,
              has_lucky_draw,
              has_redeem
            )
          `
        )
        .eq('code', possibleBaseCode)
        .limit(1)
      
      qrRowsRaw = result2.data
      qrError = result2.error
    }
  }

  if (qrError) {
    console.error('❌ Error fetching QR code details:', qrError)
    console.error('❌ QR Error Details:', JSON.stringify(qrError, null, 2))
    console.error('❌ QR Code being searched:', code)
    return NextResponse.json(
      { success: false, error: 'Failed to verify code', debug: qrError.message },
      { status: 500 }
    )
  }

  const qrRows = qrRowsRaw as (QRCodeRow & { qr_hash?: string | null, code: string })[] | null
  const qrCode = qrRows?.[0]

  console.log('🔍 QR Code found:', qrCode ? 'YES' : 'NO')
  if (qrCode) {
    console.log('🔍 QR Code details:', {
      id: qrCode.id,
      code: qrCode.code,
      qr_hash: qrCode.qr_hash,
      status: qrCode.status,
      is_active: qrCode.is_active,
      order_id: qrCode.order_id
    })
  }

  if (!qrCode) {
    console.log('❌ QR code not found')
    return buildInvalidResponse('QR code not found or not activated')
  }

  // ===== SECURITY HASH VALIDATION =====
  // Now that we have the DB record, check if this code requires hash validation
  const storedHash = qrCode.qr_hash
  
  if (storedHash) {
    // This is a secure code with hash - validate it
    console.log('🔐 Secure code detected - validating hash')
    const securityCheck = validateQRCodeSecurity(code, false) // Don't allow legacy for hashed codes
    
    if (!securityCheck.isValid || !securityCheck.hasHash) {
      console.log('❌ Security validation failed:', securityCheck.reason)
      return buildInvalidResponse(
        'Invalid or tampered QR code. Please use the original QR code from the product.',
        null
      )
    }
    
    // Extract hash from scanned code and compare with stored hash
    const parts = extractQRCodeParts(code)
    if (!parts || parts.hash.toLowerCase() !== storedHash.toLowerCase()) {
      console.log('❌ Hash mismatch - scanned:', parts?.hash, 'stored:', storedHash)
      return buildInvalidResponse(
        'Invalid or tampered QR code. Please use the original QR code from the product.',
        null
      )
    }
    
    console.log('✅ Security hash validated successfully')
  } else {
    // Legacy code without stored hash - no validation needed
    console.log('⚠️ Legacy code without hash (qr_hash is NULL)')
  }
  // ===== END SECURITY CHECK =====

  // Note: is_blocked column doesn't exist in this database schema
  // If needed in the future, add: ALTER TABLE qr_codes ADD COLUMN is_blocked boolean DEFAULT false;

  if (qrCode.is_active === false) {
    console.log('❌ QR code is not active')
    return buildInvalidResponse('This QR code has been deactivated by the manufacturer.')
  }

  const status = qrCode.status as string | null

  console.log('🔍 Status check:', status, 'Valid statuses:', Array.from(PRODUCT_CONSUMER_READY_STATUSES))

  if (!status || !PRODUCT_CONSUMER_READY_STATUSES.has(status)) {
    console.log('❌ Status not in valid set')
    return buildInvalidResponse(
      'This QR code has not been activated yet. The product is still in the manufacturing or warehouse stage.',
      status
    )
  }

  console.log('✅ Status is valid!')
  
  let order = qrCode.order as OrderInfo | null

  if (!order && qrCode.order_id) {
    const { data: orderRow, error: standaloneOrderError } = await supabaseAdmin
      .from('orders')
      .select('id, order_no, company_id, has_points, has_lucky_draw, has_redeem')
      .eq('id', qrCode.order_id)
      .maybeSingle()

    if (standaloneOrderError) {
      console.error('Error fetching order fallback for QR code:', standaloneOrderError)
    }

    if (orderRow) {
      order = orderRow as OrderInfo
    }
  }

  if (!order) {
    console.warn('QR code missing order linkage:', code)
    return buildInvalidResponse('This QR code is not linked to a valid order.')
  }

  const journey = await resolveJourneyConfig(supabaseAdmin, order.id, order.company_id)
  const journeyConfig = normalizeJourneyConfig(journey, order)

  return NextResponse.json({
    success: true,
    data: {
      is_valid: true,
      is_blocked: false,
      status,
      journey_config: {
        ...journeyConfig,
        variant_image_url: qrCode.variant?.image_url ?? null
      },
      product_info: {
        product_name: qrCode.product?.product_name ?? undefined,
        variant_name: qrCode.variant?.variant_name ?? undefined
      },
      order_info: {
        order_no: order.order_no
      }
    }
  })
}

async function handleMasterCodeVerification(
  supabaseAdmin: SupabaseAdminClient,
  code: string,
  orderNo?: string | null
) {
  const { data: masterRowsRaw, error: masterError } = await supabaseAdmin
    .from('qr_master_codes')
    .select('status')
    .eq('master_code', code)
    .limit(1)

  if (masterError) {
    console.error('Error fetching master QR code details:', masterError)
    return NextResponse.json(
      { success: false, error: 'Failed to verify code' },
      { status: 500 }
    )
  }

  const masterRows = masterRowsRaw as MasterCodeRow[] | null
  const master = masterRows?.[0]

  if (!master) {
    return buildInvalidResponse('QR code not found or not activated')
  }

  const status = master.status as string | null

  if (!status || !MASTER_CONSUMER_READY_STATUSES.has(status)) {
    return buildInvalidResponse(
      'This QR code has not been activated yet. The product is still in the distribution process.',
      status
    )
  }

  if (!orderNo) {
    return buildInvalidResponse('Unable to determine the related order for this QR code.')
  }

  const { data: orderRowsRaw, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, order_no, company_id, has_points, has_lucky_draw, has_redeem')
    .eq('order_no', orderNo)
    .limit(1)

  if (orderError) {
    console.error('Error fetching order for master QR:', orderError)
    return NextResponse.json(
      { success: false, error: 'Failed to verify code' },
      { status: 500 }
    )
  }

  const orderRows = orderRowsRaw as OrderInfo[] | null
  const order = orderRows?.[0]

  if (!order) {
    return buildInvalidResponse('Related order not found for this QR code.')
  }

  const journey = await resolveJourneyConfig(supabaseAdmin, order.id, order.company_id)
  const journeyConfig = normalizeJourneyConfig(journey, order)

  return NextResponse.json({
    success: true,
    data: {
      is_valid: true,
      is_blocked: false,
      status,
      journey_config: journeyConfig,
      product_info: null,
      order_info: {
        order_no: order.order_no
      }
    }
  })
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await context.params

    console.log('🔍 API Verify - Received code:', code)

    if (!code) {
      return NextResponse.json(
        { success: false, error: 'No code provided' },
        { status: 400 }
      )
    }

    const supabaseAdmin = createAdminClient()

    const parsed = parseQRCode(code)

    console.log('🔍 API Verify - Parsed QR:', parsed)

    if (!parsed.isValid) {
      console.log('❌ API Verify - Invalid QR format')
      return buildInvalidResponse('Invalid QR code format')
    }

    if (parsed.type === 'MASTER') {
      console.log('🔍 API Verify - Master code, calling handleMasterCodeVerification')
      return handleMasterCodeVerification(supabaseAdmin, code, parsed.orderNo)
    }

    console.log('🔍 API Verify - Product code, calling handleProductCodeVerification')
    const result = await handleProductCodeVerification(supabaseAdmin, code)
    console.log('🔍 API Verify - Result:', JSON.stringify(result, null, 2))
    return result
  } catch (error) {
    console.error('❌ Unexpected error in verify API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export const revalidate = 300
