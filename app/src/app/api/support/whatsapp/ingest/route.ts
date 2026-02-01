/**
 * WhatsApp Ingest Endpoint
 * 
 * POST /api/support/whatsapp/ingest
 * 
 * Receives inbound WhatsApp messages from Baileys gateway
 * and stores them in the support system.
 * 
 * Security: Requires x-agent-key header (shared secret)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhoneE164, jidToPhone } from '@/utils/phone'

export const dynamic = 'force-dynamic'

// Agent key for authentication (shared with Baileys gateway)
const AGENT_KEY = process.env.WHATSAPP_AGENT_KEY || process.env.AGENT_API_KEY

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

interface IngestPayload {
  tenantId?: string
  from: string           // Sender phone (E.164 or raw)
  to?: string            // Our WhatsApp number (optional)
  messageId: string      // WhatsApp message ID
  chatId?: string        // WhatsApp chat JID
  text: string           // Message content
  timestamp?: number     // Unix timestamp
  metadata?: Record<string, any>
}

/**
 * POST /api/support/whatsapp/ingest
 * 
 * Body:
 * {
 *   tenantId?: string,      // Optional tenant ID
 *   from: string,           // Sender phone
 *   to?: string,            // Our WhatsApp number
 *   messageId: string,      // WhatsApp message ID for dedup
 *   chatId?: string,        // WhatsApp chat JID
 *   text: string,           // Message content
 *   timestamp?: number,     // Unix timestamp
 *   metadata?: object       // Additional metadata
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Verify agent key
    const agentKey = request.headers.get('x-agent-key') || request.headers.get('x-api-key')
    
    if (!AGENT_KEY) {
      console.error('[WhatsApp Ingest] WHATSAPP_AGENT_KEY not configured')
      return NextResponse.json({ ok: false, error: 'Server misconfigured' }, { status: 500 })
    }
    
    if (!agentKey || agentKey !== AGENT_KEY) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
    
    const body: IngestPayload = await request.json()
    const { from, to, messageId, chatId, text, timestamp, metadata, tenantId } = body
    
    // Validate required fields
    if (!from || !messageId || !text) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Missing required fields: from, messageId, text' 
      }, { status: 400 })
    }
    
    const supabase = getServiceClient()
    
    // Normalize phone numbers
    const senderPhoneE164 = normalizePhoneE164(from)
    const chatJid = chatId || `${from.replace(/\D/g, '')}@s.whatsapp.net`
    
    console.log(`[WhatsApp Ingest] Processing message from ${senderPhoneE164}, messageId=${messageId}`)
    
    // Step 1: Check for duplicate message
    const { data: existingMessage } = await supabase
      .from('support_conversation_messages')
      .select('id, conversation_id')
      .eq('external_message_id', messageId)
      .eq('channel', 'whatsapp')
      .single()
    
    if (existingMessage) {
      console.log(`[WhatsApp Ingest] Duplicate detected for messageId=${messageId}`)
      
      // Log duplicate
      await supabase.from('whatsapp_message_logs').insert({
        tenant_id: tenantId || 'default',
        direction: 'inbound',
        phone_e164: senderPhoneE164,
        external_message_id: messageId,
        external_chat_id: chatJid,
        action: 'ingest',
        status: 'duplicate',
        metadata: { dedup: true }
      })
      
      return NextResponse.json({ 
        ok: true, 
        threadId: existingMessage.conversation_id,
        messageId: existingMessage.id,
        dedup: true 
      })
    }
    
    // Step 2: Identify if sender is ADMIN or END-USER
    const { data: adminIdentity } = await supabase
      .from('admin_whatsapp_identities')
      .select('admin_user_id, display_name')
      .eq('phone_e164', senderPhoneE164)
      .eq('enabled', true)
      .single()
    
    const isAdmin = !!adminIdentity
    console.log(`[WhatsApp Ingest] Sender is ${isAdmin ? 'ADMIN' : 'END-USER'}`)
    
    let conversationId: string
    let direction: 'inbound' | 'outbound'
    let senderType: 'user' | 'admin'
    let senderUserId: string | null = null
    let senderAdminId: string | null = null
    
    if (isAdmin) {
      // Admin is sending a message via WhatsApp
      // This should be treated as an OUTBOUND reply to a user
      direction = 'outbound'
      senderType = 'admin'
      senderAdminId = adminIdentity.admin_user_id
      
      // Find the conversation this admin is replying to
      // Based on chatId (the end-user's WhatsApp chat)
      const endUserPhone = jidToPhone(chatJid)
      
      const { data: conv } = await supabase
        .from('support_conversations')
        .select('id')
        .eq('whatsapp_user_phone', endUserPhone)
        .neq('status', 'closed')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      
      if (!conv) {
        // Create new conversation for this end user
        const { data: newConv, error: convError } = await supabase
          .from('support_conversations')
          .insert({
            case_number: `CASE${Date.now().toString().slice(-6)}`,
            created_by_user_id: '00000000-0000-0000-0000-000000000000',
            subject: 'WhatsApp Conversation',
            status: 'pending_user',
            primary_channel: 'whatsapp',
            whatsapp_user_phone: endUserPhone,
            external_chat_id: chatJid,
            admin_whatsapp_phone: senderPhoneE164,
            assigned_admin_id: senderAdminId
          })
          .select('id')
          .single()
        
        if (convError) {
          console.error('[WhatsApp Ingest] Failed to create conversation:', convError)
          throw convError
        }
        conversationId = newConv.id
      } else {
        conversationId = conv.id
      }
      
    } else {
      // End-user is sending a message
      direction = 'inbound'
      senderType = 'user'
      
      // Try to find user by phone
      const { data: user } = await supabase
        .from('users')
        .select('id')
        .or(`phone.eq.${from},phone.eq.${senderPhoneE164}`)
        .limit(1)
        .single()
      
      if (user) {
        senderUserId = user.id
      }
      
      // Find or create conversation
      const { data: existingConv } = await supabase
        .from('support_conversations')
        .select('id')
        .eq('whatsapp_user_phone', senderPhoneE164)
        .not('status', 'in', '("closed","spam")')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      
      if (existingConv) {
        conversationId = existingConv.id
        
        // Update external_chat_id if not set
        await supabase
          .from('support_conversations')
          .update({ 
            external_chat_id: chatJid,
            updated_at: new Date().toISOString()
          })
          .eq('id', conversationId)
          .is('external_chat_id', null)
      } else {
        // Create new conversation
        const { data: newConv, error: convError } = await supabase
          .from('support_conversations')
          .insert({
            case_number: `CASE${Date.now().toString().slice(-6)}`,
            created_by_user_id: senderUserId || '00000000-0000-0000-0000-000000000000',
            subject: `WhatsApp: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`,
            status: 'open',
            primary_channel: 'whatsapp',
            whatsapp_user_phone: senderPhoneE164,
            external_chat_id: chatJid,
            admin_unread_count: 1
          })
          .select('id')
          .single()
        
        if (convError) {
          console.error('[WhatsApp Ingest] Failed to create conversation:', convError)
          throw convError
        }
        conversationId = newConv.id
      }
    }
    
    // Step 3: Insert the message
    const { data: newMessage, error: msgError } = await supabase
      .from('support_conversation_messages')
      .insert({
        conversation_id: conversationId,
        direction,
        channel: 'whatsapp',
        sender_type: senderType,
        sender_user_id: senderUserId,
        sender_admin_id: senderAdminId,
        sender_phone: senderPhoneE164,
        body_text: text,
        external_message_id: messageId,
        external_chat_id: chatJid,
        origin: 'whatsapp',
        metadata: metadata || {}
      })
      .select('id')
      .single()
    
    if (msgError) {
      console.error('[WhatsApp Ingest] Failed to insert message:', msgError)
      throw msgError
    }
    
    // Step 4: Update conversation metadata
    const updateData: Record<string, any> = {
      last_message_at: new Date().toISOString(),
      last_message_preview: text.substring(0, 100),
      last_message_sender_type: senderType,
      updated_at: new Date().toISOString()
    }
    
    if (direction === 'inbound') {
      // User sent message - increment admin unread, potentially reopen
      const { data: conv } = await supabase
        .from('support_conversations')
        .select('admin_unread_count, status')
        .eq('id', conversationId)
        .single()
      
      updateData.admin_unread_count = (conv?.admin_unread_count || 0) + 1
      
      // Reopen if resolved/pending_user
      if (conv?.status === 'resolved' || conv?.status === 'pending_user') {
        updateData.status = 'open'
      }
    } else {
      // Admin sent message - increment user unread, set pending_user
      const { data: conv } = await supabase
        .from('support_conversations')
        .select('user_unread_count, status')
        .eq('id', conversationId)
        .single()
      
      updateData.user_unread_count = (conv?.user_unread_count || 0) + 1
      
      if (conv?.status === 'open') {
        updateData.status = 'pending_user'
      }
    }
    
    await supabase
      .from('support_conversations')
      .update(updateData)
      .eq('id', conversationId)
    
    // Step 5: Log to audit
    await supabase.from('whatsapp_message_logs').insert({
      tenant_id: tenantId || 'default',
      direction: direction,
      phone_e164: senderPhoneE164,
      external_message_id: messageId,
      external_chat_id: chatJid,
      action: 'ingest',
      status: 'success',
      metadata: {
        conversation_id: conversationId,
        message_id: newMessage.id,
        is_admin: isAdmin
      }
    })
    
    console.log(`[WhatsApp Ingest] Success: convId=${conversationId}, msgId=${newMessage.id}`)
    
    return NextResponse.json({
      ok: true,
      threadId: conversationId,
      messageId: newMessage.id,
      dedup: false
    })
    
  } catch (error: any) {
    console.error('[WhatsApp Ingest] Error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error.message || 'Internal server error' 
    }, { status: 500 })
  }
}
