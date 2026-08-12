import { CELLERA_PROGRAM_CODE, resolveDistributorProgramCodes } from '@/lib/orders/d2h-product-program'

/**
 * Product category as selected by the D2H catalog/preflight queries. Every
 * caller must select `is_active` and the flag its rule matches on, otherwise a
 * rule cannot tell "not allowed" apart from "not selected" and would silently
 * drop rows.
 */
export interface ProgramCategory {
  id?: string | null
  is_active?: boolean | null
  is_vape?: boolean | null
}

export interface ProgramCategoryRule {
  /** Stable identifier for the allowed category family. */
  categoryKey: string
  /** Label used in user-facing validation messages. */
  label: string
  /**
   * PostgREST filters applied to the embedded `product_categories` relation.
   * Kept alongside `matches` so the SQL-side and in-memory rules cannot drift.
   */
  categoryFilters: Array<[column: string, value: boolean]>
  matches: (category: ProgramCategory | null | undefined) => boolean
}

/**
 * Distributor program -> allowed product category.
 *
 * Category membership is resolved from stable DB flags on `product_categories`,
 * never from product or category names, so renaming a category or adding a new
 * group/subgroup under it needs no code change.
 */
const PROGRAM_CATEGORY_RULES: Record<string, ProgramCategoryRule> = {
  [CELLERA_PROGRAM_CODE]: {
    categoryKey: 'vape',
    label: 'Vape',
    categoryFilters: [['is_vape', true], ['is_active', true]],
    matches: category => category?.is_vape === true && category?.is_active === true,
  },
}

export function programCategoryRuleForCodes(programCodes: string[]): ProgramCategoryRule | null {
  for (const code of programCodes) {
    const rule = PROGRAM_CATEGORY_RULES[code]
    if (rule) return rule
  }
  return null
}

/**
 * Resolves the category restriction for a distributor from its program
 * membership. Returns null when the distributor belongs to no program that
 * carries a category restriction, which leaves the catalog unrestricted.
 */
export async function resolveDistributorCategoryRule(
  admin: any,
  distributorId: string,
  ownerOrganizationId: string,
): Promise<ProgramCategoryRule | null> {
  const programCodes = await resolveDistributorProgramCodes(admin, distributorId, ownerOrganizationId)
  return programCategoryRuleForCodes(programCodes)
}

/**
 * The `product_categories` embed for a D2H product query. A restricted
 * distributor uses an inner join so products whose category is missing or
 * outside the program category are excluded by the database; an unrestricted
 * distributor keeps the outer join so uncategorised products still load.
 */
export function categoryRelationForRule(rule: ProgramCategoryRule | null): string {
  return rule
    ? 'product_categories!inner (id, is_active, is_vape)'
    : 'product_categories (id, is_active, is_vape)'
}

export function applyCategoryFilters<T>(query: T, rule: ProgramCategoryRule | null): T {
  if (!rule) return query
  return rule.categoryFilters.reduce(
    (acc: any, [column, value]) => acc.eq(`products.product_categories.${column}`, value),
    query as any,
  ) as T
}

export function isCategoryAllowed(
  rule: ProgramCategoryRule | null,
  category: ProgramCategory | null | undefined,
): boolean {
  if (!rule) return true
  return rule.matches(category)
}

const asSingle = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? (value[0] || null) : (value || null)

/**
 * Ids of requested variants whose product category is outside the distributor's
 * program category. Empty when the distributor is unrestricted.
 */
export function variantIdsOutsideProgramCategory(
  variants: any[],
  rule: ProgramCategoryRule | null,
): string[] {
  if (!rule) return []
  return variants
    .filter(variant => {
      const product = asSingle<any>(variant?.products)
      return !isCategoryAllowed(rule, asSingle<ProgramCategory>(product?.product_categories))
    })
    .map(variant => variant.id)
}

export function outsideProgramCategoryMessage(rule: ProgramCategoryRule): string {
  return `One or more selected products are outside the ${rule.label} category allowed for this distributor's program.`
}
