import { createAdminClient } from '@/lib/supabase/admin'

export type MessageNotificationStatus = 'queued' | 'sent' | 'delivered' | 'failed'

/** §39 — best-effort notification audit log; never throws. */
export async function logMessageNotification(input: {
  organizationId?: string | null
  userId?: string | null
  channel: string
  messageType: string
  referenceType?: string | null
  referenceId?: string | null
  recipientIdentifier?: string | null
  status: MessageNotificationStatus
  errorMessage?: string | null
}): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('message_notifications').insert({
      organization_id: input.organizationId ?? null,
      user_id: input.userId ?? null,
      channel: input.channel,
      message_type: input.messageType,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      recipient_identifier: input.recipientIdentifier ?? null,
      status: input.status,
      attempt_count: 1,
      sent_at: input.status === 'sent' || input.status === 'delivered' ? new Date().toISOString() : null,
      failed_at: input.status === 'failed' ? new Date().toISOString() : null,
      error_message: input.errorMessage ?? null,
    })
  } catch (error) {
    console.warn('[messaging/logMessageNotification]', error)
  }
}
