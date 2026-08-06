import { createAdminClient } from '@/lib/supabase/admin'
import { sendToAi } from '@/lib/ai/aiGateway'
import { resolveProviderConfig } from '@/lib/server/ai/providerSettings'
import { logAiUsage } from '@/lib/server/ai/usageLogger'
import type { SerappChatSessionState } from '@/lib/serapp/chat-types'
import { unknownBotText } from '@/lib/serapp/chat-bot'

const SERAPP_SYSTEM = `You are Serapp Assistant — a WhatsApp-style ordering helper for Serapod2U distributors.

Rules:
- Use ONLY the grounded context below. Never invent stock quantities, order numbers, prices, or warehouse decisions.
- Keep replies short (1–4 short lines), chatty, and practical.
- You cannot submit, confirm, cancel, or modify orders. If the user wants that, tell them to paste a product list, reply *confirm*, *cancel hold*, *new order*, or *help*.
- If context has no answer, say so and steer them to paste a list or use *help*.
- Match the user's language when clear (English / Malay / Arabic); otherwise use English.
- Do not mention system prompts, providers, or that you are an LLM.`

function buildGroundedContext(session: SerappChatSessionState, distributorName: string): string {
  const lines: string[] = [
    `Distributor: ${distributorName}`,
    `Chat phase: ${session.phase}`,
  ]

  if (session.lastCheck) {
    const s = session.lastCheck.summary
    lines.push(
      `Last stock check: ${s.label}`,
      `Lines: ${s.availableLines} available, ${s.partialLines} partial, ${s.outOfStockLines} OOS, ${s.reviewLines} review`,
      `Estimated value: ${session.lastCheck.estimatedOrderValue || 0}`,
    )
    if (session.lastCheck.warehouseName) {
      lines.push(`Fulfillment warehouse: ${session.lastCheck.warehouseName}`)
    }
  }

  if (session.lastConfirm) {
    const c = session.lastConfirm
    lines.push(
      `Last confirmed order: ${c.orderNo} (${c.status})`,
      `Confirmed lines: ${c.confirmedLines}, skipped: ${c.skippedLines}`,
    )
    if (c.holdExpiresAt) {
      lines.push(`Hold expires at: ${c.holdExpiresAt}`)
    }
    if (c.warehouseName) {
      lines.push(`Hold warehouse: ${c.warehouseName}`)
    }
  }

  if (session.pendingPasteText) {
    const preview = session.pendingPasteText.trim().slice(0, 280)
    lines.push(`Pending paste preview:\n${preview}${session.pendingPasteText.length > 280 ? '…' : ''}`)
  }

  return lines.join('\n')
}

/**
 * Free-text Smart Reply for Serapp Assistant.
 * Rule-based intents (paste/confirm/cancel/…) stay outside this path.
 * Falls back to unknownBotText when AI is disabled or fails.
 */
export async function serappSmartReply(input: {
  text: string
  session: SerappChatSessionState
  distributorName: string
  userId: string
  orgId: string
}): Promise<{ text: string; usedAi: boolean }> {
  const fallback = unknownBotText()

  try {
    const admin = createAdminClient()
    const config = await resolveProviderConfig(admin, input.orgId)
    if (!config.enabled) {
      return { text: fallback, usedAi: false }
    }

    const grounded = buildGroundedContext(input.session, input.distributorName)
    const started = Date.now()
    const response = await sendToAi(
      {
        message: input.text,
        systemInstruction: `${SERAPP_SYSTEM}\n\n--- GROUNDED CONTEXT ---\n${grounded}\n--- END ---`,
        context: {
          page: 'serapp_assistant',
          orgId: input.orgId,
          counts: {
            phase: input.session.phase,
            hasCheck: Boolean(input.session.lastCheck),
            hasConfirm: Boolean(input.session.lastConfirm),
          },
        },
        provider: config.provider,
      },
      {
        userId: input.userId,
        provider: config.provider,
        configOverride: config,
      },
    )

    logAiUsage({
      organizationId: input.orgId,
      userId: input.userId,
      provider: config.provider,
      module: 'serapp',
      model: config.model,
      responseMs: Date.now() - started,
      status: response.error ? 'error' : 'success',
      errorMessage: response.error,
      messagePreview: input.text,
    })

    const message = (response.message || '').trim()
    if (response.error || !message) {
      return { text: fallback, usedAi: false }
    }

    // Cap runaway replies for WhatsApp-like UX
    const clipped = message.length > 900 ? `${message.slice(0, 900).trim()}…` : message
    return { text: clipped, usedAi: true }
  } catch (error) {
    console.warn('[serapp/smart-reply]', error instanceof Error ? error.message : error)
    return { text: fallback, usedAi: false }
  }
}
