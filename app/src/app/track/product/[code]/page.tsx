import { Metadata } from 'next'
import PublicJourneyView from '@/components/journey/PublicJourneyView'

export const metadata: Metadata = {
  title: 'Track Product | Serapod2U',
  description: 'Track your product and access exclusive rewards',
}

interface PageProps {
  params: Promise<{
    code: string
  }>
}

async function getJourneyData(code: string) {
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()

    console.log('🔍 getJourneyData - Verifying code:', code)

    const { data: qrCode, error: qrError } = await supabase
      .from('qr_codes')
      .select(`
        id,
        code,
        order_id,
        product_id,
        variant_id,
        points_value,
        has_lucky_draw,
        has_redeem,
        status,
        company_id
      `)
      .eq('code', code)
      .single()

    if (qrError) {
      console.error('❌ QR Code query error:', qrError)
      return { success: false, error: 'Invalid QR code' }
    }

    if (!qrCode) {
      console.log('❌ QR Code not found:', code)
      return { success: false, error: 'Invalid QR code' }
    }

    console.log('✅ QR Code found:', qrCode.id)

    const { data: journeyConfig, error: journeyError } = await supabase
      .from('journey_configurations')
      .select('*')
      .eq('org_id', qrCode.company_id)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (journeyError) {
      console.error('❌ Journey config query error:', journeyError)
      console.log('🔍 QR Code company_id:', qrCode.company_id)
    }

    let variant = null
    let product = null

    if (qrCode.variant_id) {
      const { data: v, error: vError } = await supabase
        .from('product_variants')
        .select(`
          id,
          variant_name,
          image_url,
          products(
            id,
            product_name,
            brands(brand_name),
            product_images(image_url, is_primary)
          )
        `)
        .eq('id', qrCode.variant_id)
        .single()
      
      if (v) {
        variant = v
        product = v.products
      } else if (vError) {
        console.error('❌ Variant query error:', vError)
      }
    }

    // Fallback: If no variant found but product_id exists, fetch product directly
    if (!product && qrCode.product_id) {
      const { data: p, error: pError } = await supabase
        .from('products')
        .select(`
          id,
          product_name,
          brands(brand_name),
          product_images(image_url, is_primary)
        `)
        .eq('id', qrCode.product_id)
        .single()
      
      if (p) {
        product = p
      } else if (pError) {
        console.error('❌ Product query error:', pError)
      }
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('order_no')
      .eq('id', qrCode.order_id)
      .single()

    if (orderError) {
      console.error('❌ Order query error:', orderError)
    }

    const brand = Array.isArray(product?.brands) ? product.brands[0] : product?.brands

    // Get active lucky draw campaign for this order
    let luckyDrawCampaign = null
    if (qrCode.order_id) {
      const { data: links } = await supabase
        .from('lucky_draw_order_links')
        .select('campaign_id')
        .eq('order_id', qrCode.order_id)
        .limit(1)
        .maybeSingle()

        if (links?.campaign_id) {
        const { data: campaign } = await supabase
          .from('lucky_draw_campaigns')
          .select('campaign_name, campaign_image_url, status, start_date, end_date, prizes_json')
          .eq('id', links.campaign_id)
          .eq('status', 'active')
          .lte('start_date', new Date().toISOString())
          .gte('end_date', new Date().toISOString())
          .maybeSingle()
        
        if (campaign) {
          luckyDrawCampaign = campaign
        }
      }
    }

    // Get product image fallback
    let fallbackImage = null
    if (product?.product_images && Array.isArray(product.product_images) && product.product_images.length > 0) {
      const primary = product.product_images.find((img: any) => img.is_primary)
      fallbackImage = primary ? primary.image_url : product.product_images[0].image_url
    }

    console.log('🖼️ Image Debug:', {
      variant_image: variant?.image_url,
      fallback_image: fallbackImage,
      product_images_count: product?.product_images?.length
    })

    if (!journeyConfig) {
      console.log('❌ No journey configuration found for QR code:', qrCode.id)
      return {
        success: false,
        error: 'No journey configuration found for this QR code'
      }
    }

    return {
      success: true,
      data: {
        is_valid: true,
        status: qrCode.status,
        journey_config: {
          id: journeyConfig.id,
          welcome_title: journeyConfig.welcome_title,
          welcome_message: journeyConfig.welcome_message,
          thank_you_message: journeyConfig.thank_you_message,
          primary_color: journeyConfig.primary_color,
          button_color: journeyConfig.button_color,
          points_enabled: journeyConfig.points_enabled,
          lucky_draw_enabled: journeyConfig.lucky_draw_enabled,
          redemption_enabled: journeyConfig.redemption_enabled,
          enable_scratch_card_game: journeyConfig.enable_scratch_card_game,
          scratch_card_require_otp: journeyConfig.scratch_card_require_otp,
          
          // Feature Customization
          points_title: journeyConfig.points_title,
          points_description: journeyConfig.points_description,
          points_icon: journeyConfig.points_icon,
          
          lucky_draw_title: journeyConfig.lucky_draw_title,
          lucky_draw_description: journeyConfig.lucky_draw_description,
          lucky_draw_icon: journeyConfig.lucky_draw_icon,
          
          redemption_title: journeyConfig.redemption_title,
          redemption_description: journeyConfig.redemption_description,
          redemption_icon: journeyConfig.redemption_icon,
          
          scratch_card_title: journeyConfig.scratch_card_title,
          scratch_card_description: journeyConfig.scratch_card_description,
          scratch_card_icon: journeyConfig.scratch_card_icon,

          show_product_image: journeyConfig.show_product_image,
          product_image_source: journeyConfig.product_image_source || 'variant',
          custom_image_url: journeyConfig.custom_image_url,
          genuine_badge_style: journeyConfig.genuine_badge_style,
          redemption_requires_login: journeyConfig.redemption_requires_login || false,
          variant_image_url: variant?.image_url || fallbackImage || null,
          lucky_draw_image_url: luckyDrawCampaign?.campaign_image_url || null,
          lucky_draw_campaign_name: luckyDrawCampaign?.campaign_name || null,
          lucky_draw_prizes: luckyDrawCampaign?.prizes_json || []
        },
        product_info: {
          product_name: product?.product_name,
          variant_name: variant?.variant_name,
          brand_name: brand?.brand_name
        },
        order_info: {
          order_no: order?.order_no
        },
        message: 'QR code verified successfully'
      }
    }

  } catch (error) {
    console.error('❌ Error fetching journey data:', error)
    return { success: false, error: 'Database error' }
  }
}

export default async function TrackProductPage({ params }: PageProps) {
  const { code } = await params
  const result = await getJourneyData(code)

  // Debug logging
  console.log('🔍 Track Product Page - Code:', code)
  console.log('🔍 Track Product Page - API Result:', JSON.stringify(result, null, 2))

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicJourneyView 
        code={code}
        verificationResult={result}
      />
    </div>
  )
}
