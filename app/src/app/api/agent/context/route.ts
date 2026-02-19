/**
 * AI Agent Context Endpoint
 * 
 * GET /api/agent/context
 * 
 * Returns user context for AI agent to provide personalized responses.
 * Includes user info, tenant features, and recent activity.
 * 
 * Security: Requires x-agent-key header
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhoneE164 } from '@/utils/phone'

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

/**
 * GET /api/agent/context?phone=+60123456789
 * or
 * GET /api/agent/context?userId=uuid
 * 
 * Returns:
 * {
 *   ok: true,
 *   user: { id, name, email, phone, tier, organization },
 *   features: { ... enabled modules ... },
 *   recentActivity: { ... }
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // Verify agent key
    const agentKey = request.headers.get('x-agent-key')

    if (!AGENT_KEY) {
      return NextResponse.json({ ok: false, error: 'Agent key not configured' }, { status: 500 })
    }

    if (!agentKey || agentKey !== AGENT_KEY) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const phone = searchParams.get('phone')
    const userId = searchParams.get('userId')
    const tenantId = searchParams.get('tenantId')

    if (!phone && !userId) {
      return NextResponse.json({
        ok: false,
        error: 'Either phone or userId is required'
      }, { status: 400 })
    }

    const supabase = getServiceClient()

    // Find user
    let user: any = null

    if (userId) {
      const { data } = await supabase
        .from('users')
        .select(`
          id, 
          email, 
          full_name, 
          phone,
          role,
          organization_id,
          organization:organizations!fk_users_organization(id, name, code),
          created_at
        `)
        .eq('id', userId)
        .single()
      user = data
    } else if (phone) {
      const normalizedPhone = normalizePhoneE164(phone)
      const { data } = await supabase
        .from('users')
        .select(`
          id, 
          email, 
          full_name, 
          phone,
          role,
          organization_id,
          organization:organizations!fk_users_organization(id, name, code),
          created_at
        `)
        .or(`phone.eq.${phone},phone.eq.${normalizedPhone}`)
        .limit(1)
        .single()
      user = data
    }

    if (!user) {
      return NextResponse.json({
        ok: true,
        user: null,
        message: 'User not found'
      })
    }

    // Get tenant features
    const { data: features } = await supabase
      .from('tenant_features')
      .select('feature_key, enabled, config')
      .or(`tenant_id.eq.${user.organization_id},tenant_id.is.null`)
      .order('tenant_id', { ascending: false, nullsFirst: false })

    // Build enabled modules map
    const enabledModules: Record<string, boolean> = {}
    const moduleConfig: Record<string, any> = {}

    features?.forEach(f => {
      // Later tenant-specific features override global
      enabledModules[f.feature_key] = f.enabled
      if (f.config) {
        moduleConfig[f.feature_key] = f.config
      }
    })

    // Get user's points balance
    const { data: pointsData } = await supabase
      .from('points_transactions')
      .select('points')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Get tier info if applicable
    let tierInfo = null
    if (enabledModules.points_system) {
      const { data: tier } = await supabase
        .from('point_tiers')
        .select('name, min_points, max_points, multiplier')
        .lte('min_points', pointsData?.points || 0)
        .order('min_points', { ascending: false })
        .limit(1)
        .single()
      tierInfo = tier
    }

    // Get recent activity summary
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { count: recentScans } = await supabase
      .from('qr_scans')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', thirtyDaysAgo)

    const { count: recentOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('created_by_user_id', user.id)
      .gte('created_at', thirtyDaysAgo)

    const { count: recentRedemptions } = await supabase
      .from('redeem_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', thirtyDaysAgo)

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        organization: user.organization,
        memberSince: user.created_at
      },
      points: {
        balance: pointsData?.points || 0,
        tier: tierInfo
      },
      features: enabledModules,
      featureConfig: moduleConfig,
      recentActivity: {
        periodDays: 30,
        scans: recentScans || 0,
        orders: recentOrders || 0,
        redemptions: recentRedemptions || 0
      }
    })

  } catch (error: any) {
    console.error('[Agent Context] Error:', error)
    return NextResponse.json({
      ok: false,
      error: error.message || 'Internal server error'
    }, { status: 500 })
  }
}
