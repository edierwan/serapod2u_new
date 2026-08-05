import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingChatTable, requireSerappActor } from '@/lib/serapp/chat-auth'
import {
  getConversationForOwner,
  listMessages,
  parseSession,
  updateConversationSession,
} from '@/lib/serapp/conversation-service'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSerappActor()
    if (!actor.ok) return actor.error

    const { id } = await context.params
    const admin = createAdminClient()
    const conversation = await getConversationForOwner(admin, id, actor.userId)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }

    const messages = await listMessages(admin, id)
    const hydratedMessages = await Promise.all((messages || []).map(async (msg) => {
      const attachment = (msg as any).attachment_json
      if (!attachment?.bucket || !attachment?.path) return msg
      const { data: signed } = await admin.storage
        .from(String(attachment.bucket))
        .createSignedUrl(String(attachment.path), 60 * 60 * 12)
      return {
        ...msg,
        attachment_json: {
          ...attachment,
          url: signed?.signedUrl || attachment.url || null,
        },
      }
    }))
    const nowIso = new Date().toISOString()

    // Mark incoming bot/system messages as seen when thread opens.
    await admin
      .from('serapp_messages')
      .update({ seen_by_owner: true, seen_at: nowIso })
      .eq('conversation_id', id)
      .in('role', ['bot', 'system'])
      .eq('seen_by_owner', false)

    // Clear unread when opening
    if (conversation.unread_count > 0) {
      await admin
        .from('serapp_conversations')
        .update({ unread_count: 0, updated_at: nowIso })
        .eq('id', id)
    }

    // Presence heartbeat (online while thread is active).
    await admin
      .from('serapp_user_presence')
      .upsert({
        user_id: actor.userId,
        current_conversation_id: id,
        is_online: true,
        last_seen_at: nowIso,
        updated_at: nowIso,
      }, { onConflict: 'user_id' })

    return NextResponse.json({
      conversation: { ...conversation, unread_count: 0 },
      session: parseSession(conversation.session_json),
      messages: hydratedMessages,
      presence: { is_online: true, last_seen_at: nowIso },
    })
  } catch (error) {
    if (isMissingChatTable(error)) {
      return NextResponse.json({
        error: 'Chat tables not installed yet.',
        code: 'CHAT_SCHEMA_MISSING',
      }, { status: 503 })
    }
    console.error('[serapp/conversations/:id GET]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to load conversation.',
    }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSerappActor()
    if (!actor.ok) return actor.error

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const admin = createAdminClient()
    const conversation = await getConversationForOwner(admin, id, actor.userId)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }

    const session = parseSession(conversation.session_json)
    if (typeof body?.distributorId === 'string' || body?.distributorId === null) {
      session.distributorId = body.distributorId
      await updateConversationSession(admin, id, session, {
        distributorOrgId: body.distributorId,
      })
    }

    if (typeof body?.title === 'string' && body.title.trim()) {
      await admin
        .from('serapp_conversations')
        .update({ title: body.title.trim(), updated_at: new Date().toISOString() })
        .eq('id', id)
    }

    const refreshed = await getConversationForOwner(admin, id, actor.userId)
    return NextResponse.json({
      conversation: refreshed,
      session: parseSession(refreshed?.session_json),
    })
  } catch (error) {
    console.error('[serapp/conversations/:id PATCH]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to update conversation.',
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
