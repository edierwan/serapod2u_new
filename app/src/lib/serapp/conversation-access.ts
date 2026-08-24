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
  const userId = String(actor.userId || '').trim().toLowerCase()
  const orgId = String(actor.orgId || '').trim().toLowerCase()
  const ownerUserId = String(conversation.owner_user_id || '').trim().toLowerCase()
  const ownerOrgId = String(conversation.owner_org_id || '').trim().toLowerCase()
  const distributorOrgId = String(conversation.distributor_org_id || '').trim().toLowerCase()

  if (ownerUserId && ownerUserId === userId) return true
  if (ownerOrgId && ownerOrgId === orgId) return true

  if (actor.isHqSupport) {
    const childIds = new Set(
      (actor.childDistributorIds || []).map((id) => String(id || '').trim().toLowerCase()),
    )
    if (ownerOrgId && childIds.has(ownerOrgId)) return true
    if (distributorOrgId && childIds.has(distributorOrgId)) return true
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
