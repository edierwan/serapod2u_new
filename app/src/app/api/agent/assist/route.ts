/**
 * AI Agent Assist Endpoint
 * 
 * POST /api/agent/assist
 * 
 * Generates AI-suggested reply for support conversations.
 * Uses context from other agent tools to provide accurate responses.
 * 
 * Security: Admin-only (authenticated user with admin role)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const AGENT_KEY = process.env.AGENT_API_KEY || process.env.WHATSAPP_AGENT_KEY

function getServiceClient() {
  return createAdminClient(
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

interface AssistRequest {
  conversationId: string
  userMessage?: string  // Optional: specific message to respond to
  tone?: 'friendly' | 'professional' | 'empathetic'  // Default: friendly
}

/**
 * POST /api/agent/assist
 * 
 * Body:
 * {
 *   conversationId: string,
 *   userMessage?: string,
 *   tone?: 'friendly' | 'professional' | 'empathetic'
 * }
 * 
 * Returns:
 * {
 *   ok: true,
 *   suggestedReply: string,
 *   context: { ... data used for context }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate admin user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
    
    const supabaseAdmin = getServiceClient()
    
    // Check if user is admin
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('id, role, is_super_admin')
      .eq('id', user.id)
      .single()
    
    if (!userData) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
    }
    
    const isAdmin = userData.role === 'admin' || userData.role === 'super_admin' || userData.is_super_admin
    if (!isAdmin) {
      return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 })
    }
    
    const body: AssistRequest = await request.json()
    const { conversationId, userMessage, tone = 'friendly' } = body
    
    if (!conversationId) {
      return NextResponse.json({ ok: false, error: 'conversationId is required' }, { status: 400 })
    }
    
    // Get conversation details
    const { data: conversation } = await supabaseAdmin
      .from('support_conversations')
      .select(`
        id,
        subject,
        status,
        whatsapp_user_phone,
        created_by_user_id,
        created_at
      `)
      .eq('id', conversationId)
      .single()
    
    if (!conversation) {
      return NextResponse.json({ ok: false, error: 'Conversation not found' }, { status: 404 })
    }
    
    // Get recent messages
    const { data: messages } = await supabaseAdmin
      .from('support_conversation_messages')
      .select(`
        id,
        sender_type,
        body_text,
        channel,
        created_at
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10)
    
    // Build conversation history for context
    const conversationHistory = messages?.reverse().map(m => ({
      role: m.sender_type === 'user' ? 'user' : 'assistant',
      content: m.body_text
    })) || []
    
    // Gather user context
    let userContext: any = {}
    const userId = conversation.created_by_user_id
    const userPhone = conversation.whatsapp_user_phone
    
    if (userId && userId !== '00000000-0000-0000-0000-000000000000') {
      // Get user info
      const { data: contextUser } = await supabaseAdmin
        .from('users')
        .select('id, full_name, email, phone')
        .eq('id', userId)
        .single()
      
      if (contextUser) {
        userContext.name = contextUser.full_name
        userContext.email = contextUser.email
        userContext.phone = contextUser.phone
      }
      
      // Get points
      const { data: pointsData } = await supabaseAdmin
        .from('consumer_points')
        .select('total_points')
        .eq('user_id', userId)
        .single()
      
      userContext.pointsBalance = pointsData?.total_points || 0
      
      // Get recent orders count
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { count: orderCount } = await supabaseAdmin
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('created_by_user_id', userId)
        .gte('created_at', thirtyDaysAgo)
      
      userContext.recentOrders = orderCount || 0
      
      // Get pending redemptions
      const { count: pendingRedemptions } = await supabaseAdmin
        .from('redeem_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending')
      
      userContext.pendingRedemptions = pendingRedemptions || 0
    }
    
    // Analyze last user message for intent
    const lastUserMessage = userMessage || messages?.find(m => m.sender_type === 'user')?.body_text || ''
    const messageLower = lastUserMessage.toLowerCase()
    
    // Simple keyword-based FAQ matching
    let relevantFaq: string[] = []
    
    if (messageLower.includes('point') || messageLower.includes('mata')) {
      relevantFaq.push('Points can be earned by scanning QR codes on products and participating in promotions.')
      relevantFaq.push(`The user currently has ${userContext.pointsBalance || 0} points.`)
    }
    
    if (messageLower.includes('redeem') || messageLower.includes('tebus') || messageLower.includes('gift') || messageLower.includes('hadiah')) {
      relevantFaq.push('Rewards can be redeemed in the Rewards section of the app.')
      if (userContext.pendingRedemptions) {
        relevantFaq.push(`User has ${userContext.pendingRedemptions} pending redemption(s).`)
      }
    }
    
    if (messageLower.includes('order') || messageLower.includes('pesanan') || messageLower.includes('track')) {
      relevantFaq.push('Order status can be checked in the order history section.')
      if (userContext.recentOrders) {
        relevantFaq.push(`User has ${userContext.recentOrders} recent orders in the last 30 days.`)
      }
    }
    
    if (messageLower.includes('scan') || messageLower.includes('qr')) {
      relevantFaq.push('To scan a QR code, tap the Scan button and point camera at the QR code on the product.')
    }
    
    // Build system prompt
    const toneInstructions = {
      friendly: 'Be warm, casual, and helpful. Use simple language.',
      professional: 'Be polite and professional. Use clear, concise language.',
      empathetic: 'Show understanding and empathy. Acknowledge concerns before providing solutions.'
    }
    
    const systemPrompt = `You are a helpful customer support assistant for Serapod2u, a loyalty and rewards app.
${toneInstructions[tone]}

User Context:
${userContext.name ? `- Name: ${userContext.name}` : '- Unknown user (WhatsApp contact)'}
${userContext.pointsBalance !== undefined ? `- Points Balance: ${userContext.pointsBalance}` : ''}
${userContext.recentOrders ? `- Recent Orders: ${userContext.recentOrders}` : ''}
${userContext.pendingRedemptions ? `- Pending Redemptions: ${userContext.pendingRedemptions}` : ''}

${relevantFaq.length > 0 ? `Relevant Information:\n${relevantFaq.map(f => `- ${f}`).join('\n')}` : ''}

Guidelines:
1. Answer based on the context provided. Do not make up information.
2. If you don't know something, say you'll check with the team.
3. Keep responses concise but helpful.
4. Use Malay/English mix if user writes in Malay (Manglish).
5. Always end with offering further assistance.
6. Never discuss internal systems or technical details.`

    // Generate AI response
    let suggestedReply = ''
    
    if (OPENAI_API_KEY) {
      try {
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              ...conversationHistory.slice(-6),  // Last 6 messages for context
              ...(lastUserMessage && !conversationHistory.some(m => m.content === lastUserMessage) 
                ? [{ role: 'user', content: lastUserMessage }] 
                : [])
            ],
            temperature: 0.7,
            max_tokens: 500
          })
        })
        
        const aiResult = await openaiResponse.json()
        suggestedReply = aiResult.choices?.[0]?.message?.content || ''
        
      } catch (aiError: any) {
        console.error('[AI Assist] OpenAI error:', aiError)
        // Fallback to template-based response
        suggestedReply = generateTemplateResponse(lastUserMessage, userContext, tone)
      }
    } else {
      // No OpenAI key - use template-based response
      suggestedReply = generateTemplateResponse(lastUserMessage, userContext, tone)
    }
    
    return NextResponse.json({
      ok: true,
      suggestedReply,
      context: {
        userName: userContext.name,
        pointsBalance: userContext.pointsBalance,
        pendingRedemptions: userContext.pendingRedemptions,
        recentOrders: userContext.recentOrders,
        tone,
        aiPowered: !!OPENAI_API_KEY
      }
    })
    
  } catch (error: any) {
    console.error('[AI Assist] Error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error.message || 'Internal server error' 
    }, { status: 500 })
  }
}

/**
 * Generate template-based response when AI is not available
 */
function generateTemplateResponse(
  message: string, 
  context: any, 
  tone: string
): string {
  const greeting = context.name ? `Hi ${context.name}` : 'Hi'
  const msgLower = message.toLowerCase()
  
  // Points inquiry
  if (msgLower.includes('point') || msgLower.includes('mata') || msgLower.includes('baki')) {
    if (context.pointsBalance !== undefined) {
      return `${greeting}! 😊\n\nYour current points balance is ${context.pointsBalance} points.\n\nYou can earn more points by scanning QR codes on our products. Is there anything else I can help you with?`
    }
    return `${greeting}! 😊\n\nTo check your points balance, please open the app and go to your Profile page. Your total points will be displayed there.\n\nCan I help you with anything else?`
  }
  
  // Redemption inquiry
  if (msgLower.includes('redeem') || msgLower.includes('tebus') || msgLower.includes('hadiah')) {
    if (context.pendingRedemptions) {
      return `${greeting}! 🎁\n\nI can see you have ${context.pendingRedemptions} pending redemption(s). Our team is processing them and you should receive an update soon.\n\nIs there anything specific about your redemption you'd like to know?`
    }
    return `${greeting}! 🎁\n\nYou can redeem rewards through the Rewards section in our app. Browse the catalog and select items that fit your points balance.\n\nWould you like me to help you with anything specific?`
  }
  
  // Order inquiry  
  if (msgLower.includes('order') || msgLower.includes('pesanan') || msgLower.includes('track')) {
    return `${greeting}! 📦\n\nYou can track your orders in the app under Order History. Once shipped, you'll receive a tracking number.\n\nIf you have a specific order question, please share the order number and I'll check for you!`
  }
  
  // Scan inquiry
  if (msgLower.includes('scan') || msgLower.includes('qr')) {
    return `${greeting}! 📱\n\nTo scan a QR code:\n1. Open the app\n2. Tap the Scan button at the bottom\n3. Point your camera at the QR code on the product\n\nMake sure you have good lighting and the code is fully visible. Let me know if you have any issues!`
  }
  
  // General greeting
  if (msgLower.match(/^(hi|hello|salam|hai|hey)/)) {
    return `${greeting}! 👋\n\nThank you for contacting Serapod2u support. How can I assist you today?`
  }
  
  // Thank you
  if (msgLower.includes('thank') || msgLower.includes('terima kasih')) {
    return `You're welcome! 😊 Feel free to reach out anytime you need help. Have a great day!`
  }
  
  // Default response
  return `${greeting}! 👋\n\nThank you for your message. I've noted your inquiry and will get back to you shortly with more information.\n\nIn the meantime, is there anything specific I can help you with?`
}
