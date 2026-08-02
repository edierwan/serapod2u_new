export interface OpeningDraftItemState {
  stockConfigId: string
  physicalQuantity: number | null
  note: string
}

const normalizedNote = (value: string | null | undefined) => String(value || '').trim()

export function assertImmutableOpeningScopeComplete(
  persistedScopeIds: Iterable<string>,
  expectedScopeIds: Iterable<string>,
): Set<string> {
  const persisted = new Set([...persistedScopeIds].filter(Boolean))
  const expected = new Set([...expectedScopeIds].filter(Boolean))
  const missing = [...expected].filter(id => !persisted.has(id))
  const unexpected = [...persisted].filter(id => !expected.has(id))

  if (persisted.size === 0) {
    throw new Error('The saved Opening Balance scope is empty. The draft was not updated.')
  }
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `The saved Opening Balance scope is incomplete (${persisted.size} of ${expected.size} expected items). The draft was not updated.`,
    )
  }
  return persisted
}

export function assertOpeningDraftRowsComplete(
  scopeIds: Iterable<string>,
  loadedRowIds: Iterable<string>,
): void {
  const scope = new Set([...scopeIds].filter(Boolean))
  const loaded = new Set([...loadedRowIds].filter(Boolean))
  const missing = [...scope].filter(id => !loaded.has(id))
  if (missing.length > 0 || loaded.size !== scope.size) {
    throw new Error(
      `The Opening Balance draft reload returned ${loaded.size} of ${scope.size} scoped items. The previous complete view was preserved.`,
    )
  }
}

export function changedOpeningDraftItems(
  current: OpeningDraftItemState[],
  persisted: OpeningDraftItemState[],
): OpeningDraftItemState[] {
  const persistedByConfig = new Map(persisted.map(item => [item.stockConfigId, item]))
  return current.filter(item => {
    const previous = persistedByConfig.get(item.stockConfigId)
    return !previous
      || previous.physicalQuantity !== item.physicalQuantity
      || normalizedNote(previous.note) !== normalizedNote(item.note)
  })
}

export function openingDraftSaveDescription(input: {
  scopeCount: number
  changedItemCount: number
  countedOrNotedCount: number
}): string {
  const notCountedCount = Math.max(0, input.scopeCount - input.countedOrNotedCount)
  const changeText = input.changedItemCount === 0
    ? 'No quantity or note changes.'
    : `${input.changedItemCount} quantity or note row(s) updated.`
  return `${changeText} ${input.scopeCount} scoped item(s) preserved; ${input.countedOrNotedCount} counted or noted, ${notCountedCount} not counted.`
}
