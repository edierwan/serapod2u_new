/**
 * One generic Product Variant archive contract shared by every Master Data UI.
 *
 * The database RPC is deliberately the only mutation entry point. It archives
 * the variant and its operational stock configurations in one transaction, so
 * the client cannot leave a partially archived variant behind.
 */

export const ARCHIVE_PRODUCT_VARIANT_RPC = 'archive_product_variant'

export interface VariantArchiveResult {
  status: 'archived'
  variant_id: string
  variant_is_active: false
  configurations_archived: number
  remaining_operational_configurations: 0
  already_archived: boolean
}

interface VariantArchiveRpcClient {
  rpc: (
    functionName: string,
    params: { p_variant_id: string },
  ) => PromiseLike<{ data: unknown; error: any }>
}

export class VariantArchiveRefreshError extends Error {
  constructor() {
    super('The variant was archived, but the Master Data list could not be refreshed. Refresh the page to load the authoritative database state.')
    this.name = 'VariantArchiveRefreshError'
  }
}

function isVariantArchiveResult(value: unknown, variantId: string): value is VariantArchiveResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  return result.status === 'archived'
    && result.variant_id === variantId
    && result.variant_is_active === false
    && result.remaining_operational_configurations === 0
    && typeof result.configurations_archived === 'number'
    && typeof result.already_archived === 'boolean'
}

export async function archiveProductVariant(
  client: VariantArchiveRpcClient,
  variantId: string,
): Promise<VariantArchiveResult> {
  const { data, error } = await client.rpc(ARCHIVE_PRODUCT_VARIANT_RPC, {
    p_variant_id: variantId,
  })
  if (error) throw error
  if (!isVariantArchiveResult(data, variantId)) {
    throw new Error('Variant archive did not return a verified database result.')
  }
  return data
}

/**
 * Success is intentionally withheld until the RPC and the authoritative reload
 * have both completed. Callers may show a success toast only after this resolves.
 */
export async function archiveProductVariantAndRefresh(
  client: VariantArchiveRpcClient,
  variantId: string,
  refresh: () => Promise<boolean>,
): Promise<VariantArchiveResult> {
  const result = await archiveProductVariant(client, variantId)
  if (!await refresh()) throw new VariantArchiveRefreshError()
  return result
}

export function variantArchiveSuccessDescription(result: VariantArchiveResult): string {
  const configurationText = result.configurations_archived === 1
    ? '1 stock configuration was made inactive.'
    : `${result.configurations_archived} stock configurations were made inactive.`
  return result.already_archived
    ? `The variant was already archived. ${configurationText}`
    : `The variant and its operational stock configurations are now inactive. ${configurationText} Historical records were preserved.`
}
