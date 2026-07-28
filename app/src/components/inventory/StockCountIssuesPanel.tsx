'use client'

import { useEffect, useState } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AlertTriangle } from 'lucide-react'

type InvalidWarehouseDraftItem = {
  id: string
  reference_name: string | null
  count_date: string
  count_type: string
  warehouse_organization_id: string
  warehouse_name?: string
}

type StockCountIssuesPanelProps = {
  issueCount: number
  activeWarehouseRequiredMessage: string
  invalidWarehouseDrafts: InvalidWarehouseDraftItem[]
  countTypeLabelFor: (countType: string) => string
  warehouseNameFor: (warehouseOrganizationId: string, fallbackName?: string) => string
  isOpeningBalanceMode: boolean
  selectedCategory: string
  notCounted: number
  totalItems: number
  mustContinueExistingOpeningDraft: boolean
  existingOpeningDraftId: string | null
  onContinueExistingDraft: (draftId: string) => void
  isLegacyInitialReadOnly: boolean
  hasClassificationMisuse: boolean
  countTypeLabel: string
  classificationMisuseCount: number
  hasConfigEligibilityViolation: boolean
  configEligibilityViolationCount: number
  firstConfigEligibilityMessage?: string
}

/** Presentational only — Issues & guidance accordion markup unchanged. */
export function StockCountIssuesPanel({
  issueCount,
  activeWarehouseRequiredMessage,
  invalidWarehouseDrafts,
  countTypeLabelFor,
  warehouseNameFor,
  isOpeningBalanceMode,
  selectedCategory,
  notCounted,
  totalItems,
  mustContinueExistingOpeningDraft,
  existingOpeningDraftId,
  onContinueExistingDraft,
  isLegacyInitialReadOnly,
  hasClassificationMisuse,
  countTypeLabel,
  classificationMisuseCount,
  hasConfigEligibilityViolation,
  configEligibilityViolationCount,
  firstConfigEligibilityMessage,
}: StockCountIssuesPanelProps) {
  const shouldForceOpen =
    invalidWarehouseDrafts.length > 0
    || hasClassificationMisuse
    || hasConfigEligibilityViolation
    || mustContinueExistingOpeningDraft
    || isLegacyInitialReadOnly

  // Controlled so the panel re-opens when a blocking issue appears after mount
  // (e.g. selecting a category that already has an Opening Balance draft).
  const [issuesOpen, setIssuesOpen] = useState(shouldForceOpen ? 'issues' : '')
  useEffect(() => {
    if (shouldForceOpen) setIssuesOpen('issues')
  }, [shouldForceOpen])

  if (issueCount <= 0) return null

  const continueExistingDraftCard = mustContinueExistingOpeningDraft && existingOpeningDraftId ? (
    <Card className="border-blue-300 bg-blue-50">
      <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm text-blue-950">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">An Opening Balance draft already exists for this warehouse &amp; category</p>
            <p className="mt-1">Only one active Opening Balance draft is allowed per warehouse and category. Continue the existing draft instead of starting a second one — your earlier counts are preserved. Save Draft and Excel download stay blocked until you continue.</p>
          </div>
        </div>
        <Button size="sm" onClick={() => void onContinueExistingDraft(existingOpeningDraftId)}>Continue Existing Draft</Button>
      </CardContent>
    </Card>
  ) : null

  return (
    <div className="space-y-3">
      {/* Keep the blocking continue-draft action outside the accordion so wizard
          users cannot miss it after Setup → Count. */}
      {continueExistingDraftCard}

      <Accordion type="single" collapsible value={issuesOpen} onValueChange={setIssuesOpen}>
        <AccordionItem value="issues" className="rounded-xl border border-slate-200 bg-white px-4">
          <AccordionTrigger className="py-3 text-sm font-semibold hover:no-underline">
            Issues & guidance ({issueCount})
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pb-4">
            {invalidWarehouseDrafts.length > 0 && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="p-4 text-sm text-red-900">
                  <p className="font-semibold">Stock Count drafts blocked by invalid warehouse master data</p>
                  <p className="mt-1">{activeWarehouseRequiredMessage} These drafts remain unchanged and cannot be edited, exported, verified, or posted. Select an active warehouse and create a new draft.</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {invalidWarehouseDrafts.slice(0, 10).map(draft => (
                      <li key={draft.id}>
                        {draft.reference_name || countTypeLabelFor(draft.count_type) || 'Stock Count'} · {draft.count_date}
                        <span className="ml-1 text-xs">({warehouseNameFor(draft.warehouse_organization_id, draft.warehouse_name)})</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {isOpeningBalanceMode && (
              <Card className="border-orange-200 bg-orange-50">
                <CardContent className="p-4 text-sm text-orange-950">
                  <p className="font-semibold">One official pre-go-live workflow</p>
                  <p className="mt-1">Count every eligible configuration, including 20NB, 50NB, 50OB and any visible Legacy / Unclassified balance. Save the draft, then continue below to review orders, freeze the warehouse, preview, request OTP and post atomically.</p>
                  {selectedCategory && notCounted > 0 && (
                    <p className="mt-2 font-semibold">Opening Balance is incomplete: {notCounted} of {totalItems} items have not been counted. You may save and continue later.</p>
                  )}
                </CardContent>
              </Card>
            )}

            {isLegacyInitialReadOnly && (
              <Card className="border-amber-300 bg-amber-50">
                <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-950">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div><p className="font-semibold">Legacy Initial Classification — read only</p><p className="mt-1">This historical draft remains viewable but cannot be edited, imported, converted or posted. Start a new Inventory Opening Balance &amp; Initial Classification draft instead.</p></div>
                </CardContent>
              </Card>
            )}

            {hasClassificationMisuse && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="flex items-start gap-3 p-4 text-sm text-red-900">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">This looks like a classification, not a {countTypeLabel}.</p>
                    <p className="mt-1">{classificationMisuseCount} configuration count{classificationMisuseCount === 1 ? '' : 's'} target a 20ml/50ml box for a variant that still holds a Legacy/Unclassified balance. Use <strong>Inventory Opening Balance &amp; Initial Classification</strong> for the official go-live baseline. Posting this as a normal count is blocked.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {hasConfigEligibilityViolation && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="flex items-start gap-3 p-4 text-sm text-red-900">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Invalid configuration for this product group</p>
                    <p className="mt-1">{configEligibilityViolationCount} counted configuration{configEligibilityViolationCount === 1 ? '' : 's'} are not valid for their product group (for example a 20mg/50mg concentration configuration on a Device group). Remove these counts before saving or posting. {firstConfigEligibilityMessage}</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
