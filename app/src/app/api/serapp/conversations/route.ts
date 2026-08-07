import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingChatTable, requireSerappActor } from '@/lib/serapp/chat-auth'
import {
  createConversation,
  ensureSeedConversations,
  listConversationsForUser,
} from '@/lib/serapp/conversation-service'

export async function GET() {
  try {
    const actor = await requireSerappActor()
    if (!actor.ok) return actor.error

    const admin = createAdminClient()
    let conversations = await ensureSeedConversations(admin, {
      userId: actor.userId,
      orgId: actor.orgId,
    })

    // Re-list sorted after seed
    conversations = await listConversationsForUser(admin, actor.userId)

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

    const { conversation, welcomeMessage } = await createConversation(admin, {
      userId: actor.userId,
      orgId: actor.orgId,
      kind: typeof body?.kind === 'string' ? body.kind : 'assistant',
      title: typeof body?.title === 'string' ? body.title : undefined,
      distributorOrgId: typeof body?.distributorId === 'string' ? body.distributorId : null,
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
