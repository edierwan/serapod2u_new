import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingChatTable, requireSerappActor } from '@/lib/serapp/chat-auth'
import { shouldRunSerappBot } from '@/lib/serapp/chat-bot'
import { processSerappChatTurn } from '@/lib/serapp/chat-turn'
import {
  appendMessage,
  getAccessibleConversation,
  parseSession,
  updateConversationSession,
} from '@/lib/serapp/conversation-service'
import type { SerappAttachment, SerappConversationKind } from '@/lib/serapp/conversation-types'

/**
 * Send a user message, wait for bot processing (with typing delay), persist both.
 * HQ/admin messages are human handoff only — no bot reply.
 * After handoff, distributor still gets bot replies for clear order commands.
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
    const conversation = await getAccessibleConversation(admin, id, {
      userId: actor.userId,
      orgId: actor.orgId,
      isHqSupport: actor.access.isHqSupport,
    })
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
      senderUserId: actor.userId,
      senderDisplayName: actor.fullName,
      senderKind: actor.access.isHqSupport ? 'hq' : 'distributor',
    })

    const deliveredAtIso = new Date().toISOString()
    await admin
      .from('serapp_messages')
      .update({ delivered_at: deliveredAtIso })
      .eq('id', userMessage.id)

    let botMessage = null as any
    let updatedSession = session
    // For pure attachment messages we skip AI interpretation and keep UX concise.
    if (text) {
      const botGate = shouldRunSerappBot({
        isHqSender: actor.access.isHqSupport,
        text,
        session,
      })
      updatedSession = botGate.session

      if (botGate.run) {
        let distributorName = actor.orgName
        const distOrgId =
          conversation.distributor_org_id
          || (!actor.access.isHqSupport ? conversation.owner_org_id : null)
          || distributorId
          || session.distributorId
        if (distOrgId && distOrgId !== actor.orgId) {
          const { data: distOrg } = await admin
            .from('organizations')
            .select('org_name')
            .eq('id', distOrgId)
            .maybeSingle()
          if (distOrg?.org_name) distributorName = distOrg.org_name
        }
        const reply = await processSerappChatTurn({
          request,
          kind: conversation.kind as SerappConversationKind,
          text,
          session: botGate.session,
          distributorName,
          distributorId: distributorId || session.distributorId || conversation.distributor_org_id,
          userId: actor.userId,
          orgId: actor.orgId,
          isHqSupport: actor.access.isHqSupport,
          conversationId: id,
        })
        updatedSession = {
          ...reply.session,
          humanHandoff: botGate.session.humanHandoff || Boolean(reply.session.humanHandoff),
        }
        botMessage = await appendMessage(admin, {
          conversationId: id,
          role: 'bot',
          body: reply.text,
          card: reply.card || null,
          quickReplies: reply.quickReplies || null,
        })
      }

      await updateConversationSession(admin, id, updatedSession, {
        distributorOrgId: updatedSession.distributorId,
      })
    }

    if (botMessage?.created_at) {
      await admin
        .from('serapp_messages')
        .update({ seen_at: botMessage.created_at })
        .eq('id', userMessage.id)
    }

    return NextResponse.json({
      userMessage,
      botMessage,
      session: updatedSession,
      typingMs: botMessage ? 700 : 0,
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
