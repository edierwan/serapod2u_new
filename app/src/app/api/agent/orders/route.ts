/**
 * AI Agent Orders Endpoint
 * 
 * GET /api/agent/orders
 * 
 * Returns user's order history and status.
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
 * GET /api/agent/orders?userId=uuid
 * or
 * GET /api/agent/orders?phone=+60123456789
 * 
 * Optional: 
 *   &limit=10 (default 10)
 *   &status=pending|approved|shipped|delivered
 *   &orderId=uuid (get specific order)
 * 
 * Returns:
 * {
 *   ok: true,
 *   orders: [...]
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
    const orderId = searchParams.get('orderId')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '10')
    
    if (!phone && !userId && !orderId) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Either phone, userId, or orderId is required' 
      }, { status: 400 })
    }
    
    const supabase = getServiceClient()
    
    // If orderId provided, get specific order
    if (orderId) {
      const { data: order } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          display_doc_no,
          status,
          total_amount,
          created_at,
          updated_at,
          notes,
          order_items:order_items(
            id,
            quantity,
            unit_price,
            total_price,
            product_variant:product_variants(
              id,
              sku,
              product:products(id, name)
            )
          )
        `)
        .eq('id', orderId)
        .single()
      
      if (!order) {
        return NextResponse.json({
          ok: true,
          order: null,
          message: 'Order not found'
        })
      }
      
      return NextResponse.json({
        ok: true,
        order: {
          id: order.id,
          orderNumber: order.order_number || order.display_doc_no,
          status: order.status,
          totalAmount: order.total_amount,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
          notes: order.notes,
          items: order.order_items?.map((item: any) => ({
            id: item.id,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            totalPrice: item.total_price,
            sku: item.product_variant?.sku,
            productName: item.product_variant?.product?.name
          }))
        }
      })
    }
    
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
    
    // Build query
    let query = supabase
      .from('orders')
      .select(`
        id,
        order_number,
        display_doc_no,
        status,
        total_amount,
        created_at,
        updated_at
      `)
      .eq('created_by_user_id', resolvedUserId)
      .order('created_at', { ascending: false })
      .limit(limit)
    
    if (status) {
      query = query.eq('status', status)
    }
    
    const { data: orders } = await query
    
    // Get summary stats
    const { data: allOrders } = await supabase
      .from('orders')
      .select('status, total_amount')
      .eq('created_by_user_id', resolvedUserId)
    
    const stats = {
      total: allOrders?.length || 0,
      pending: allOrders?.filter(o => o.status === 'pending').length || 0,
      approved: allOrders?.filter(o => o.status === 'approved').length || 0,
      shipped: allOrders?.filter(o => o.status === 'shipped').length || 0,
      delivered: allOrders?.filter(o => o.status === 'delivered').length || 0,
      totalValue: allOrders?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0
    }
    
    return NextResponse.json({
      ok: true,
      userId: resolvedUserId,
      stats,
      orders: orders?.map(o => ({
        id: o.id,
        orderNumber: o.order_number || o.display_doc_no,
        status: o.status,
        totalAmount: o.total_amount,
        createdAt: o.created_at,
        updatedAt: o.updated_at
      })) || []
    })
    
  } catch (error: any) {
    console.error('[Agent Orders] Error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error.message || 'Internal server error' 
    }, { status: 500 })
  }
}
