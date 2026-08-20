import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingChatTable, requireSerappActor } from '@/lib/serapp/chat-auth'
import {
  createConversation,
  ensureSeedConversations,
  findOrCreateOrgAssistant,
  listConversationsForActor,
} from '@/lib/serapp/conversation-service'

export async function GET() {
  try {
    const actor = await requireSerappActor()
    if (!actor.ok) return actor.error

    const admin = createAdminClient()
    let conversations = await ensureSeedConversations(admin, {
      userId: actor.userId,
      orgId: actor.orgId,
      orgName: actor.orgName,
      isHqSupport: actor.access.isHqSupport,
    })

    conversations = await listConversationsForActor(admin, {
      userId: actor.userId,
      orgId: actor.orgId,
      isHqSupport: actor.access.isHqSupport,
    })

    return NextResponse.json({ conversations })
  } catch (error) {
    if (isMissingChatTable(error)) {
      return NextResponse.json({
        error: 'Chat tables not installed yet. Apply migration 20260805130000_serapp_conversations.sql in Supabase Studio.',
        code: 'CHAT_SCHEMA_MISSING',
      }, { status: 503 })
    }
    console.error('[serapp/conversations GET]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to load chats.',
    }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSerappActor()
    if (!actor.ok) return actor.error

    const body = await request.json().catch(() => ({}))
    const admin = createAdminClient()
    const kind = typeof body?.kind === 'string' ? body.kind : 'assistant'
    let distributorOrgId = typeof body?.distributorId === 'string' ? body.distributorId : null
    let title = typeof body?.title === 'string' ? body.title : undefined
    let orgName = actor.orgName

    if (actor.access.isHqSupport && kind === 'assistant') {
      if (!distributorOrgId) {
        return NextResponse.json(
          { error: 'Select a distributor under this organization first.' },
          { status: 400 },
        )
      }
      const { data: distributor, error: distError } = await admin
        .from('organizations')
        .select('id, org_name, org_type_code, parent_org_id, is_active')
        .eq('id', distributorOrgId)
        .maybeSingle()
      if (
        distError
        || !distributor
        || distributor.org_type_code !== 'DIST'
        || distributor.parent_org_id !== actor.orgId
        || distributor.is_active !== true
      ) {
        return NextResponse.json(
          { error: 'That distributor is not under this HQ organization.' },
          { status: 400 },
        )
      }
      orgName = distributor.org_name
      title = title || distributor.org_name
      const conversation = await findOrCreateOrgAssistant(admin, {
        userId: actor.userId,
        distributorOrgId,
        distributorName: orgName,
      })
      return NextResponse.json({ conversation })
    }

    const { conversation, welcomeMessage } = await createConversation(admin, {
      userId: actor.userId,
      orgId: actor.orgId,
      orgName,
      kind,
      title,
      distributorOrgId: distributorOrgId || (kind === 'assistant' ? actor.orgId : null),
    })

    return NextResponse.json({ conversation, welcomeMessage })
  } catch (error) {
    if (isMissingChatTable(error)) {
      return NextResponse.json({
        error: 'Chat tables not installed yet. Apply migration 20260805130000_serapp_conversations.sql in Supabase Studio.',
        code: 'CHAT_SCHEMA_MISSING',
      }, { status: 503 })
    }
    console.error('[serapp/conversations POST]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to create chat.',
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
