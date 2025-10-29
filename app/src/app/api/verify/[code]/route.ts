import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await context.params

    if (!code) {
      return NextResponse.json(
        { success: false, error: 'No code provided' },
        { status: 400 }
      )
    }

    // Create Supabase client with service role key for server-side operations
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

    // Call the public verification RPC function
    const { data, error } = await supabaseAdmin.rpc('verify_case_public', {
      p_code: code
    })

    if (error) {
      console.error('Error verifying code:', error)
      
      // Check if it's a function not found error
      if (error.message?.includes('function') && error.message?.includes('does not exist')) {
        // RPC function doesn't exist - fallback to basic validation
        console.warn('verify_case_public function not found, using fallback')
        
        // Basic QR code lookup
        const { data: qrCode, error: qrError } = await supabaseAdmin
          .from('qr_codes')
          .select(`
            *,
            products (product_name, product_code),
            product_variants (variant_name),
            qr_batches (
              order_id,
              orders (
                order_no,
                journey_order_links (
                  journey_configurations (
                    welcome_title,
                    welcome_message,
                    thank_you_message,
                    primary_color,
                    button_color,
                    points_enabled,
                    lucky_draw_enabled,
                    redemption_enabled
                  )
                )
              )
            )
          `)
          .eq('code', code)
          .single()

        if (qrError || !qrCode) {
          console.log('QR Code not found:', code)
          return NextResponse.json({
            success: true,
            data: {
              is_valid: false,
              is_blocked: false,
              message: 'QR code not found or not activated'
            }
          })
        }

        // Check if blocked
        if (qrCode.is_blocked) {
          console.log('QR Code is blocked:', code)
          return NextResponse.json({
            success: true,
            data: {
              is_valid: false,
              is_blocked: true,
              message: 'This QR code has been blocked'
            }
          })
        }

        // Check if QR code has been shipped to distributor (activated)
        // QR codes are only valid for consumer scanning after they've been shipped
        if (qrCode.status !== 'shipped_distributor' && qrCode.status !== 'shipped_retailer') {
          console.log('QR Code not yet activated (not shipped):', code, 'Status:', qrCode.status)
          return NextResponse.json({
            success: true,
            data: {
              is_valid: false,
              is_blocked: false,
              message: 'This QR code has not been activated yet. The product is still in the manufacturing or warehouse stage.',
              status: qrCode.status
            }
          })
        }

        // QR code is valid - extract journey config
        console.log('QR Code found and activated, extracting journey config for:', code, 'Status:', qrCode.status)

        // Extract journey config
        const batchData = Array.isArray(qrCode.qr_batches) ? qrCode.qr_batches[0] : qrCode.qr_batches
        const orderData = batchData?.orders ? (Array.isArray(batchData.orders) ? batchData.orders[0] : batchData.orders) : null
        const journeyLinks = orderData?.journey_order_links || []
        
        console.log('Batch Data:', batchData ? 'Found' : 'None')
        console.log('Order Data:', orderData ? orderData.order_no : 'None')
        console.log('Journey Links:', journeyLinks.length)
        
        // Find first active journey configuration
        let journeyConfig = null
        for (const link of journeyLinks) {
          const config = Array.isArray(link.journey_configurations) 
            ? link.journey_configurations[0] 
            : link.journey_configurations
          
          if (config && config.is_active) {
            journeyConfig = config
            console.log('Found active journey:', config.name)
            break
          }
        }
        
        // If no active journey, use first journey if exists
        if (!journeyConfig && journeyLinks.length > 0) {
          journeyConfig = Array.isArray(journeyLinks[0].journey_configurations) 
            ? journeyLinks[0].journey_configurations[0] 
            : journeyLinks[0].journey_configurations
          console.log('Using first journey (not active):', journeyConfig?.name)
        }

        return NextResponse.json({
          success: true,
          data: {
            is_valid: true,
            is_blocked: false,
            journey_config: journeyConfig || {
              welcome_title: 'Welcome!',
              welcome_message: 'Thank you for scanning our QR code',
              thank_you_message: 'Thank you!',
              primary_color: '#2563eb',
              button_color: '#3b82f6',
              points_enabled: true,
              lucky_draw_enabled: true,
              redemption_enabled: true
            },
            product_info: {
              product_name: qrCode.products?.product_name,
              variant_name: qrCode.product_variants?.variant_name
            },
            order_info: {
              order_no: orderData?.order_no
            }
          }
        })
      }
      
      // Other errors
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    // Return the verification result from RPC
    return NextResponse.json({
      success: true,
      data: data || null
    })

  } catch (error) {
    console.error('Unexpected error in verify API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Enable caching for valid codes (optional)
export const revalidate = 300 // Cache for 5 minutes
