/**
 * The canonical operational stock configuration.
 *
 * Final business decision: each operational product variant has exactly ONE
 * canonical active stock configuration, and the application resolves it rather
 * than asking the operator to choose.
 *
 *   Cellera cartridges → 20NB (20 mg · New Box)
 *   Non-vape products  → STD  (Standard)
 *
 * 20NB is deliberately not hard-coded anywhere in this module. Non-vape
 * variants resolve to STD, and a future third family would resolve to its own
 * code without a change here.
 *
 * This is the TypeScript mirror of public.resolve_operational_stock_config()
 * (migration 20260904100000). Both apply the same predicate, and the database
 * remains the authority: the UI resolves a configuration so it can submit the
 * exact stock_config_id, and the server re-resolves and fails closed if the
 * two ever disagree.
 *
 * Pure and framework-free so the rule can be unit tested directly.
 */

/** Codes retired to zero by LEGACY-CONFIG-CUTOVER-2026. Never operational. */
export const LEGACY_CONFIG_CODES = ['50NB', '50OB', 'UNCLASSIFIED'] as const

/** The legacy bucket that the is_variant_default sink used to resolve to. */
export const UNCLASSIFIED_CONFIG_CODE = 'UNCLASSIFIED'

export interface StockConfigurationLike {
  id: string
  config_code?: string | null
  config_label?: string | null
  status?: string | null
  default_for_ord?: boolean | null
  requires_repacking_before_sale?: boolean | null
}

export type CanonicalResolution =
  | { ok: true; stockConfigId: string; configCode: string; config: StockConfigurationLike }
  | { ok: false; reason: 'none' | 'ambiguous'; candidates: StockConfigurationLike[]; error: string }

const normalize = (value?: string | null): string => (value || '').trim().toUpperCase()

/** True for a configuration retired by the legacy cutover programme. */
export function isLegacyConfigCode(configCode?: string | null): boolean {
  const code = normalize(configCode)
  return (LEGACY_CONFIG_CODES as readonly string[]).includes(code) || code.includes('LEGACY')
}

/**
 * The candidate predicate, identical to public.v_canonical_stock_config:
 * active, flagged as the ORD default in master data, not the legacy bucket,
 * and not requiring a repack before it can be transacted.
 */
export function isCanonicalCandidate(config: StockConfigurationLike): boolean {
  if (normalize(config.status) !== 'ACTIVE') return false
  if (!config.default_for_ord) return false
  if (normalize(config.config_code) === UNCLASSIFIED_CONFIG_CODE) return false
  if (config.requires_repacking_before_sale) return false
  return true
}

/**
 * Resolve the one canonical configuration from a variant's configurations.
 *
 * Fails closed in both directions, exactly like the SQL resolver: zero
 * candidates and several candidates are both errors. Silently picking one of
 * several, or silently falling back to the variant default sink, is what
 * produced 303,598 units of UNCLASSIFIED stock in production.
 */
export function resolveCanonicalStockConfig(
  configs: StockConfigurationLike[],
  variantLabel?: string | null,
): CanonicalResolution {
  const candidates = (configs || []).filter(isCanonicalCandidate)
  const subject = (variantLabel || '').trim() || 'this variant'

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'none',
      candidates,
      error: `No canonical operational stock configuration for ${subject}. Master data must carry exactly one active default configuration that is not Legacy / Unclassified.`,
    }
  }

  if (candidates.length > 1) {
    const codes = candidates.map((c) => c.config_code || '?').sort().join(', ')
    return {
      ok: false,
      reason: 'ambiguous',
      candidates,
      error: `Ambiguous operational stock configuration for ${subject}: ${candidates.length} candidates (${codes}). Exactly one is required.`,
    }
  }

  const config = candidates[0]
  return {
    ok: true,
    stockConfigId: config.id,
    configCode: normalize(config.config_code),
    config,
  }
}

/**
 * Whether an operational screen should still show a Configuration control for
 * a set of rows.
 *
 * The rule is about choice, not about code. The question is not whether the
 * table as a whole shows more than one configuration — a mixed Cellera and
 * device list always does — but whether any single VARIANT appears under more
 * than one. Only then does the column tell the operator something they could
 * act on; otherwise "20 mg · New Box" repeated down a Cellera table (or
 * "Standard" down a device table) is noise.
 *
 * It reappears by itself the moment a variant genuinely carries two
 * configurations, which is the correct behaviour inside a migration window and
 * the reason this is computed rather than hard-coded to false.
 *
 * Historical surfaces never call this: Movement Reports, past Stock Count
 * sessions and audit drill-downs always show the configuration, because there
 * the old identity is the information.
 */
export function shouldShowConfigurationColumn(
  rows: Array<{ variantId?: string | null; stockConfigId?: string | null; configCode?: string | null }>,
): boolean {
  const perVariant = new Map<string, Set<string>>()
  for (const row of rows || []) {
    const variant = (row.variantId || '').trim()
    const config = (row.stockConfigId || '').trim() || normalize(row.configCode)
    if (!variant || !config) continue
    const seen = perVariant.get(variant) || new Set<string>()
    seen.add(config)
    if (seen.size > 1) return true
    perVariant.set(variant, seen)
  }
  return false
}
