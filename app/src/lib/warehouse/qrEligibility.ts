/**
 * Warehouse QR eligibility helpers.
 *
 * Buffer/warranty QR codes are part of QR *eligibility* — for both full and
 * partial receiving they must transition to `received_warehouse` so the codes
 * become scannable, mirroring the existing full-receive QR flow. This is purely
 * a QR status transition; it does NOT post any inventory. Inventory for the
 * warranty buffer is only created by the full-receive path.
 *
 * The number of buffer codes marked follows the existing full-receive rule:
 * floor(receivedNonBufferUnits * warrantyBonusPercent / 100) per variant — i.e.
 * the manufacturer's *configured* warranty percentage, not the raw count of
 * (possibly over-generated) buffer codes.
 *
 * Idempotent: only marks the shortfall between the target and the buffer codes
 * already received, so it is safe to call repeatedly (worker + reconciliation).
 */

const BUFFER_RECEIVABLE_STATUSES = ['buffer_available', 'available', 'created']

/**
 * Mark warranty buffer QR codes as received for the given variants.
 *
 * @returns Map<variant_id, units_marked_in_this_call>
 */
export async function markWarrantyBufferReceived(
  supabase: any,
  batchId: string,
  variantIds: string[],
  warrantyBonusPercent: number,
): Promise<Map<string, number>> {
  const marked = new Map<string, number>()
  if (!warrantyBonusPercent || warrantyBonusPercent <= 0) return marked

  const uniqueVariants = Array.from(new Set(variantIds.filter(Boolean)))

  for (const variantId of uniqueVariants) {
    // Eligible base = non-buffer units already received for this variant.
    const { count: receivedNonBuffer } = await supabase
      .from('qr_codes')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId)
      .eq('variant_id', variantId)
      .eq('is_buffer', false)
      .eq('status', 'received_warehouse')

    const target = Math.floor((receivedNonBuffer || 0) * (warrantyBonusPercent / 100))
    if (target <= 0) continue

    const { count: alreadyReceivedBuffer } = await supabase
      .from('qr_codes')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId)
      .eq('variant_id', variantId)
      .eq('is_buffer', true)
      .eq('status', 'received_warehouse')

    const toMark = target - (alreadyReceivedBuffer || 0)
    if (toMark <= 0) continue

    const { data: bufferCodes } = await supabase
      .from('qr_codes')
      .select('id')
      .eq('batch_id', batchId)
      .eq('variant_id', variantId)
      .eq('is_buffer', true)
      .in('status', BUFFER_RECEIVABLE_STATUSES)
      .limit(toMark)

    if (bufferCodes && bufferCodes.length > 0) {
      const ids = bufferCodes.map((c: any) => c.id)
      // Update in sub-batches to stay within URL limits on large IN() clauses.
      for (let i = 0; i < ids.length; i += 50) {
        await supabase
          .from('qr_codes')
          .update({ status: 'received_warehouse' })
          .in('id', ids.slice(i, i + 50))
      }
      marked.set(variantId, bufferCodes.length)
    }
  }

  return marked
}
