import type {
  H2mIncomingEligibilityMap,
  H2mIncomingLineEligibility,
} from './opening-balance-h2m-preflight'

export type H2mPreflightErrorCategory =
  | 'h2m_resolver_unavailable'
  | 'h2m_preflight_unauthorized'
  | 'h2m_cutoff_not_ready'
  | 'h2m_preflight_invalid_response'
  | 'h2m_preflight_failed'

export interface H2mResolverRow {
  order_item_id: string
  variant_id: string
  variant_name: string | null
  alternative_name: string | null
  variant_code: string | null
  product_code: string | null
  order_warehouse_organization_id: string | null
  cutoff_warehouse_organization_id: string | null
  session_warehouse_organization_id: string | null
  selected_stock_config_id: string | null
  stock_config_id: string | null
  config_variant_id: string | null
  config_label: string | null
  config_status: string | null
  allow_ord: boolean | null
  in_session_scope: boolean
  eligible: boolean
  reason_code: string
}

export interface CategorizedH2mPreflightError {
  category: H2mPreflightErrorCategory
  status: number
  errorCode: string
  userMessage: string
}

const errorText = (error: unknown) => {
  if (!error || typeof error !== 'object') return String(error ?? '')
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
  return [candidate.code, candidate.message, candidate.details, candidate.hint]
    .filter(value => value != null)
    .map(String)
    .join(' ')
}

export function categorizeH2mPreflightError(error: unknown): CategorizedH2mPreflightError {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown }
    : {}
  const errorCode = typeof candidate.code === 'string' ? candidate.code : 'unknown'
  const text = errorText(error).toLowerCase()

  if (
    errorCode === 'PGRST202' ||
    errorCode === '42883' ||
    text.includes('could not find the function') ||
    text.includes('does not exist') ||
    text.includes('schema cache')
  ) {
    return {
      category: 'h2m_resolver_unavailable',
      status: 503,
      errorCode,
      userMessage:
        'The H2M readiness database resolver is unavailable. Apply the required H2M resolver migration to this environment, then retry.',
    }
  }
  if (
    errorCode === '42501' ||
    errorCode === 'PGRST301' ||
    text.includes('permission_denied') ||
    text.includes('permission denied') ||
    text.includes('not authenticated')
  ) {
    return {
      category: 'h2m_preflight_unauthorized',
      status: 403,
      errorCode,
      userMessage: 'Your session is not authorized to run the H2M readiness check. Sign in again or contact an HQ administrator.',
    }
  }
  if (
    text.includes('inventory_cutoff_not_found') ||
    text.includes('inventory_cutoff_not_active') ||
    text.includes('stock_count_active_product_category_required') ||
    text.includes('invalid input syntax for type uuid')
  ) {
    return {
      category: 'h2m_cutoff_not_ready',
      status: 409,
      errorCode,
      userMessage: 'The saved Opening Balance cutoff is not ready yet. Reload the draft, then retry the check.',
    }
  }
  return {
    category: 'h2m_preflight_failed',
    status: 500,
    errorCode,
    userMessage: 'The current H2M receiving readiness check failed unexpectedly. Retry the check.',
  }
}

const nullableString = (value: unknown) => value == null || typeof value === 'string'

export function parseH2mResolverResponse(
  data: unknown,
  requestedOrderItemIds: string[],
): H2mIncomingEligibilityMap {
  if (!Array.isArray(data)) {
    throw new Error('h2m_preflight_invalid_response')
  }

  const eligibility: H2mIncomingEligibilityMap = {}
  for (const value of data) {
    if (!value || typeof value !== 'object') {
      throw new Error('h2m_preflight_invalid_response')
    }
    const row = value as Partial<H2mResolverRow>
    if (
      typeof row.order_item_id !== 'string' ||
      typeof row.variant_id !== 'string' ||
      typeof row.eligible !== 'boolean' ||
      typeof row.reason_code !== 'string' ||
      typeof row.in_session_scope !== 'boolean' ||
      !nullableString(row.stock_config_id) ||
      !nullableString(row.selected_stock_config_id) ||
      !nullableString(row.config_label) ||
      !nullableString(row.config_variant_id) ||
      !nullableString(row.config_status) ||
      !(row.allow_ord == null || typeof row.allow_ord === 'boolean')
    ) {
      throw new Error('h2m_preflight_invalid_response')
    }
    if (
      !requestedOrderItemIds.includes(row.order_item_id) ||
      eligibility[row.order_item_id]
    ) {
      throw new Error('h2m_preflight_invalid_response')
    }

    const result: H2mIncomingLineEligibility = {
      orderItemId: row.order_item_id,
      variantId: row.variant_id,
      incomingAvailable: row.eligible,
      configId: row.stock_config_id ?? null,
      selectedConfigId: row.selected_stock_config_id ?? null,
      configLabel: row.config_label ?? null,
      reasonCode: row.reason_code,
      variantName: row.variant_name ?? null,
      alternativeName: row.alternative_name ?? null,
      variantCode: row.variant_code ?? null,
      productCode: row.product_code ?? null,
      orderWarehouseOrganizationId: row.order_warehouse_organization_id ?? null,
      cutoffWarehouseOrganizationId: row.cutoff_warehouse_organization_id ?? null,
      sessionWarehouseOrganizationId: row.session_warehouse_organization_id ?? null,
      configVariantId: row.config_variant_id ?? null,
      configStatus: row.config_status ?? null,
      allowOrd: row.allow_ord ?? null,
      inSessionScope: row.in_session_scope ?? false,
    }
    eligibility[row.order_item_id] = result
  }

  if (Object.keys(eligibility).length !== requestedOrderItemIds.length) {
    throw new Error('h2m_preflight_invalid_response')
  }
  return eligibility
}
