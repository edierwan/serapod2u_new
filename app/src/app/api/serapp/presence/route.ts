import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSerappActor } from '@/lib/serapp/chat-auth'

export async function PATCH(request: Request) {
  try {
    const actor = await requireSerappActor()
    if (!actor.ok) return actor.error

    const body = await request.json().catch(() => ({}))
    const isOnline = body?.isOnline !== false
    const conversationId =
      typeof body?.conversationId === 'string' && body.conversationId ? body.conversationId : null
    const nowIso = new Date().toISOString()

    const admin = createAdminClient()
    await admin
      .from('serapp_user_presence')
      .upsert({
        user_id: actor.userId,
        current_conversation_id: conversationId,
        is_online: isOnline,
        last_seen_at: nowIso,
        updated_at: nowIso,
      }, { onConflict: 'user_id' })

    return NextResponse.json({
      ok: true,
      presence: {
        is_online: isOnline,
        current_conversation_id: conversationId,
        last_seen_at: nowIso,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Presence update failed.' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
