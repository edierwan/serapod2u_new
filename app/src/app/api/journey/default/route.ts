/**
 * GET /api/journey/default
 * Get the default active journey configuration for a given org
 * This is used when users access /app directly without a QR code
 * 
 * Query params:
 *   org_id: string (optional) - Organization ID to fetch journey for
 *   
 * If no org_id is provided, it will try to get the first active default journey
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        // Use service role client to bypass RLS for public consumer access
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
            console.error('Missing Supabase environment variables')
            return NextResponse.json(
                { success: false, error: 'Server configuration error' },
                { status: 500 }
            )
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        )

        const { searchParams } = new URL(request.url)
        const orgId = searchParams.get('org_id')

        // Use * to select all columns (TypeScript types may not be up to date)
        let query = supabase
            .from('journey_configurations')
            .select('*')
            .eq('is_active', true)

        // Filter by org_id if provided
        if (orgId) {
            query = query.eq('org_id', orgId)
        }

        // Order by is_default (true first), then by created_at
        const { data: journeys, error } = await query
            .order('is_default', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)

        if (error) {
            console.error('Error fetching default journey:', error)
            return NextResponse.json(
                { success: false, error: 'Failed to fetch journey configuration' },
                { status: 500 }
            )
        }

        if (!journeys || journeys.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No active journey configuration found' },
                { status: 404 }
            )
        }

        const journey = journeys[0] as any

        return NextResponse.json({
            success: true,
            data: {
                org_id: journey.org_id,
                journey_config: {
                    id: journey.id,
                    template_type: journey.template_type || 'premium',
                    welcome_title: journey.welcome_title,
                    welcome_message: journey.welcome_message,
                    thank_you_message: journey.thank_you_message,
                    primary_color: journey.primary_color,
                    button_color: journey.button_color,
                    points_enabled: journey.points_enabled,
                    lucky_draw_enabled: journey.lucky_draw_enabled,
                    redemption_enabled: journey.redemption_enabled,
                    enable_scratch_card_game: journey.enable_scratch_card_game,
                    scratch_card_require_otp: journey.scratch_card_require_otp,
                    require_security_code: journey.require_security_code || false,
                    skip_security_code_for_points: journey.skip_security_code_for_points || false,
                    skip_security_code_for_lucky_draw: journey.skip_security_code_for_lucky_draw || false,
                    skip_security_code_for_redemption: journey.skip_security_code_for_redemption || false,
                    skip_security_code_for_scratch_card: journey.skip_security_code_for_scratch_card || false,
                    points_title: journey.points_title,
                    points_description: journey.points_description,
                    points_icon: journey.points_icon,
                    lucky_draw_title: journey.lucky_draw_title,
                    lucky_draw_description: journey.lucky_draw_description,
                    lucky_draw_icon: journey.lucky_draw_icon,
                    redemption_title: journey.redemption_title,
                    redemption_description: journey.redemption_description,
                    redemption_icon: journey.redemption_icon,
                    scratch_card_title: journey.scratch_card_title,
                    scratch_card_description: journey.scratch_card_description,
                    scratch_card_icon: journey.scratch_card_icon,
                    banner_config: journey.banner_config,
                    show_product_image: journey.show_product_image,
                    product_image_source: journey.product_image_source || 'variant',
                    custom_image_url: journey.custom_image_url,
                    genuine_badge_style: journey.genuine_badge_style,
                    redemption_requires_login: journey.redemption_requires_login || false,
                    variant_image_url: null,
                    lucky_draw_image_url: null,
                    lucky_draw_campaign_name: null,
                    lucky_draw_prizes: []
                }
            }
        })
    } catch (error) {
        console.error('Error in default journey API:', error)
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        )
    }
}
