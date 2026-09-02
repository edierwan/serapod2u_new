import { createAdminClient } from '@/lib/supabase/admin'
import { downloadTelegramFile, getTelegramFilePath, inferTelegramPhotoMime } from '@/lib/telegram/bot-api'
import { resolveTelegramDistributorContext } from '@/lib/telegram/order-context'
import { resolveReceiptOrderForTelegram } from '@/lib/messaging/receipt-actions'
import { getTelegramLinkByTelegramUserId, updateTelegramSession } from '@/lib/telegram/link-service'
import type { TelegramFileDescriptor } from '@/lib/telegram/bot-api'

const BUCKET = 'messaging-discrepancy-evidence'

export async function attachTelegramPhotoToLatestDiscrepancy(input: {
  telegramUserId: number
  photos: TelegramFileDescriptor[]
  caption?: string | null
  orderNoArg?: string | null
}): Promise<{ attached: boolean; orderNo?: string; reason?: string }> {
  const ctx = await resolveTelegramDistributorContext(input.telegramUserId)
  const link = await getTelegramLinkByTelegramUserId(input.telegramUserId)

  let orderId = link?.session_json?.pendingDiscrepancyOrderId
  let orderNo = link?.session_json?.pendingDiscrepancyOrderNo || undefined

  if (input.orderNoArg || !orderId) {
    const resolved = await resolveReceiptOrderForTelegram(input.telegramUserId, input.orderNoArg)
    orderId = resolved.orderId
    orderNo = resolved.orderNo
  }

  if (!orderId) {
    return { attached: false, reason: 'no_order' }
  }

  const admin = createAdminClient()
  const { data: discId, error: discError } = await (admin as any).rpc('messaging_latest_open_discrepancy', {
    p_order_id: orderId,
    p_user_id: ctx.userId,
  })

  if (discError || !discId) {
    return { attached: false, reason: 'no_open_discrepancy' }
  }

  const photo = [...(input.photos || [])].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0]
  if (!photo?.file_id) {
    return { attached: false, reason: 'no_photo' }
  }

  const filePath = await getTelegramFilePath(photo.file_id)
  const { buffer, mimeType } = await downloadTelegramFile(filePath)
  const resolvedMime = mimeType.includes('image/') ? mimeType : inferTelegramPhotoMime(filePath)
  const ext = resolvedMime.split('/')[1] || 'jpg'
  const storagePath = `${orderId}/${discId}/${Date.now()}.${ext}`

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: resolvedMime, upsert: false })

  if (uploadError) {
    throw Object.assign(new Error(uploadError.message || 'Evidence upload failed.'), { status: 500 })
  }

  const { error: attachError } = await (admin as any).rpc('messaging_attach_discrepancy_evidence', {
    p_discrepancy_id: discId,
    p_user_id: ctx.userId,
    p_storage_path: storagePath,
    p_file_name: `telegram-${photo.file_unique_id}.${ext}`,
    p_mime_type: resolvedMime,
    p_file_size_bytes: photo.file_size ?? buffer.length,
    p_channel: 'telegram',
    p_channel_user_id: String(input.telegramUserId),
  })

  if (attachError) {
    throw Object.assign(new Error(attachError.message || 'Could not link evidence.'), { status: 409 })
  }

  await mergeTelegramSession(input.telegramUserId, {
    pendingDiscrepancyOrderId: undefined,
    pendingDiscrepancyOrderNo: undefined,
  })

  return { attached: true, orderNo }
}

async function mergeTelegramSession(
  telegramUserId: number,
  patch: { pendingDiscrepancyOrderId?: string; pendingDiscrepancyOrderNo?: string | null },
): Promise<void> {
  const link = await getTelegramLinkByTelegramUserId(telegramUserId)
  if (!link) return
  await updateTelegramSession(link.id, { ...link.session_json, ...patch })
}

export async function rememberPendingDiscrepancyPhoto(
  telegramUserId: number,
  orderId: string,
  orderNo: string,
): Promise<void> {
  await mergeTelegramSession(telegramUserId, {
    pendingDiscrepancyOrderId: orderId,
    pendingDiscrepancyOrderNo: orderNo,
  })
}
