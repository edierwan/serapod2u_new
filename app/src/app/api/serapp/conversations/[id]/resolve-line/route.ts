import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingChatTable, requireSerappActor } from '@/lib/serapp/chat-auth'
import {
  getConversationForOwner,
  parseSession,
  updateConversationSession,
} from '@/lib/serapp/conversation-service'
import { parseSerappLineResolutions, runSerappPasteCheck } from '@/lib/serapp/line-resolutions'
import { loadSerappCatalog, resolveSerappDistributorContext } from '@/lib/serapp/order-context'
import type { SerappChatCheckPayload } from '@/lib/serapp/chat-types'

/**
 * Apply one unmatched-line pick, re-check stock, persist session.
 * Does not allocate or create an order.
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
    const line = Number(body?.line)
    const variantId = typeof body?.variantId === 'string' ? body.variantId.trim() : ''
    if (!Number.isInteger(line) || line < 1 || !variantId) {
      return NextResponse.json({ error: 'line and variantId are required.' }, { status: 400 })
    }

    const admin = createAdminClient()
    const conversation = await getConversationForOwner(admin, id, actor.userId)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }

    let session = parseSession(conversation.session_json)
    const distributorId = typeof body?.distributorId === 'string'
      ? body.distributorId
      : session.distributorId
    if (distributorId) session = { ...session, distributorId }

    const pasteText = session.pendingPasteText
    if (!pasteText) {
      return NextResponse.json({ error: 'Paste a list first, then pick a product.' }, { status: 409 })
    }

    const ctx = await resolveSerappDistributorContext({
      distributorId: distributorId || undefined,
    })
    const catalog = await loadSerappCatalog(ctx)
    const lineResolutions = parseSerappLineResolutions([
      ...(session.lineResolutions || []),
      { line, variantId },
    ])
    const checked = runSerappPasteCheck(pasteText, catalog.variants, lineResolutions)

    const check: SerappChatCheckPayload = {
      summary: checked.summary,
      results: checked.results,
      estimatedOrderValue: checked.estimatedOrderValue,
      warehouseName: catalog.fulfillmentWarehouseName,
      distributorName: ctx.distributorName,
      pasteText,
    }

    session = {
      ...session,
      phase: 'checked',
      lastCheck: check,
      lastConfirm: null,
      lineResolutions,
    }
    await updateConversationSession(admin, id, session, {
      distributorOrgId: ctx.distributorId,
    })

    return NextResponse.json({
      session,
      check,
    })
  } catch (error) {
    if (isMissingChatTable(error)) {
      return NextResponse.json({ error: 'Chat tables not installed yet.' }, { status: 503 })
    }
    const status = typeof (error as { status?: number })?.status === 'number'
      ? (error as { status: number }).status
      : 500
    const message = error instanceof Error ? error.message : 'Could not resolve that line.'
    console.error('[serapp/resolve-line]', error)
    return NextResponse.json({ error: message }, { status })
  }
}

export const dynamic = 'force-dynamic'
