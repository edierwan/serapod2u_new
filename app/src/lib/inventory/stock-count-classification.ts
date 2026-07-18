import { sumStockCountImpacts } from './stock-count-costing'

export const CLASSIFICATION_TARGET_CONFIG_CODES = ['20NB', '50NB', '50OB'] as const
export const CLASSIFICATION_LEGACY_CONFIG_CODE = 'UNCLASSIFIED'

export interface InitialClassificationInventoryRow {
  variantId: string
  productName: string
  variantName: string
  configCode: string
  systemQuantity: number
}

export interface InitialClassificationGroup<TRow extends InitialClassificationInventoryRow> {
  variantId: string
  productName: string
  variantName: string
  legacyRow: TRow
  targetRows: TRow[]
}

/**
 * Build the export/UI scope from current balances. A completed flavour drops
 * out only when its Legacy balance reaches zero; a deferred flavour remains in
 * scope because its positive Legacy balance is untouched.
 */
export function buildInitialClassificationGroups<TRow extends InitialClassificationInventoryRow>(
  rows: TRow[],
): InitialClassificationGroup<TRow>[] {
  const byVariant = new Map<string, TRow[]>()
  rows.forEach((row) => {
    const list = byVariant.get(row.variantId)
    if (list) list.push(row)
    else byVariant.set(row.variantId, [row])
  })

  const groups: InitialClassificationGroup<TRow>[] = []
  byVariant.forEach((variantRows) => {
    const legacyRow = variantRows.find(
      row => row.configCode === CLASSIFICATION_LEGACY_CONFIG_CODE && row.systemQuantity > 0,
    )
    if (!legacyRow) return

    const targetOrder = new Map<string, number>(
      CLASSIFICATION_TARGET_CONFIG_CODES.map((code, index) => [code, index]),
    )
    const targetRows = variantRows
      .filter(row => (CLASSIFICATION_TARGET_CONFIG_CODES as readonly string[]).includes(row.configCode))
      .sort((a, b) => (targetOrder.get(a.configCode) ?? 999) - (targetOrder.get(b.configCode) ?? 999))
    groups.push({
      variantId: legacyRow.variantId,
      productName: legacyRow.productName,
      variantName: legacyRow.variantName,
      legacyRow,
      targetRows,
    })
  })

  return groups.sort((a, b) => `${a.productName} ${a.variantName}`.localeCompare(`${b.productName} ${b.variantName}`))
}

export interface ClassificationTargetInput {
  configCode: string
  physicalCount: string
}

export interface ClassificationEntryResult {
  classifiedTotal: number
  variance: number
  complete: boolean
  /** A flavour is *selected* for this classification round when at least one of
   *  its three target Physical Count fields is non-null (an explicit 0 counts as
   *  selected). A flavour with all three targets blank is deferred to a later
   *  round: its Legacy balance must NOT be consumed, validated, summed, or
   *  posted. This distinction is what stops a two-flavour round from being
   *  charged the gross removal of every other flavour's Legacy stock. */
  selected: boolean
  countedTargets: number
  /** Total inventory = legacy system quantity (the source balance being
   *  classified). This deliberately never adds the legacy system quantity to
   *  the target physical counts — the legacy balance is the source, not an
   *  additional stock layer. When the classification is complete, the legacy
   *  row is cleared to zero and its entire balance has moved to the target
   *  configurations, so total inventory = classifiedTotal (= the sum of the
   *  three target physical counts) + any remaining legacy balance (which is
   *  zero after a complete classification).
   *
   *  Example: legacy = 100, targets 40+35+25 → total = 100, not 200.
   *
   *  For an incomplete classification, totalInventory = legacy system qty
   *  (the source balance stays on legacy until cleared). A complete
   *  classification clears legacy to zero and moves everything to targets,
   *  so totalInventory = classifiedTotal. */
  totalInventory: number
}

export interface ClassificationCardDisplay {
  totalTargetPhysicalCount: number | null
  variance: number | null
  completionStatus: 'Deferred' | 'Incomplete' | 'Complete'
}

/**
 * Keep deferred flavours visually distinct from a selected count of zero.
 * Their numeric entry result is retained for internal calculations, but an
 * all-blank flavour has no display total or variance and is not incomplete.
 */
export function getClassificationCardDisplay(
  entry: Pick<ClassificationEntryResult, 'classifiedTotal' | 'variance' | 'complete' | 'selected'>,
): ClassificationCardDisplay {
  if (!entry.selected) {
    return {
      totalTargetPhysicalCount: null,
      variance: null,
      completionStatus: 'Deferred',
    }
  }

  return {
    totalTargetPhysicalCount: entry.classifiedTotal,
    variance: entry.variance,
    completionStatus: entry.complete ? 'Complete' : 'Incomplete',
  }
}

const parseCount = (value: string): number | null => (value.trim() === '' ? null : Number(value))

export function computeClassificationEntry(
  legacySystemQuantity: number,
  targets: ClassificationTargetInput[],
): ClassificationEntryResult {
  const counted = targets.filter((target) => parseCount(target.physicalCount) !== null)
  const classifiedTotal = counted.reduce((sum, target) => sum + (parseCount(target.physicalCount) || 0), 0)
  const complete = targets.length > 0 && counted.length === targets.length
  // Total inventory is the legacy source balance. When complete, that balance
  // has moved entirely to the target configurations (the legacy row will be
  // cleared to zero). When incomplete, the legacy source is unchanged so
  // totalInventory = legacySystemQuantity (the targets have been partially
  // entered but the legacy balance hasn't been touched yet because nothing
  // has been posted).
  const totalInventory = complete ? classifiedTotal : legacySystemQuantity
  return {
    classifiedTotal,
    variance: classifiedTotal - legacySystemQuantity,
    complete,
    selected: counted.length > 0,
    countedTargets: counted.length,
    totalInventory,
  }
}

export interface ClassificationRoundGroupInput {
  legacySystemQuantity: number
  unitCost: number | null
  targets: ClassificationTargetInput[]
}

export interface ClassificationRoundSummary {
  totalFlavours: number
  /** Flavours with ≥1 target counted — the ones this round posts. */
  selectedFlavours: number
  /** Flavours with all three targets blank — left for a later round. */
  deferredFlavours: number
  /** Selected flavours with all three targets counted. */
  completeFlavours: number
  /** Selected flavours still missing a target — these block posting. */
  partialFlavours: number
  /** Legacy balance of the selected flavours only. */
  selectedLegacyTotal: number
  /** Target physical total of the selected flavours only. */
  selectedTargetTotal: number
  /** Genuine net variance = Σ(target total − legacy) over COMPLETE selected
   *  flavours. Deferred flavours never contribute their −legacy here (that
   *  double-charge produced the incident's −3,160). */
  netVariance: number
  estimatedValue: number
}

// Summarise one classification round with correct selection semantics. Deferred
// (all-blank) flavours contribute nothing; only selected flavours count toward
// the totals, and only complete selected flavours toward the posting-relevant
// net variance and value.
export function summarizeClassificationRound(
  groups: ClassificationRoundGroupInput[],
): ClassificationRoundSummary {
  const entries = groups.map((group) => ({
    group,
    ...computeClassificationEntry(group.legacySystemQuantity, group.targets),
  }))
  const selected = entries.filter((entry) => entry.selected)
  const completeSelected = selected.filter((entry) => entry.complete)
  return {
    totalFlavours: entries.length,
    selectedFlavours: selected.length,
    deferredFlavours: entries.length - selected.length,
    completeFlavours: completeSelected.length,
    partialFlavours: selected.length - completeSelected.length,
    selectedLegacyTotal: selected.reduce((sum, entry) => sum + entry.group.legacySystemQuantity, 0),
    selectedTargetTotal: selected.reduce((sum, entry) => sum + entry.classifiedTotal, 0),
    netVariance: completeSelected.reduce((sum, entry) => sum + entry.variance, 0),
    estimatedValue: sumStockCountImpacts(completeSelected.map((entry) => ({
      quantityChange: entry.variance, baseCost: entry.group.unitCost,
    }))),
  }
}