import { createAdminClient } from '@/lib/supabase/admin'
import { getSerappAccessDecision } from '@/lib/serapp/access'
import type { SerappDistributorContext } from '@/lib/serapp/order-context'
import {
  DEFAULT_FULFILLMENT_WAREHOUSE_COLUMN,
  loadActiveHqFulfillmentWarehouses,
  resolveDefaultFulfillmentWarehouseId,
  resolveSellerHqId,
} from '@/lib/orders/hq-fulfillment-warehouses'
import { getTelegramLinkByTelegramUserId } from '@/lib/telegram/link-service'

/**
 * Resolve distributor order context for a linked Telegram user.
 * Mirrors Serapp session context but uses the persisted telegram_links row.
 */
export async function resolveTelegramDistributorContext(
  telegramUserId: number,
): Promise<SerappDistributorContext> {
  const link = await getTelegramLinkByTelegramUserId(telegramUserId)
  if (!link) {
    throw Object.assign(
      new Error('Telegram is not linked yet. Open Serapp → Telegram and send the link code here.'),
      { status: 403 },
    )
  }

  const admin = createAdminClient()

  const { data: requester, error: requesterError } = await admin
    .from('users')
    .select(`
      id,
      organization_id,
      account_scope,
      organizations:organization_id (
        id,
        org_name,
        org_type_code,
        org_code,
        parent_org_id,
        ${DEFAULT_FULFILLMENT_WAREHOUSE_COLUMN}
      )
    `)
    .eq('id', link.user_id)
    .single()

  if (requesterError || !requester?.organization_id) {
    throw Object.assign(new Error('Linked Serapod user not found.'), { status: 403 })
  }

  const organization = Array.isArray(requester.organizations)
    ? requester.organizations[0]
    : requester.organizations

  if (!organization) {
    throw Object.assign(new Error('Organization not found.'), { status: 403 })
  }

  const access = getSerappAccessDecision({
    accountScope: requester.account_scope,
    orgTypeCode: organization.org_type_code,
    organizationId: requester.organization_id,
    roleLevel: null,
  })

  if (!access.allowed || !access.isDistributor) {
    throw Object.assign(new Error('Linked account is not an active distributor.'), { status: 403 })
  }

  const distributorId = requester.organization_id

  const { data: distributor, error: distributorError } = await admin
    .from('organizations')
    .select('id, org_name, org_type_code, parent_org_id, is_active')
    .eq('id', distributorId)
    .single()

  if (distributorError || !distributor || distributor.org_type_code !== 'DIST' || !distributor.is_active) {
    throw Object.assign(new Error('Active distributor organization is required.'), { status: 400 })
  }

  const hqId = resolveSellerHqId({
    id: distributor.id,
    org_type_code: distributor.org_type_code,
    parent_org_id: distributor.parent_org_id,
  }) || distributor.parent_org_id

  if (!hqId) {
    throw Object.assign(new Error('Distributor is not linked to an HQ.'), { status: 400 })
  }

  const { data: hqOrg, error: hqError } = await admin
    .from('organizations')
    .select(`id, org_type_code, parent_org_id, ${DEFAULT_FULFILLMENT_WAREHOUSE_COLUMN}`)
    .eq('id', hqId)
    .single()

  if (hqError || !hqOrg) {
    throw Object.assign(new Error('Unable to resolve HQ for fulfillment warehouse.'), { status: 500 })
  }

  const { data: warehouses, error: warehouseError } = await loadActiveHqFulfillmentWarehouses(admin, hqId)
  if (warehouseError) {
    throw Object.assign(new Error(warehouseError.message), { status: 500 })
  }

  const defaultResolved = resolveDefaultFulfillmentWarehouseId(
    (hqOrg as any)[DEFAULT_FULFILLMENT_WAREHOUSE_COLUMN],
    warehouses,
  )

  const fulfillmentWarehouseId = defaultResolved.warehouseId || warehouses[0]?.id || null
  if (!fulfillmentWarehouseId) {
    throw Object.assign(
      new Error('No fulfillment warehouse is configured for this distributor HQ.'),
      { status: 400 },
    )
  }

  return {
    supabase: admin as SerappDistributorContext['supabase'],
    userId: requester.id,
    distributorId: distributor.id,
    distributorName: distributor.org_name,
    hqId,
    fulfillmentWarehouseId,
    isHqSupport: false,
    requesterOrganizationId: requester.organization_id,
  }
}
