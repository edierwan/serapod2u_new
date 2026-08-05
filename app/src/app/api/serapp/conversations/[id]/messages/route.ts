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
import type { SerappConversationKind } from '@/lib/serapp/conversation-types'

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
    if (!text) {
      return NextResponse.json({ error: 'Message text is required.' }, { status: 400 })
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
      body: text,
      clientMessageId,
    })

    const distributorName = actor.orgName
    const reply = await processSerappChatTurn({
      request,
      kind: conversation.kind as SerappConversationKind,
      text,
      session,
      distributorName,
      distributorId: distributorId || session.distributorId,
    })

    await updateConversationSession(admin, id, reply.session, {
      distributorOrgId: reply.session.distributorId,
    })

    const botMessage = await appendMessage(admin, {
      conversationId: id,
      role: 'bot',
      body: reply.text,
      card: reply.card || null,
      quickReplies: reply.quickReplies || null,
    })

    return NextResponse.json({
      userMessage,
      botMessage,
      session: reply.session,
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
