import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingChatTable, requireSerappActor } from '@/lib/serapp/chat-auth'
import { processSerappChatTurn } from '@/lib/serapp/chat-turn'
import {
  appendMessage,
  getConversationForOwner,
  parseSession,
  updateConversationSession,
} from '@/lib/serapp/conversation-service'
import type { SerappAttachment, SerappConversationKind } from '@/lib/serapp/conversation-types'

/**
 * Send a user message, wait for bot processing (with typing delay), persist both.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSerappActor()
    if (!actor.ok) return actor.error

    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const attachment = (body?.attachment && typeof body.attachment === 'object')
      ? body.attachment as SerappAttachment
      : null

    if (!text && !attachment) {
      return NextResponse.json({ error: 'Message text or attachment is required.' }, { status: 400 })
    }

    const clientMessageId =
      typeof body?.clientMessageId === 'string' ? body.clientMessageId.slice(0, 120) : null
    const distributorId =
      typeof body?.distributorId === 'string' ? body.distributorId : null

    const admin = createAdminClient()
    const conversation = await getConversationForOwner(admin, id, actor.userId)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }

    let session = parseSession(conversation.session_json)
    if (distributorId) {
      session = { ...session, distributorId }
    }

    const userMessage = await appendMessage(admin, {
      conversationId: id,
      role: 'user',
      body: text || (attachment ? `📎 ${attachment.name}` : ''),
      attachment,
      clientMessageId,
    })

    let botMessage = null as any
    let updatedSession = session
    // For pure attachment messages we skip AI interpretation and keep UX concise.
    if (text) {
      const distributorName = actor.orgName
      const reply = await processSerappChatTurn({
        request,
        kind: conversation.kind as SerappConversationKind,
        text,
        session,
        distributorName,
        distributorId: distributorId || session.distributorId,
      })
      updatedSession = reply.session
      await updateConversationSession(admin, id, reply.session, {
        distributorOrgId: reply.session.distributorId,
      })

      botMessage = await appendMessage(admin, {
        conversationId: id,
        role: 'bot',
        body: reply.text,
        card: reply.card || null,
        quickReplies: reply.quickReplies || null,
      })
    }

    // User message is considered delivered once bot has processed and replied.
    await admin
      .from('serapp_messages')
      .update({ delivered_at: botMessage?.created_at || new Date().toISOString() })
      .eq('id', userMessage.id)

    return NextResponse.json({
      userMessage,
      botMessage,
      session: updatedSession,
      typingMs: 700,
    })
  } catch (error) {
    if (isMissingChatTable(error)) {
      return NextResponse.json({
        error: 'Chat tables not installed yet. Apply migration 20260805130000_serapp_conversations.sql.',
        code: 'CHAT_SCHEMA_MISSING',
      }, { status: 503 })
    }
    console.error('[serapp/conversations/:id/messages POST]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to send message.',
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
