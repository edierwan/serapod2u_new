/**
 * AI Agent Points Endpoint
 * 
 * GET /api/agent/points
 * 
 * Returns user's points balance and transaction history.
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
 * GET /api/agent/points?userId=uuid
 * or
 * GET /api/agent/points?phone=+60123456789
 * 
 * Optional: &limit=10 (default 10)
 * 
 * Returns:
 * {
 *   ok: true,
 *   balance: number,
 *   tier: { name, multiplier },
 *   transactions: [...]
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
    const limit = parseInt(searchParams.get('limit') || '10')
    
    if (!phone && !userId) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Either phone or userId is required' 
      }, { status: 400 })
    }
    
    const supabase = getServiceClient()
    
    // Find user
    let resolvedUserId: string | null = null
    
    if (userId) {
      resolvedUserId = userId
    } else if (phone) {
      const normalizedPhone = normalizePhoneE164(phone)
      const { data: user } = await supabase
        .from('users')
        .select('id')
        .or(`phone.eq.${phone},phone.eq.${normalizedPhone}`)
        .limit(1)
        .single()
      resolvedUserId = user?.id || null
    }
    
    if (!resolvedUserId) {
      return NextResponse.json({
        ok: true,
        user: null,
        message: 'User not found'
      })
    }
    
    // Get current balance from consumer_points view or points_transactions
    const { data: balanceData } = await supabase
      .from('consumer_points')
      .select('total_points')
      .eq('user_id', resolvedUserId)
      .single()
    
    let balance = balanceData?.total_points || 0
    
    // Fallback: calculate from transactions if view not available
    if (!balanceData) {
      const { data: txSum } = await supabase
        .from('points_transactions')
        .select('points')
        .eq('user_id', resolvedUserId)
      
      if (txSum) {
        balance = txSum.reduce((sum, t) => sum + (t.points || 0), 0)
      }
    }
    
    // Get tier info
    const { data: tier } = await supabase
      .from('point_tiers')
      .select('name, min_points, max_points, multiplier, benefits')
      .lte('min_points', balance)
      .order('min_points', { ascending: false })
      .limit(1)
      .single()
    
    // Get recent transactions
    const { data: transactions } = await supabase
      .from('points_transactions')
      .select(`
        id,
        points,
        type,
        description,
        reference_type,
        reference_id,
        created_at
      `)
      .eq('user_id', resolvedUserId)
      .order('created_at', { ascending: false })
      .limit(limit)
    
    // Get lifetime stats
    const { data: earnedStats } = await supabase
      .from('points_transactions')
      .select('points')
      .eq('user_id', resolvedUserId)
      .gt('points', 0)
    
    const { data: spentStats } = await supabase
      .from('points_transactions')
      .select('points')
      .eq('user_id', resolvedUserId)
      .lt('points', 0)
    
    const lifetimeEarned = earnedStats?.reduce((sum, t) => sum + t.points, 0) || 0
    const lifetimeSpent = Math.abs(spentStats?.reduce((sum, t) => sum + t.points, 0) || 0)
    
    // Next tier info
    let nextTier = null
    if (tier) {
      const { data: next } = await supabase
        .from('point_tiers')
        .select('name, min_points, benefits')
        .gt('min_points', balance)
        .order('min_points', { ascending: true })
        .limit(1)
        .single()
      
      if (next) {
        nextTier = {
          name: next.name,
          pointsNeeded: next.min_points - balance,
          benefits: next.benefits
        }
      }
    }
    
    return NextResponse.json({
      ok: true,
      userId: resolvedUserId,
      balance,
      tier: tier ? {
        name: tier.name,
        multiplier: tier.multiplier,
        benefits: tier.benefits
      } : null,
      nextTier,
      lifetimeStats: {
        earned: lifetimeEarned,
        spent: lifetimeSpent
      },
      recentTransactions: transactions?.map(t => ({
        id: t.id,
        points: t.points,
        type: t.type,
        description: t.description,
        referenceType: t.reference_type,
        date: t.created_at
      })) || []
    })
    
  } catch (error: any) {
    console.error('[Agent Points] Error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error.message || 'Internal server error' 
    }, { status: 500 })
  }
}
