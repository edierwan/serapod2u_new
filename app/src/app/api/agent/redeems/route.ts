/**
 * AI Agent Redeems Endpoint
 * 
 * GET /api/agent/redeems
 * 
 * Returns user's redemption history and available rewards.
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
 * GET /api/agent/redeems?userId=uuid
 * or
 * GET /api/agent/redeems?phone=+60123456789
 * 
 * Optional: 
 *   &limit=10 (default 10)
 *   &includeAvailable=true (include available rewards to redeem)
 * 
 * Returns:
 * {
 *   ok: true,
 *   redemptions: [...],
 *   availableRewards: [...] // if includeAvailable=true
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
    const includeAvailable = searchParams.get('includeAvailable') === 'true'
    
    if (!phone && !userId) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Either phone or userId is required' 
      }, { status: 400 })
    }
    
    const supabase = getServiceClient()
    
    // Find user
    let resolvedUserId: string | null = null
    let userBalance = 0
    
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
    
    // Get user's points balance
    const { data: balanceData } = await supabase
      .from('consumer_points')
      .select('total_points')
      .eq('user_id', resolvedUserId)
      .single()
    
    userBalance = balanceData?.total_points || 0
    
    // Get redemption history
    const { data: redemptions } = await supabase
      .from('redeem_transactions')
      .select(`
        id,
        status,
        points_used,
        created_at,
        updated_at,
        delivery_address,
        tracking_number,
        redeem_item:redeem_items(
          id,
          name,
          points_required,
          image_url
        )
      `)
      .eq('user_id', resolvedUserId)
      .order('created_at', { ascending: false })
      .limit(limit)
    
    // Get summary stats
    const { data: allRedemptions } = await supabase
      .from('redeem_transactions')
      .select('status, points_used')
      .eq('user_id', resolvedUserId)
    
    const stats = {
      total: allRedemptions?.length || 0,
      pending: allRedemptions?.filter(r => r.status === 'pending').length || 0,
      approved: allRedemptions?.filter(r => r.status === 'approved').length || 0,
      shipped: allRedemptions?.filter(r => r.status === 'shipped').length || 0,
      delivered: allRedemptions?.filter(r => r.status === 'delivered').length || 0,
      totalPointsRedeemed: allRedemptions?.reduce((sum, r) => sum + (r.points_used || 0), 0) || 0
    }
    
    const response: any = {
      ok: true,
      userId: resolvedUserId,
      currentBalance: userBalance,
      stats,
      redemptions: redemptions?.map(r => ({
        id: r.id,
        status: r.status,
        pointsUsed: r.points_used,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        trackingNumber: r.tracking_number,
        item: r.redeem_item ? {
          id: (r.redeem_item as any).id,
          name: (r.redeem_item as any).name,
          pointsRequired: (r.redeem_item as any).points_required,
          imageUrl: (r.redeem_item as any).image_url
        } : null
      })) || []
    }
    
    // Include available rewards if requested
    if (includeAvailable) {
      const { data: availableRewards } = await supabase
        .from('redeem_items')
        .select(`
          id,
          name,
          description,
          points_required,
          stock_quantity,
          image_url,
          category
        `)
        .eq('is_active', true)
        .gt('stock_quantity', 0)
        .lte('points_required', userBalance)
        .order('points_required', { ascending: true })
        .limit(20)
      
      response.availableRewards = availableRewards?.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        pointsRequired: r.points_required,
        stockAvailable: r.stock_quantity,
        imageUrl: r.image_url,
        category: r.category
      })) || []
      
      // Also get rewards user can't afford yet (for suggestions)
      const { data: upcomingRewards } = await supabase
        .from('redeem_items')
        .select(`
          id,
          name,
          points_required,
          image_url
        `)
        .eq('is_active', true)
        .gt('points_required', userBalance)
        .order('points_required', { ascending: true })
        .limit(5)
      
      response.upcomingRewards = upcomingRewards?.map(r => ({
        id: r.id,
        name: r.name,
        pointsRequired: r.points_required,
        pointsNeeded: r.points_required - userBalance,
        imageUrl: r.image_url
      })) || []
    }
    
    return NextResponse.json(response)
    
  } catch (error: any) {
    console.error('[Agent Redeems] Error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error.message || 'Internal server error' 
    }, { status: 500 })
  }
}
