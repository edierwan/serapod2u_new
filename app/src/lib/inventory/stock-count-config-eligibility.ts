// Centralized Stock Count configuration eligibility.
//
// A single source of truth for *which stock configurations may participate in a
// Stock Count* for a given product. Every surface — Opening Balance, Full /
// Partial / Spot counts, draft snapshot creation and reopening, UI totals and
// group tabs, Excel export/import, posting validation and backend/API
// validation — must derive eligibility from this module so they can never
// disagree.
//
// The model is deliberately GROUP-SCOPED and rule-driven, never based on the
// parent category alone and never on hardcoded product/variant names. A Vape
// category legitimately contains both flavour Cartridge groups (which use the
// 20mg/50mg concentration configurations) and Device groups (which must never
// carry a concentration configuration). The distinction is carried by an
// explicit, Product-Management-owned group attribute (`stock_config_profile`),
// not inferred from the configurations that happen to exist — because the very
// bug this module fixes is invalid concentration configurations existing on
// Device variants.

/**
 * Explicit configuration profile of a product GROUP. Owned by Product
 * Management via `product_groups.stock_config_profile` (see the accompanying
 * migration). Values:
 *
 *  - `concentration` — flavour / Cartridge groups. Valid configurations are the
 *    concentration set (20mg New Box, 50mg New Box, 50mg Old Box) plus a legacy
 *    Unclassified sink while pre-classification balances remain.
 *  - `standard` — Device groups and every non-flavour group (Speaker, Camping,
 *    Cat Treat, …). Exactly one Standard/Device configuration applies; no
 *    concentration, no flavour classification, and no New Box/Old Box packaging
 *    unless a Standard configuration was explicitly created for the Device.
 */
export type StockConfigProfile = 'concentration' | 'standard'

/**
 * Interim fallback when a group has no explicit `stock_config_profile` yet
 * (i.e. before the backfill migration has run). `concentration` preserves the
 * pre-existing behaviour so no legitimate Cartridge configuration is hidden
 * before the reviewed backfill classifies groups. Once the migration backfills
 * every group, this fallback is never reached in practice.
 */
export const DEFAULT_STOCK_CONFIG_PROFILE: StockConfigProfile = 'concentration'

export const CONCENTRATION_CONFIG_CODES = ['20NB', '50NB', '50OB'] as const
export const LEGACY_UNCLASSIFIED_CONFIG_CODE = 'UNCLASSIFIED'

export function resolveStockConfigProfile(
  value: string | null | undefined,
): StockConfigProfile {
  return value === 'concentration' || value === 'standard'
    ? value
    : DEFAULT_STOCK_CONFIG_PROFILE
}

export interface StockConfigEligibilityInput {
  /** Configuration code, e.g. 20NB / 50NB / 50OB / UNCLASSIFIED / STD. */
  configCode: string
  /** Concentration volume in ml, or null for non-concentration configs. */
  volumeMl?: number | null
  /** Packaging version (new_box / old_box), or null. */
  packaging?: string | null
  /** Explicit configuration profile of the owning product group. */
  groupProfile: StockConfigProfile
  /**
   * Whether the configuration currently carries stock activity — a non-zero
   * balance, an entered physical count, or a note. A legacy Unclassified sink is
   * eligible only while it still holds a balance to classify.
   */
  hasActivity: boolean
}

/**
 * A concentration configuration is any config that declares a nicotine-strength
 * volume or a Box packaging version, or that carries one of the canonical
 * concentration codes. These are the configurations that must NEVER appear for a
 * Device / non-flavour group.
 */
export function isConcentrationConfig(
  input: Pick<StockConfigEligibilityInput, 'configCode' | 'volumeMl' | 'packaging'>,
): boolean {
  if ((CONCENTRATION_CONFIG_CODES as readonly string[]).includes(input.configCode)) return true
  if (input.volumeMl != null) return true
  if (input.packaging != null) return true
  return false
}

export type StockConfigIneligibleReason =
  | 'concentration_config_on_non_flavour_group'
  | 'unclassified_without_balance'

export interface StockConfigEligibilityResult {
  eligible: boolean
  reason?: StockConfigIneligibleReason
}

/**
 * The single eligibility rule. Pure and deterministic.
 *
 *  - Concentration configs (20mg/50mg, any Box packaging) are eligible only for
 *    a `concentration` (flavour / Cartridge) group. On a `standard` (Device or
 *    other non-flavour) group they are always ineligible — this is what stops
 *    Devices showing 20mg/50mg/New Box, and what the backend rejects even when a
 *    manipulated request or Excel file submits one.
 *  - The legacy Unclassified sink is eligible only while it carries a balance
 *    (activity) that still needs classification — for both profiles, so existing
 *    Device Unclassified balances remain countable and can be transferred into
 *    the single Standard/Device configuration.
 *  - Every other configuration (STD / Standard / Device standard) is eligible.
 */
export function evaluateStockConfigEligibility(
  input: StockConfigEligibilityInput,
): StockConfigEligibilityResult {
  if (isConcentrationConfig(input)) {
    return input.groupProfile === 'concentration'
      ? { eligible: true }
      : { eligible: false, reason: 'concentration_config_on_non_flavour_group' }
  }
  if (input.configCode === LEGACY_UNCLASSIFIED_CONFIG_CODE) {
    return input.hasActivity
      ? { eligible: true }
      : { eligible: false, reason: 'unclassified_without_balance' }
  }
  return { eligible: true }
}

export function isStockConfigEligible(input: StockConfigEligibilityInput): boolean {
  return evaluateStockConfigEligibility(input).eligible
}

export interface StockConfigEligibilityViolation {
  stockConfigId: string
  configCode: string
  variantId: string
  reason: StockConfigIneligibleReason
  message: string
}

const ELIGIBILITY_MESSAGES: Record<StockConfigIneligibleReason, string> = {
  concentration_config_on_non_flavour_group:
    'A concentration configuration (20mg/50mg or Box packaging) is not valid for this product group. Device and other non-flavour groups use a single Standard configuration.',
  unclassified_without_balance:
    'An Unclassified (pending stock take) configuration with no remaining balance is not eligible for counting.',
}

export interface AssertableStockConfigRow {
  stockConfigId: string
  configCode: string
  variantId: string
  volumeMl?: number | null
  packaging?: string | null
  groupProfile: StockConfigProfile
  hasActivity: boolean
}

/**
 * Backend/posting guard. Returns every row that must be rejected. Callers submit
 * the rows they are about to persist/post (Opening Balance, Full/Partial/Spot,
 * or an imported Excel), and any violation blocks the operation. This makes the
 * backend authoritative: an invalid Device 20mg/50mg configuration is rejected
 * even if it was submitted through a manipulated request or Excel file.
 */
export function findIneligibleStockConfigs(
  rows: AssertableStockConfigRow[],
): StockConfigEligibilityViolation[] {
  const violations: StockConfigEligibilityViolation[] = []
  for (const row of rows) {
    const result = evaluateStockConfigEligibility(row)
    if (!result.eligible && result.reason) {
      violations.push({
        stockConfigId: row.stockConfigId,
        configCode: row.configCode,
        variantId: row.variantId,
        reason: result.reason,
        message: ELIGIBILITY_MESSAGES[result.reason],
      })
    }
  }
  return violations
}
