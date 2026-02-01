/**
 * AI Agent Search Endpoint
 * 
 * GET /api/agent/search
 * 
 * Search products, rewards, and FAQ for AI to provide accurate info.
 * 
 * Security: Requires x-agent-key header
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
 * GET /api/agent/search?q=keyword
 * 
 * Optional:
 *   &type=products|rewards|faq|all (default: all)
 *   &limit=10 (default 10 per type)
 * 
 * Returns:
 * {
 *   ok: true,
 *   results: {
 *     products: [...],
 *     rewards: [...],
 *     faq: [...]
 *   }
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
    const query = searchParams.get('q')
    const type = searchParams.get('type') || 'all'
    const limit = parseInt(searchParams.get('limit') || '10')
    
    if (!query || query.length < 2) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Query must be at least 2 characters' 
      }, { status: 400 })
    }
    
    const supabase = getServiceClient()
    const results: Record<string, any[]> = {}
    
    // Search products
    if (type === 'all' || type === 'products') {
      const { data: products } = await supabase
        .from('products')
        .select(`
          id,
          name,
          description,
          product_group:product_groups(name),
          variants:product_variants(
            id,
            sku,
            name,
            price,
            stock_quantity
          )
        `)
        .eq('is_active', true)
        .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
        .limit(limit)
      
      results.products = products?.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        category: (p.product_group as any)?.name,
        variants: (p.variants as any[])?.map(v => ({
          id: v.id,
          sku: v.sku,
          name: v.name,
          price: v.price,
          inStock: v.stock_quantity > 0
        }))
      })) || []
    }
    
    // Search rewards
    if (type === 'all' || type === 'rewards') {
      const { data: rewards } = await supabase
        .from('redeem_items')
        .select(`
          id,
          name,
          description,
          points_required,
          stock_quantity,
          category,
          image_url
        `)
        .eq('is_active', true)
        .or(`name.ilike.%${query}%,description.ilike.%${query}%,category.ilike.%${query}%`)
        .limit(limit)
      
      results.rewards = rewards?.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        pointsRequired: r.points_required,
        available: r.stock_quantity > 0,
        category: r.category,
        imageUrl: r.image_url
      })) || []
    }
    
    // Search FAQ / knowledge base
    // This uses a simple pattern - you might have a dedicated FAQ table
    if (type === 'all' || type === 'faq') {
      // Built-in FAQ knowledge base (can be moved to DB later)
      const faqKnowledge = [
        {
          question: 'How do I earn points?',
          answer: 'You can earn points by scanning QR codes on our products, making purchases, and participating in promotions like spin wheel and scratch cards.',
          keywords: ['earn', 'points', 'collect', 'get points', 'how to earn']
        },
        {
          question: 'How do I redeem my points?',
          answer: 'Go to the Rewards section in the app, browse available rewards, and click "Redeem" on items you can afford with your points. Delivery will be arranged.',
          keywords: ['redeem', 'use points', 'exchange', 'rewards', 'gift']
        },
        {
          question: 'Where can I check my points balance?',
          answer: 'Your points balance is shown on your Profile page at the top, and also on the Home screen.',
          keywords: ['balance', 'check points', 'how many points', 'points left']
        },
        {
          question: 'How long do points last?',
          answer: 'Points are valid for 12 months from the date earned. Points expiring soon will be shown in your account.',
          keywords: ['expire', 'expiry', 'valid', 'how long', 'points last']
        },
        {
          question: 'How do I contact support?',
          answer: 'You can contact support through the Support Inbox in the app, or via WhatsApp. Our team typically responds within 24 hours.',
          keywords: ['contact', 'support', 'help', 'customer service', 'reach']
        },
        {
          question: 'How do I track my order?',
          answer: 'Go to your order history in the app. Once shipped, you\'ll see a tracking number. Click it to track delivery status.',
          keywords: ['track', 'order', 'shipping', 'delivery', 'where is my order']
        },
        {
          question: 'How do I scan a QR code?',
          answer: 'Tap the Scan button at the bottom of the app, point your camera at the QR code on the product, and wait for it to be recognized.',
          keywords: ['scan', 'qr', 'camera', 'how to scan']
        },
        {
          question: 'What is my member tier?',
          answer: 'Your member tier is based on total points earned. Higher tiers give you bonus multipliers on points and exclusive rewards.',
          keywords: ['tier', 'level', 'membership', 'vip', 'status']
        },
        {
          question: 'Can I transfer points?',
          answer: 'Points cannot be transferred between accounts. They are linked to your registered phone number.',
          keywords: ['transfer', 'give points', 'share points', 'move points']
        },
        {
          question: 'How do I update my profile?',
          answer: 'Go to Profile > Settings (gear icon) to update your name, address, and other details.',
          keywords: ['profile', 'update', 'change name', 'settings', 'edit']
        }
      ]
      
      const queryLower = query.toLowerCase()
      const matchedFaq = faqKnowledge.filter(faq => 
        faq.keywords.some(kw => queryLower.includes(kw) || kw.includes(queryLower)) ||
        faq.question.toLowerCase().includes(queryLower) ||
        faq.answer.toLowerCase().includes(queryLower)
      ).slice(0, limit)
      
      results.faq = matchedFaq.map(f => ({
        question: f.question,
        answer: f.answer
      }))
    }
    
    return NextResponse.json({
      ok: true,
      query,
      results
    })
    
  } catch (error: any) {
    console.error('[Agent Search] Error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error.message || 'Internal server error' 
    }, { status: 500 })
  }
}
