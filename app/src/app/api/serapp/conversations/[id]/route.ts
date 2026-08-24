import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingChatTable, requireSerappActor } from '@/lib/serapp/chat-auth'
import {
  getAccessibleConversation,
  listMessages,
  parseSession,
  updateConversationSession,
  archiveConversation,
} from '@/lib/serapp/conversation-service'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSerappActor()
    if (!actor.ok) return actor.error

    const params = await context.params
    const pathId = new URL(request.url).pathname.split('/').filter(Boolean).pop() || ''
    const id = String(params?.id || pathId || '').trim()
    const admin = createAdminClient()
    const conversation = await getAccessibleConversation(admin, id, {
      userId: actor.userId,
      orgId: actor.orgId,
      isHqSupport: actor.access.isHqSupport,
    })
    if (!conversation) {
      let detail: Record<string, unknown> | undefined
      if (process.env.NODE_ENV === 'development') {
        const { data: row, error: rowError } = await (admin as any)
          .from('serapp_conversations')
          .select('id, owner_user_id, owner_org_id, distributor_org_id, kind, is_archived')
          .eq('id', id)
          .maybeSingle()
        detail = {
          id,
          paramsId: params?.id ?? null,
          pathId,
          actorUserId: actor.userId,
          actorOrgId: actor.orgId,
          isHqSupport: actor.access.isHqSupport,
          rowFound: Boolean(row),
          rowError: rowError?.message || null,
          row: row || null,
        }
        console.warn('[serapp/conversations/:id GET] 404 detail', detail)
      }
      return NextResponse.json({
        error: 'Conversation not found.',
        ...(detail ? { detail } : {}),
      }, { status: 404 })
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
    const conversation = await getAccessibleConversation(admin, id, {
      userId: actor.userId,
      orgId: actor.orgId,
      isHqSupport: actor.access.isHqSupport,
    })
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }

    const session = parseSession(conversation.session_json)
    if (typeof body?.distributorId === 'string' || body?.distributorId === null) {
      session.distributorId = body.distributorId
      const extras: { distributorOrgId: string | null; title?: string } = {
        distributorOrgId: body.distributorId,
      }
      if (typeof body.distributorId === 'string' && body.distributorId) {
        const { data: distributor } = await admin
          .from('organizations')
          .select('org_name, org_type_code, parent_org_id, is_active')
          .eq('id', body.distributorId)
          .maybeSingle()
        if (actor.access.isHqSupport) {
          if (
            !distributor
            || distributor.org_type_code !== 'DIST'
            || distributor.parent_org_id !== actor.orgId
            || distributor.is_active !== true
          ) {
            return NextResponse.json(
              { error: 'That distributor is not under this HQ organization.' },
              { status: 400 },
            )
          }
          extras.title = distributor.org_name
        }
      }
      await updateConversationSession(admin, id, session, extras)
    }

    if (typeof body?.title === 'string' && body.title.trim()) {
      await admin
        .from('serapp_conversations')
        .update({ title: body.title.trim(), updated_at: new Date().toISOString() })
        .eq('id', id)
    }

    const refreshed = await getAccessibleConversation(admin, id, {
      userId: actor.userId,
      orgId: actor.orgId,
      isHqSupport: actor.access.isHqSupport,
    })
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

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSerappActor()
    if (!actor.ok) return actor.error

    const { id } = await context.params
    const admin = createAdminClient()
    const result = await archiveConversation(admin, id, actor.userId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ ok: true, archived: true })
  } catch (error) {
    if (isMissingChatTable(error)) {
      return NextResponse.json({
        error: 'Chat tables not installed yet.',
        code: 'CHAT_SCHEMA_MISSING',
      }, { status: 503 })
    }
    console.error('[serapp/conversations/:id DELETE]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to delete conversation.',
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
