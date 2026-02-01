/**
 * WhatsApp Send Endpoint
 * 
 * POST /api/support/whatsapp/send
 * 
 * Sends a message via WhatsApp to an end user from admin.
 * Called from Admin Web UI when "Reply via WhatsApp" is selected.
 * 
 * Security: Admin-only (authenticated user with admin role)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { normalizePhoneE164, phoneToJid } from '@/utils/phone'

export const dynamic = 'force-dynamic'

// Baileys Gateway configuration
const BAILEYS_GATEWAY_URL = process.env.BAILEYS_GATEWAY_URL || 'https://wa.serapod2u.com'
const BAILEYS_API_KEY = process.env.BAILEYS_API_KEY || process.env.WHATSAPP_AGENT_KEY
const DEFAULT_TENANT_ID = process.env.BAILEYS_TENANT_ID || 'serapod2u'

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

interface SendPayload {
  threadId: string        // Conversation ID
  toPhoneE164?: string    // Optional: override recipient phone
  text: string            // Message content
  tenantId?: string       // Optional: Baileys tenant ID
}

/**
 * POST /api/support/whatsapp/send
 * 
 * Body:
 * {
 *   threadId: string,       // Conversation ID
 *   toPhoneE164?: string,   // Optional recipient phone override
 *   text: string,           // Message content
 *   tenantId?: string       // Optional Baileys tenant ID
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
    
    const supabaseAdmin = getServiceClient()
    
    // Check if user is admin
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, role, is_super_admin, full_name, email')
      .eq('id', user.id)
      .single()
    
    if (userError || !userData) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
    }
    
    const isAdmin = userData.role === 'admin' || userData.role === 'super_admin' || userData.is_super_admin
    if (!isAdmin) {
      return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 })
    }
    
    const body: SendPayload = await request.json()
    const { threadId, toPhoneE164, text, tenantId } = body
    
    // Validate required fields
    if (!threadId || !text) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Missing required fields: threadId, text' 
      }, { status: 400 })
    }
    
    // Get conversation details
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('support_conversations')
      .select('id, whatsapp_user_phone, external_chat_id, created_by_user_id')
      .eq('id', threadId)
      .single()
    
    if (convError || !conversation) {
      return NextResponse.json({ ok: false, error: 'Conversation not found' }, { status: 404 })
    }
    
    // Determine recipient phone
    const recipientPhone = toPhoneE164 
      ? normalizePhoneE164(toPhoneE164) 
      : conversation.whatsapp_user_phone
    
    if (!recipientPhone) {
      return NextResponse.json({ 
        ok: false, 
        error: 'No WhatsApp phone number for this conversation' 
      }, { status: 400 })
    }
    
    console.log(`[WhatsApp Send] Sending to ${recipientPhone} for conversation ${threadId}`)
    
    // Generate a unique outbound ID to prevent echo loops
    const outboundId = `out_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    
    // Step 1: Create the message in our database FIRST
    // This ensures we have record even if gateway fails
    const { data: message, error: msgError } = await supabaseAdmin
      .from('support_conversation_messages')
      .insert({
        conversation_id: threadId,
        direction: 'outbound',
        channel: 'admin_web',  // Sent from admin web UI
        sender_type: 'admin',
        sender_admin_id: user.id,
        body_text: text,
        external_message_id: outboundId,  // Temporary ID, updated after gateway response
        origin: 'serapod',
        metadata: {
          sent_via: 'whatsapp',
          gateway_pending: true,
          admin_name: userData.full_name || userData.email
        }
      })
      .select('id')
      .single()
    
    if (msgError) {
      console.error('[WhatsApp Send] Failed to create message:', msgError)
      throw msgError
    }
    
    // Step 2: Send via Baileys Gateway
    let gatewaySuccess = false
    let gatewayMessageId: string | null = null
    let gatewayError: string | null = null
    
    try {
      const gatewayTenantId = tenantId || DEFAULT_TENANT_ID
      const gatewayUrl = `${BAILEYS_GATEWAY_URL}/tenants/${gatewayTenantId}/messages/send`
      
      console.log(`[WhatsApp Send] Calling gateway: ${gatewayUrl}`)
      
      const gatewayResponse = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': BAILEYS_API_KEY || ''
        },
        body: JSON.stringify({
          to: recipientPhone.replace(/^\+/, ''),  // Remove + prefix
          text: text,
          metadata: {
            source: 'serapod',
            outbound_id: outboundId,
            conversation_id: threadId,
            message_id: message.id
          }
        })
      })
      
      const gatewayResult = await gatewayResponse.json()
      
      if (gatewayResult.ok) {
        gatewaySuccess = true
        gatewayMessageId = gatewayResult.message_id || gatewayResult.jid
        console.log(`[WhatsApp Send] Gateway success: ${gatewayMessageId}`)
      } else {
        gatewayError = gatewayResult.error || 'Unknown gateway error'
        console.error(`[WhatsApp Send] Gateway failed: ${gatewayError}`)
      }
      
    } catch (gwError: any) {
      gatewayError = gwError.message || 'Gateway connection failed'
      console.error('[WhatsApp Send] Gateway error:', gwError)
    }
    
    // Step 3: Update message with gateway result
    const updateData: Record<string, any> = {
      metadata: {
        sent_via: 'whatsapp',
        gateway_success: gatewaySuccess,
        gateway_message_id: gatewayMessageId,
        gateway_error: gatewayError,
        admin_name: userData.full_name || userData.email
      }
    }
    
    if (gatewayMessageId) {
      // Store WhatsApp message ID for dedup when echo comes back
      updateData.external_message_id = gatewayMessageId
    }
    
    await supabaseAdmin
      .from('support_conversation_messages')
      .update(updateData)
      .eq('id', message.id)
    
    // Step 4: Update conversation
    const { data: conv } = await supabaseAdmin
      .from('support_conversations')
      .select('user_unread_count, status')
      .eq('id', threadId)
      .single()
    
    await supabaseAdmin
      .from('support_conversations')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: text.substring(0, 100),
        last_message_sender_type: 'admin',
        user_unread_count: (conv?.user_unread_count || 0) + 1,
        status: conv?.status === 'open' ? 'pending_user' : conv?.status,
        admin_whatsapp_phone: normalizePhoneE164(process.env.ADMIN_WHATSAPP_PHONE || ''),
        updated_at: new Date().toISOString()
      })
      .eq('id', threadId)
    
    // Step 5: Log to audit
    await supabaseAdmin.from('whatsapp_message_logs').insert({
      tenant_id: tenantId || DEFAULT_TENANT_ID,
      direction: 'outbound',
      phone_e164: recipientPhone,
      external_message_id: gatewayMessageId || outboundId,
      action: 'send',
      status: gatewaySuccess ? 'success' : 'failed',
      error_message: gatewayError,
      metadata: {
        conversation_id: threadId,
        message_id: message.id,
        admin_id: user.id
      }
    })
    
    // Return result
    if (!gatewaySuccess) {
      return NextResponse.json({
        ok: false,
        error: gatewayError || 'Failed to send via WhatsApp',
        messageId: message.id,  // Message saved in DB
        storedInDb: true
      }, { status: 502 })
    }
    
    return NextResponse.json({
      ok: true,
      messageId: message.id,
      whatsappMessageId: gatewayMessageId,
      threadId
    })
    
  } catch (error: any) {
    console.error('[WhatsApp Send] Error:', error)
    return NextResponse.json({ 
      ok: false, 
      error: error.message || 'Internal server error' 
    }, { status: 500 })
  }
}
