/**
 * Bot User Resolution Endpoint
 * 
 * GET /api/bot/resolve-user?phone=60123456789
 * 
 * Resolves a phone number to a user account.
 * Used by Moltbot for user recognition.
 * 
 * Security: Requires x-agent-key header
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhoneE164, toProviderPhone } from '@/utils/phone'

export const dynamic = 'force-dynamic'

const AGENT_KEY = process.env.AGENT_API_KEY || process.env.WHATSAPP_AGENT_KEY

function getServiceClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        }
    )
}

export async function GET(request: NextRequest) {
    try {
        // Verify agent key
        const agentKey = request.headers.get('x-agent-key')

        if (!AGENT_KEY) {
            return NextResponse.json({
                found: false,
                error: 'Agent key not configured'
            }, { status: 500 })
        }

        if (!agentKey || agentKey !== AGENT_KEY) {
            return NextResponse.json({
                found: false,
                error: 'Unauthorized'
            }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const phone = searchParams.get('phone')

        if (!phone) {
            return NextResponse.json({
                found: false,
                error: 'Phone number is required'
            }, { status: 400 })
        }

        const normalizedPhone = normalizePhoneE164(phone)
        const providerPhone = normalizedPhone ? toProviderPhone(normalizedPhone) : null
        if (!normalizedPhone) {
            return NextResponse.json({
                found: false,
                error: 'Invalid phone number'
            }, { status: 400 })
        }

        // Also create E.164 variants for matching
        const phoneVariants = [
            normalizedPhone,
            providerPhone,
            providerPhone?.startsWith('60') ? `0${providerPhone.slice(2)}` : null,
        ]
            .filter(Boolean)

        const supabase = getServiceClient()

        // Try to find user by phone
        const { data: user, error } = await supabase
            .from('users')
            .select(`
        id,
        full_name,
        email,
        phone,
        role_code,
        organization_id,
        created_at
      `)
            .or(phoneVariants.map(p => `phone.eq.${p}`).join(','))
            .limit(1)
            .single()

        if (error || !user) {
            return NextResponse.json({
                found: false,
                phone: normalizedPhone,
                message: 'User not found'
            })
        }

        // Get user roles
        const roles: string[] = []
        if (user.role_code) {
            roles.push(user.role_code)
        }

        // Check if user is a consumer (has points transactions or redemptions)
        const { count: pointsCount } = await supabase
            .from('points_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)

        if (pointsCount && pointsCount > 0) {
            roles.push('consumer')
        }

        return NextResponse.json({
            found: true,
            userId: user.id,
            name: user.full_name,
            email: user.email,
            phone: user.phone,
            roles,
            organizationId: user.organization_id,
            registeredAt: user.created_at,
        })

    } catch (error: any) {
        console.error('resolve-user error:', error)
        return NextResponse.json({
            found: false,
            error: 'Internal server error'
        }, { status: 500 })
    }
}
