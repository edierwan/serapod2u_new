import { createAdminClient } from '@/lib/supabase/admin'
import {
  DEFAULT_SESSION,
  SEED_CHATS,
  parseSession,
  previewFromBody,
  type SerappConversationKind,
  type SerappConversationRow,
  type SerappMessageRow,
  type SerappAttachment,
} from '@/lib/serapp/conversation-types'
import type { SerappChatQuickReply, SerappChatSessionState } from '@/lib/serapp/chat-types'
import { quickRepliesForPhase } from '@/lib/serapp/chat-bot'

type Admin = ReturnType<typeof createAdminClient>

export async function listConversationsForUser(
  admin: Admin,
  userId: string,
): Promise<SerappConversationRow[]> {
  const { data, error } = await admin
    .from('serapp_conversations')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('is_archived', false)
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (error) throw error
  return (data || []) as SerappConversationRow[]
}

/** Soft-delete a conversation. Warehouse/News system desks cannot be deleted. */
export async function archiveConversation(
  admin: Admin,
  conversationId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const conversation = await getConversationForOwner(admin, conversationId, userId)
  if (!conversation) {
    return { ok: false, error: 'Conversation not found.', status: 404 }
  }
  if (conversation.kind === 'warehouse' || conversation.kind === 'news') {
    return {
      ok: false,
      error: 'Warehouse Desk and News chats cannot be deleted.',
      status: 400,
    }
  }

  const { error } = await admin
    .from('serapp_conversations')
    .update({
      is_archived: true,
      unread_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
    .eq('owner_user_id', userId)

  if (error) throw error
  return { ok: true }
}

export async function ensureSeedConversations(
  admin: Admin,
  input: { userId: string; orgId: string },
): Promise<SerappConversationRow[]> {
  // Include archived so deleting a seed does not recreate duplicates forever.
  const { data: existingKinds, error: kindsError } = await admin
    .from('serapp_conversations')
    .select('kind')
    .eq('owner_user_id', input.userId)

  if (kindsError) throw kindsError

  const present = new Set((existingKinds || []).map((row) => row.kind as SerappConversationKind))
  const now = new Date().toISOString()

  for (const seed of SEED_CHATS) {
    if (present.has(seed.kind)) continue

    const { data: conv, error } = await admin
      .from('serapp_conversations')
      .insert({
        owner_user_id: input.userId,
        owner_org_id: input.orgId,
        kind: seed.kind,
        title: seed.title,
        subtitle: seed.subtitle,
        avatar_key: seed.avatar_key,
        last_message_preview: previewFromBody(seed.welcome),
        last_message_at: now,
        session_json: DEFAULT_SESSION,
      })
      .select('*')
      .single()

    if (error) throw error

    const replies =
      seed.kind === 'assistant'
        ? quickRepliesForPhase('awaiting_list')
        : seed.kind === 'warehouse'
          ? [
              { id: 'holds', label: 'My holds', sendText: 'my holds' },
              { id: 'do', label: 'DO status', sendText: 'do status' },
              { id: 'help', label: 'Help', sendText: 'help' },
            ]
          : [
              { id: 'latest', label: 'Latest news', sendText: 'latest' },
              { id: 'help', label: 'Help', sendText: 'help' },
            ]

    await admin.from('serapp_messages').insert({
      conversation_id: conv.id,
      role: 'bot',
      body: seed.welcome,
      quick_replies_json: replies,
    })
  }

  return listConversationsForUser(admin, input.userId)
}

export async function createConversation(
  admin: Admin,
  input: {
    userId: string
    orgId: string
    kind?: SerappConversationKind
    title?: string
    distributorOrgId?: string | null
  },
): Promise<{ conversation: SerappConversationRow; welcomeMessage: SerappMessageRow }> {
  const kind = input.kind || 'assistant'
  const seed = SEED_CHATS.find((s) => s.kind === kind) || SEED_CHATS[0]
  const title =
    input.title?.trim() ||
    (kind === 'assistant'
      ? `Order chat · ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      : seed.title)

  const session: SerappChatSessionState = {
    ...DEFAULT_SESSION,
    distributorId: input.distributorOrgId || null,
  }

  const welcome =
    kind === 'assistant'
      ? `${seed.welcome}\n\nThis is a *new* thread — history here is separate from your other chats.`
      : seed.welcome

  const now = new Date().toISOString()
  const { data: conv, error } = await admin
    .from('serapp_conversations')
    .insert({
      owner_user_id: input.userId,
      owner_org_id: input.orgId,
      distributor_org_id: input.distributorOrgId || null,
      kind,
      title,
      subtitle: seed.subtitle,
      avatar_key: seed.avatar_key,
      last_message_preview: previewFromBody(welcome),
      last_message_at: now,
      session_json: session,
    })
    .select('*')
    .single()

  if (error) throw error

  const replies = quickRepliesForPhase('awaiting_list')
  const { data: msg, error: msgError } = await admin
    .from('serapp_messages')
    .insert({
      conversation_id: conv.id,
      role: 'bot',
      body: welcome,
      quick_replies_json: kind === 'assistant' ? replies : [
        { id: 'help', label: 'Help', sendText: 'help' },
      ],
    })
    .select('*')
    .single()

  if (msgError) throw msgError

  return {
    conversation: conv as SerappConversationRow,
    welcomeMessage: msg as SerappMessageRow,
  }
}

export async function getConversationForOwner(
  admin: Admin,
  conversationId: string,
  userId: string,
): Promise<SerappConversationRow | null> {
  const { data, error } = await admin
    .from('serapp_conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('owner_user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data as SerappConversationRow | null
}

export async function listMessages(
  admin: Admin,
  conversationId: string,
  limit = 200,
): Promise<SerappMessageRow[]> {
  const { data, error } = await admin
    .from('serapp_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  return (data || []) as SerappMessageRow[]
}

export async function appendMessage(
  admin: Admin,
  input: {
    conversationId: string
    role: 'user' | 'bot' | 'system'
    body: string
    card?: unknown
    quickReplies?: SerappChatQuickReply[] | null
    attachment?: SerappAttachment | null
    clientMessageId?: string | null
  },
): Promise<SerappMessageRow> {
  const { data, error } = await admin
    .from('serapp_messages')
    .insert({
      conversation_id: input.conversationId,
      role: input.role,
      body: input.body,
      card_json: input.card || null,
      quick_replies_json: input.quickReplies || null,
      attachment_json: input.attachment || null,
      client_message_id: input.clientMessageId || null,
    })
    .select('*')
    .single()

  if (error) throw error

  const preview = previewFromBody(
    input.body || (input.attachment ? `Attachment: ${input.attachment.name}` : ''),
  )
  const patch: Record<string, unknown> = {
    last_message_preview: preview,
    last_message_at: data.created_at,
    updated_at: new Date().toISOString(),
  }

  if (input.role === 'bot' || input.role === 'system') {
    await bumpUnreadIfOwnerAway(admin, input.conversationId, patch)
  }

  await admin
    .from('serapp_conversations')
    .update(patch)
    .eq('id', input.conversationId)

  return data as SerappMessageRow
}

/** Bump unread when inbound message arrives and owner is not viewing this thread. */
export async function bumpUnreadIfOwnerAway(
  admin: Admin,
  conversationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data: conv } = await admin
    .from('serapp_conversations')
    .select('owner_user_id, unread_count')
    .eq('id', conversationId)
    .maybeSingle()

  if (!conv?.owner_user_id) return

  const { data: presence } = await admin
    .from('serapp_user_presence')
    .select('current_conversation_id, is_online')
    .eq('user_id', conv.owner_user_id)
    .maybeSingle()

  const viewing =
    Boolean(presence?.is_online) &&
    presence?.current_conversation_id === conversationId

  if (!viewing) {
    patch.unread_count = Number(conv.unread_count || 0) + 1
  }
}

export async function updateConversationSession(
  admin: Admin,
  conversationId: string,
  session: SerappChatSessionState,
  extra?: { distributorOrgId?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {
    session_json: session,
    updated_at: new Date().toISOString(),
  }
  if (extra && 'distributorOrgId' in extra) {
    patch.distributor_org_id = extra.distributorOrgId
  }
  const { error } = await admin
    .from('serapp_conversations')
    .update(patch)
    .eq('id', conversationId)
  if (error) throw error
}

export { parseSession }
