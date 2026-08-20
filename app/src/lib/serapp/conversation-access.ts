export interface SerappConversationAccessRow {
  owner_user_id: string
  owner_org_id: string
  distributor_org_id?: string | null
  kind?: string
}

export interface SerappConversationActor {
  userId: string
  orgId: string
  isHqSupport: boolean
  childDistributorIds?: string[]
}

/**
 * WhatsApp-group rule: the org order chat is shared.
 * Distributor members of that org, plus parent HQ, can open it.
 */
export function canAccessSerappConversation(
  conversation: SerappConversationAccessRow,
  actor: SerappConversationActor,
): boolean {
  if (conversation.owner_user_id === actor.userId) return true
  if (conversation.owner_org_id === actor.orgId) return true

  if (actor.isHqSupport) {
    const childIds = new Set(actor.childDistributorIds || [])
    if (childIds.has(conversation.owner_org_id)) return true
    if (conversation.distributor_org_id && childIds.has(conversation.distributor_org_id)) return true
  }

  return false
}

export function isMineSerappMessage(input: {
  role: string
  senderUserId?: string | null
  viewerUserId: string
  viewerIsHq: boolean
}): boolean {
  if (input.role !== 'user') return false
  if (input.senderUserId) return input.senderUserId === input.viewerUserId
  return !input.viewerIsHq
}
