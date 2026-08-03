'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ChevronDown, MoreHorizontal } from 'lucide-react'

export type StockCountDraftListItem = {
  id: string
  reference_name: string | null
  count_date: string
  count_type: string
  status: string
  warehouse_organization_id: string
  product_category_id: string | null
  created_at: string
  updated_at: string | null
  created_by: string | null
  warehouse_name?: string
  category_name?: string
  created_by_name?: string
  scope_count?: number
  counted_count?: number
  deletable?: boolean
  protection_reason?: string
  history_badge?: string
  history_detail?: string
}

// Generic over the caller's own draft row type (which narrows count_type/status
// to unions), so the callbacks below stay exactly typed without a cast.
type StockCountDraftsPanelProps<T extends StockCountDraftListItem> = {
  drafts: T[]
  draftsOpen: boolean
  onToggleDraftsOpen: () => void
  currentSessionId: string | null
  formatDraftLabel: (draft: T) => string
  onResetSession: () => void
  discardingDrafts: boolean
  managingDrafts: boolean
  onEnterManageDrafts: () => void
  onSelectAllDrafts: () => void
  onDeselectAllDrafts: () => void
  onRequestDiscardDrafts: (ids: string[]) => void
  selectedDraftIds: Set<string>
  onExitManageDrafts: () => void
  staleDraftIds: Set<string>
  onLoadDraft: (draftId: string) => void
  isLegacyResetRequiredDraft: (draft: T) => boolean
  legacyResetRequiredLabel: string
  countTypeLabelFor: (countType: string) => string | undefined
  onToggleDraftSelection: (draftId: string, checked: boolean) => void
  /** Bucket label for the count type whose history is being shown. */
  historyLabel: string
  /** Shown instead of an empty list, so the panel never silently disappears. */
  emptyMessage: string
}

/** Presentational only — Drafts & history panel markup unchanged. */
export function StockCountDraftsPanel<T extends StockCountDraftListItem>({
  drafts,
  draftsOpen,
  onToggleDraftsOpen,
  currentSessionId,
  formatDraftLabel,
  onResetSession,
  discardingDrafts,
  managingDrafts,
  onEnterManageDrafts,
  onSelectAllDrafts,
  onDeselectAllDrafts,
  onRequestDiscardDrafts,
  selectedDraftIds,
  onExitManageDrafts,
  staleDraftIds,
  onLoadDraft,
  isLegacyResetRequiredDraft,
  legacyResetRequiredLabel,
  countTypeLabelFor,
  onToggleDraftSelection,
  historyLabel,
  emptyMessage,
}: StockCountDraftsPanelProps<T>) {
  const removableCount = drafts.filter(draft => draft.deletable).length
  const protectedCount = drafts.length - removableCount

  return (
    <Card className="border-blue-100 bg-[var(--sera-orange)]/[0.06]/50">
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-1 py-1 text-sm font-semibold text-blue-950"
            onClick={onToggleDraftsOpen}
          >
            Drafts & history ({drafts.length})
            <ChevronDown className={`ml-1 h-4 w-4 transition ${draftsOpen ? '' : '-rotate-90'}`} />
          </Button>
          <Badge variant="outline" className="border-orange-300 text-orange-700">{historyLabel}</Badge>
          {currentSessionId && drafts.length > 0 && (
            <Badge variant="outline" className="border-orange-300 text-orange-800">
              Current: {formatDraftLabel(drafts.find(d => d.id === currentSessionId) || drafts[0])}
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={onResetSession} disabled={discardingDrafts}>New count</Button>
          {!managingDrafts ? (
            <Button variant="outline" size="sm" disabled={drafts.length === 0} onClick={onEnterManageDrafts}>
              Manage Drafts
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={onSelectAllDrafts} disabled={discardingDrafts || removableCount === 0}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={onDeselectAllDrafts} disabled={discardingDrafts || selectedDraftIds.size === 0}>
                Deselect All
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onRequestDiscardDrafts([...selectedDraftIds])}
                disabled={discardingDrafts || selectedDraftIds.size === 0}
              >
                {discardingDrafts ? 'Discarding...' : 'Discard Selected Drafts'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onExitManageDrafts} disabled={discardingDrafts}>
                Cancel
              </Button>
              <span className="text-xs text-slate-500">
                {removableCount} removable · {protectedCount} protected
              </span>
            </div>
          )}
        </div>
        {(draftsOpen || managingDrafts) && (!managingDrafts ? <div className="flex flex-wrap items-center gap-2">
          {drafts.length === 0 && (
            <span className="text-sm text-slate-500">{emptyMessage}</span>
          )}
          {drafts.map(draft => (
            <div key={draft.id} className="flex items-center gap-1">
              <Button
                variant={currentSessionId === draft.id ? 'default' : staleDraftIds.has(draft.id) ? 'destructive' : 'outline'}
                size="sm"
                disabled={discardingDrafts}
                onClick={() => {
                  void onLoadDraft(draft.id)
                }}
              >
                {formatDraftLabel(draft)}
              </Button>
              {!managingDrafts && draft.deletable && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 px-0" aria-label={`Draft actions for ${formatDraftLabel(draft)}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => void onLoadDraft(draft.id)}>Open Draft</DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-700 focus:text-red-700"
                      onClick={() => onRequestDiscardDrafts([draft.id])}
                    >
                      Discard Draft
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </div> : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-10">Select</TableHead><TableHead>Batch / draft</TableHead>
                <TableHead>Warehouse</TableHead><TableHead>Category</TableHead><TableHead>Count type</TableHead>
                <TableHead>Progress</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead>
                <TableHead>Last updated</TableHead><TableHead>Created by</TableHead><TableHead>Open</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {drafts.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center text-sm text-slate-500">{emptyMessage}</TableCell></TableRow>
                )}
                {/* Protected drafts stay VISIBLE (greyed, checkbox disabled) so the
                    operator can see why a slot is occupied instead of an empty list. */}
                {drafts.map(draft => {
                  const total = draft.scope_count || 0
                  const counted = draft.counted_count || 0
                  const legacyReset = isLegacyResetRequiredDraft(draft)
                  const statusBadge = legacyReset
                    ? legacyResetRequiredLabel
                    : (draft.history_badge || (draft.deletable ? 'Draft — Removable' : 'Protected'))
                  const statusDetail = legacyReset
                    ? 'Legacy draft must be discarded before a new category-scoped count can continue.'
                    : (draft.history_detail || draft.protection_reason)
                  return <TableRow key={draft.id} className={draft.deletable ? undefined : 'bg-slate-50'}>
                    <TableCell><Checkbox checked={selectedDraftIds.has(draft.id)} disabled={discardingDrafts || !draft.deletable} onCheckedChange={checked => onToggleDraftSelection(draft.id, checked === true)} aria-label={draft.deletable ? `Select ${formatDraftLabel(draft)}` : `${formatDraftLabel(draft)} is protected and cannot be discarded`} /></TableCell>
                    <TableCell className="font-medium">{draft.reference_name || 'Unnamed draft'}</TableCell>
                    <TableCell>{draft.warehouse_name}</TableCell><TableCell>{draft.category_name}</TableCell>
                    <TableCell>{countTypeLabelFor(draft.count_type)}</TableCell>
                    <TableCell>{counted}/{total}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={!draft.deletable ? 'border-slate-300 text-slate-600' : legacyReset ? 'border-red-300 text-red-700' : 'border-emerald-300 text-emerald-700'}>{statusBadge}</Badge>
                      {statusDetail && (
                        <span className="mt-1 block text-xs text-slate-500">{statusDetail}</span>
                      )}
                    </TableCell>
                    <TableCell>{new Date(draft.created_at).toLocaleString()}</TableCell>
                    <TableCell>{draft.updated_at ? new Date(draft.updated_at).toLocaleString() : '—'}</TableCell>
                    <TableCell>{draft.created_by_name}</TableCell>
                    <TableCell><Button variant="outline" size="sm" onClick={() => void onLoadDraft(draft.id)}>Open</Button></TableCell>
                  </TableRow>
                })}
              </TableBody>
            </Table>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
