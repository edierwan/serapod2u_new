import { parseSerappLineResolutions, runSerappPasteCheck } from '@/lib/serapp/line-resolutions'
import { loadSerappCatalog, resolveSerappDistributorContext } from '@/lib/serapp/order-context'
import type { SerappChatCheckPayload } from '@/lib/serapp/chat-types'

export async function runSerappStockCheck(input: {
  pasteText: string
  distributorId?: string | null
  lineResolutions?: unknown
}): Promise<SerappChatCheckPayload> {
  const ctx = await resolveSerappDistributorContext({
    distributorId: input.distributorId || null,
  })
  const catalog = await loadSerappCatalog(ctx)
  const resolutions = parseSerappLineResolutions(input.lineResolutions)
  const checked = runSerappPasteCheck(input.pasteText, catalog.variants, resolutions)

  return {
    summary: checked.summary,
    results: checked.results,
    estimatedOrderValue: checked.estimatedOrderValue,
    warehouseName: catalog.fulfillmentWarehouseName,
    distributorName: ctx.distributorName,
    pasteText: input.pasteText,
  }
}
