/**
 * AI Usage Logger — tracks all AI requests for analytics.
 * Runs server-side only via admin client.
 */
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export interface AiUsageEntry {
  organizationId: string
  userId: string
  provider: string
  module: string               // hr, finance, supply-chain, customer-growth
  model?: string
  tokensUsed?: number
  responseMs: number
  status: 'success' | 'error' | 'rate_limited' | 'offline'
  errorMessage?: string
  messagePreview?: string      // first 80 chars
}

/**
 * Log an AI usage event. Fire-and-forget (non-blocking).
 */
export function logAiUsage(entry: AiUsageEntry): void {
  // Fire-and-forget — don't await, don't block the response
  _insertUsageLog(entry).catch((err) => {
    console.error('[AI Usage Logger] Failed to log usage:', err.message)
  })
}

async function _insertUsageLog(entry: AiUsageEntry): Promise<void> {
  const admin = createAdminClient()

  const preview = entry.messagePreview
    ? entry.messagePreview.slice(0, 80).replace(/\n/g, ' ')
    : null

  const { error } = await (admin as any)
    .from('ai_usage_logs')
    .insert({
      organization_id: entry.organizationId,
      user_id: entry.userId,
      provider: entry.provider,
      module: entry.module,
      model: entry.model ?? null,
      tokens_used: entry.tokensUsed ?? 0,
      response_ms: entry.responseMs,
      status: entry.status,
      error_message: entry.errorMessage ?? null,
      message_preview: preview,
    })

  if (error) {
    console.error('[AI Usage Logger] Insert error:', error.message)
  }
}
