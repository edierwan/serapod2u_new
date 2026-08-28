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
import { canAccessSerappConversation } from '@/lib/serapp/conversation-access'
import type { SerappChatQuickReply, SerappChatSessionState } from '@/lib/serapp/chat-types'
import { quickRepliesForPhase } from '@/lib/serapp/chat-bot'

type Admin = ReturnType<typeof createAdminClient>

async function loadChildDistributorIds(admin: Admin, hqOrgId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('organizations')
    .select('id')
    .eq('parent_org_id', hqOrgId)
    .eq('org_type_code', 'DIST')
    .eq('is_active', true)
    .limit(200)
  if (error) throw error
  return (data || []).map((row) => row.id)
}

function mergeConversations(rows: SerappConversationRow[]): SerappConversationRow[] {
  const byId = new Map<string, SerappConversationRow>()
  for (const row of rows) byId.set(row.id, row)
  return Array.from(byId.values()).sort((left, right) => {
    const a = left.last_message_at || left.created_at
    const b = right.last_message_at || right.created_at
    return b.localeCompare(a)
  })
}

export async function listConversationsForUser(
  admin: Admin,
  userId: string,
): Promise<SerappConversationRow[]> {
  return listConversationsForActor(admin, {
    userId,
    orgId: '',
    isHqSupport: false,
  })
}

export async function listConversationsForActor(
  admin: Admin,
  actor: { userId: string; orgId: string; isHqSupport: boolean },
): Promise<SerappConversationRow[]> {
  const { data: own, error: ownError } = await admin
    .from('serapp_conversations')
    .select('*')
    .eq('owner_user_id', actor.userId)
    .eq('is_archived', false)
    .order('last_message_at', { ascending: false, nullsFirst: false })
  if (ownError) throw ownError

  const rows = [...((own || []) as SerappConversationRow[])]

  if (actor.orgId && !actor.isHqSupport) {
    const { data: orgGroups, error: orgError } = await admin
      .from('serapp_conversations')
      .select('*')
      .or(`owner_org_id.eq.${actor.orgId},distributor_org_id.eq.${actor.orgId}`)
      .eq('kind', 'assistant')
      .eq('is_archived', false)
    if (orgError) throw orgError
    rows.push(...((orgGroups || []) as SerappConversationRow[]))
  }

  if (actor.isHqSupport && actor.orgId) {
    const childIds = await loadChildDistributorIds(admin, actor.orgId)
    if (childIds.length > 0) {
      const { data: hqGroups, error: hqError } = await admin
        .from('serapp_conversations')
        .select('*')
        .eq('kind', 'assistant')
        .eq('is_archived', false)
        .in('owner_org_id', childIds)
      if (hqError) throw hqError
      rows.push(...((hqGroups || []) as SerappConversationRow[]))
    }
  }

  return mergeConversations(rows)
}

export async function findOrCreateOrgAssistant(
  admin: Admin,
  input: {
    userId: string
    distributorOrgId: string
    distributorName: string
  },
): Promise<SerappConversationRow> {
  const { data: existingRows, error: existingError } = await admin
    .from('serapp_conversations')
    .select('*')
    .eq('owner_org_id', input.distributorOrgId)
    .eq('kind', 'assistant')
    .eq('is_archived', false)
    .order('created_at', { ascending: true })
    .limit(1)
  if (existingError) throw existingError
  const existing = existingRows?.[0]
  if (existing) return existing as SerappConversationRow

  const created = await createConversation(admin, {
    userId: input.userId,
    orgId: input.distributorOrgId,
    orgName: input.distributorName,
    kind: 'assistant',
    title: input.distributorName,
    distributorOrgId: input.distributorOrgId,
  })
  return created.conversation
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
  input: { userId: string; orgId: string; orgName?: string | null; isHqSupport?: boolean },
): Promise<SerappConversationRow[]> {
  const { data: existingKinds, error: kindsError } = await admin
    .from('serapp_conversations')
    .select('kind')
    .eq('owner_user_id', input.userId)

  if (kindsError) throw kindsError

  const present = new Set((existingKinds || []).map((row) => row.kind as SerappConversationKind))
  if (!input.isHqSupport) {
    const { data: orgAssistant } = await admin
      .from('serapp_conversations')
      .select('id')
      .eq('owner_org_id', input.orgId)
      .eq('kind', 'assistant')
      .eq('is_archived', false)
      .limit(1)
      .maybeSingle()
    if (orgAssistant?.id) present.add('assistant')
  } else {
    present.add('assistant')
  }

  const now = new Date().toISOString()

  for (const seed of SEED_CHATS) {
    if (present.has(seed.kind)) continue

    const { data: conv, error } = await admin
      .from('serapp_conversations')
      .insert({
        owner_user_id: input.userId,
        owner_org_id: input.orgId,
        distributor_org_id: seed.kind === 'assistant' ? input.orgId : null,
        kind: seed.kind,
        title: seed.kind === 'assistant' && input.orgName ? input.orgName : seed.title,
        subtitle: seed.kind === 'assistant' ? 'Group · distributor + HQ' : seed.subtitle,
        avatar_key: seed.avatar_key,
        last_message_preview: previewFromBody(seed.welcome),
        last_message_at: now,
        session_json: {
          ...DEFAULT_SESSION,
          distributorId: seed.kind === 'assistant' ? input.orgId : null,
        },
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

  return listConversationsForActor(admin, {
    userId: input.userId,
    orgId: input.orgId,
    isHqSupport: Boolean(input.isHqSupport),
  })
}

export async function createConversation(
  admin: Admin,
  input: {
    userId: string
    orgId: string
    kind?: SerappConversationKind
    title?: string
    orgName?: string | null
    distributorOrgId?: string | null
  },
): Promise<{ conversation: SerappConversationRow; welcomeMessage: SerappMessageRow }> {
  const kind = input.kind || 'assistant'
  const seed = SEED_CHATS.find((s) => s.kind === kind) || SEED_CHATS[0]
  const title =
    input.title?.trim() ||
    (kind === 'assistant'
      ? (input.orgName?.trim() || 'Distributor')
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
      subtitle: seed.kind === 'assistant' ? 'Group · distributor + HQ' : seed.subtitle,
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
  return getAccessibleConversation(admin, conversationId, {
    userId,
    orgId: '',
    isHqSupport: false,
  })
}

export async function getAccessibleConversation(
  admin: Admin,
  conversationId: string,
  actor: { userId: string; orgId: string; isHqSupport: boolean },
): Promise<SerappConversationRow | null> {
  const id = String(conversationId || '').trim()
  if (!id || id === 'undefined' || id === 'null') {
    console.error('[serapp] getAccessibleConversation: empty conversation id', {
      conversationId,
      userId: actor.userId,
      orgId: actor.orgId,
    })
    return null
  }

  // Untyped from() — serapp_* tables are not in generated Database types yet.
  const { data, error } = await (admin as any)
    .from('serapp_conversations')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    console.error('[serapp] getAccessibleConversation: row missing', {
      id,
      userId: actor.userId,
      orgId: actor.orgId,
    })
    return null
  }

  const row = data as SerappConversationRow

  // Fast path: owner / same-org member (no extra queries).
  const userId = String(actor.userId || '').trim().toLowerCase()
  const orgId = String(actor.orgId || '').trim().toLowerCase()
  const ownerUserId = String(row.owner_user_id || '').trim().toLowerCase()
  const ownerOrgId = String(row.owner_org_id || '').trim().toLowerCase()
  const distributorOrgId = String(row.distributor_org_id || '').trim().toLowerCase()
  if (
    (ownerUserId && ownerUserId === userId)
    || (ownerOrgId && ownerOrgId === orgId)
    || (distributorOrgId && distributorOrgId === orgId)
  ) {
    return row
  }

  const childDistributorIds = actor.isHqSupport && actor.orgId
    ? await loadChildDistributorIds(admin, actor.orgId)
    : []

  if (canAccessSerappConversation(row, {
    userId: actor.userId,
    orgId: actor.orgId,
    isHqSupport: actor.isHqSupport,
    childDistributorIds,
  })) {
    return row
  }

  // Fallback for HQ: verify parent_org_id directly (avoids child-list gaps / stale cache).
  if (actor.isHqSupport && actor.orgId) {
    const linkedOrgId = row.owner_org_id || row.distributor_org_id
    if (linkedOrgId) {
      const { data: ownerOrg } = await (admin as any)
        .from('organizations')
        .select('id, parent_org_id, org_type_code')
        .eq('id', linkedOrgId)
        .maybeSingle()
      if (
        ownerOrg
        && String(ownerOrg.org_type_code || '').toUpperCase() === 'DIST'
        && String(ownerOrg.parent_org_id || '').trim().toLowerCase() === orgId
      ) {
        return row
      }
    }
  }

  console.error('[serapp] getAccessibleConversation: access denied', {
    id,
    actorUserId: actor.userId,
    actorOrgId: actor.orgId,
    isHqSupport: actor.isHqSupport,
    ownerUserId: row.owner_user_id,
    ownerOrgId: row.owner_org_id,
    distributorOrgId: row.distributor_org_id,
    childCount: childDistributorIds.length,
  })
  return null
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
    senderUserId?: string | null
    senderDisplayName?: string | null
    senderKind?: 'distributor' | 'hq' | null
  },
): Promise<SerappMessageRow> {
  const payload: Record<string, unknown> = {
    conversation_id: input.conversationId,
    role: input.role,
    body: input.body,
    card_json: input.card || null,
    quick_replies_json: input.quickReplies || null,
    attachment_json: input.attachment || null,
    client_message_id: input.clientMessageId || null,
  }
  if (input.senderUserId) payload.sender_user_id = input.senderUserId
  if (input.senderDisplayName) payload.sender_display_name = input.senderDisplayName
  if (input.senderKind) payload.sender_kind = input.senderKind

  let { data, error } = await admin
    .from('serapp_messages')
    .insert(payload)
    .select('*')
    .single()

  if (error && /sender_/i.test(error.message || '')) {
    delete payload.sender_user_id
    delete payload.sender_display_name
    delete payload.sender_kind
    const retry = await admin.from('serapp_messages').insert(payload).select('*').single()
    data = retry.data
    error = retry.error
  }

  if (error) throw error
  if (!data) throw new Error('Failed to save message.')

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
  extra?: { distributorOrgId?: string | null; title?: string },
): Promise<void> {
  const patch: Record<string, unknown> = {
    session_json: session,
    updated_at: new Date().toISOString(),
  }
  if (extra && 'distributorOrgId' in extra) {
    patch.distributor_org_id = extra.distributorOrgId
  }
  if (extra?.title?.trim()) {
    patch.title = extra.title.trim()
  }
  const { error } = await admin
    .from('serapp_conversations')
    .update(patch)
    .eq('id', conversationId)
  if (error) throw error
}

export { parseSession }
