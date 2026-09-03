/**
 * Eligibility for the CONCENTRATION stock configurations (20NB / 50NB / 50OB).
 *
 * This is deliberately separate from `isCelleraVapeVariant`, which answers a
 * different and broader question ("is this a Cellera vape product at all?") and
 * is legitimately used elsewhere to include Devices. A Cellera Device is a
 * Cellera vape product — it is NOT a product that may carry a nicotine
 * concentration, because a Device has no liquid to concentrate.
 *
 * The authority for concentration eligibility is the Product-Management-owned
 * group attribute `product_groups.stock_config_profile`, exactly as enforced in
 * the database by `_enable_variant_stock_configurations_core` and the
 * `trg_stock_config_group_eligibility` trigger. It is never inferred from a
 * `CEL` product-code prefix, from the word "Cellera", from a group NAME, or
 * from variant naming — production spells its concentration group "Catridge",
 * which is precisely why names must not be predicates.
 *
 * Fail-closed: a product with no group, or a group whose profile is unknown, is
 * treated as `standard` and is NOT concentration eligible. This matches the SQL
 * guards' `COALESCE(profile, 'standard') <> 'concentration'` and is
 * intentionally stricter than `resolveStockConfigProfile`, whose
 * display-oriented default is `concentration`.
 *
 * Pure and framework-free so it can be unit tested directly and shared by the
 * bulk-eligible preview route and the bulk-enable mutation route.
 */

import { isCelleraVapeVariant, type CelleraVapeProductLike } from '@/lib/inventory/cellera-variant'

export const CONCENTRATION_GROUP_PROFILE = 'concentration'

export interface ConcentrationStockEligibilityInput {
  /** `product_variants.is_active`. */
  variantIsActive?: boolean | null
  /** The owning product, for the feature's existing Cellera/vape scope. */
  product?: CelleraVapeProductLike | null
  /** `product_groups.stock_config_profile` of the product's group, if any. */
  groupStockConfigProfile?: string | null
}

export type ConcentrationStockIneligibleReason =
  | 'variant_not_found'
  | 'variant_inactive'
  | 'product_inactive_or_out_of_scope'
  | 'group_profile_not_concentration'

export interface ConcentrationStockEligibilityResult {
  eligible: boolean
  reason?: ConcentrationStockIneligibleReason
}

export const CONCENTRATION_INELIGIBLE_MESSAGES: Record<ConcentrationStockIneligibleReason, string> = {
  variant_not_found: 'Variant does not exist.',
  variant_inactive: 'Variant is inactive.',
  product_inactive_or_out_of_scope: 'Product is inactive or outside the Cellera vape scope of this tool.',
  group_profile_not_concentration:
    'Product group is not configured for concentration stock (product_groups.stock_config_profile is not "concentration"). Devices and other standard groups keep a single Standard configuration.',
}

/**
 * The single eligibility rule, evaluated in the order a reviewer would read it.
 * Both the preview (GET) and the mutation (POST) must use this and nothing else.
 */
export function evaluateConcentrationStockConfigEligibility(
  input: ConcentrationStockEligibilityInput,
): ConcentrationStockEligibilityResult {
  if (!input.variantIsActive) return { eligible: false, reason: 'variant_inactive' }
  if (!isCelleraVapeVariant(input.product)) {
    return { eligible: false, reason: 'product_inactive_or_out_of_scope' }
  }
  if ((input.groupStockConfigProfile || 'standard') !== CONCENTRATION_GROUP_PROFILE) {
    return { eligible: false, reason: 'group_profile_not_concentration' }
  }
  return { eligible: true }
}

export function isConcentrationStockConfigEligible(input: ConcentrationStockEligibilityInput): boolean {
  return evaluateConcentrationStockConfigEligibility(input).eligible
}

/**
 * PostgREST returns an embedded relation as an object or, depending on the
 * inferred cardinality, a single-element array. Both routes read the same
 * nested `product_variants → products → product_groups` shape, so the
 * unwrapping lives here rather than being repeated per route.
 */
export function unwrapEmbedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export interface EligibilityRowParts {
  product: (CelleraVapeProductLike & { product_name?: string | null }) | null
  groupName: string | null
  groupStockConfigProfile: string | null
}

/** Pulls the product and its group out of a variant row from either route. */
export function readVariantRelations(variantRow: any): EligibilityRowParts {
  const product = unwrapEmbedded<any>(variantRow?.products)
  const group = unwrapEmbedded<any>(product?.product_groups)
  return {
    product,
    groupName: group?.group_name ?? null,
    groupStockConfigProfile: group?.stock_config_profile ?? null,
  }
}
