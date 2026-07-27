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
}

type StockCountDraftsPanelProps = {
  drafts: StockCountDraftListItem[]
  draftsOpen: boolean
  onToggleDraftsOpen: () => void
  currentSessionId: string | null
  formatDraftLabel: (draft: StockCountDraftListItem) => string
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
  isLegacyResetRequiredDraft: (draft: StockCountDraftListItem) => boolean
  legacyResetRequiredLabel: string
  countTypeLabelFor: (countType: string) => string | undefined
  onToggleDraftSelection: (draftId: string, checked: boolean) => void
}

/** Presentational only — Drafts & history panel markup unchanged. */
export function StockCountDraftsPanel({
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
}: StockCountDraftsPanelProps) {
  if (drafts.length === 0) return null

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
          {currentSessionId && (
            <Badge variant="outline" className="border-orange-300 text-orange-800">
              Current: {formatDraftLabel(drafts.find(d => d.id === currentSessionId) || drafts[0])}
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={onResetSession} disabled={discardingDrafts}>New count</Button>
          {!managingDrafts ? (
            <Button variant="outline" size="sm" onClick={onEnterManageDrafts}>
              Manage Drafts
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={onSelectAllDrafts} disabled={discardingDrafts || !drafts.some(draft => draft.deletable)}>
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
            </div>
          )}
        </div>
        {(draftsOpen || managingDrafts) && (!managingDrafts ? <div className="flex flex-wrap items-center gap-2">
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
                {drafts.filter(draft => draft.deletable).map(draft => {
                  const total = draft.scope_count || 0
                  const counted = draft.counted_count || 0
                  const legacyReset = isLegacyResetRequiredDraft(draft)
                  const status = legacyReset
                    ? legacyResetRequiredLabel
                    : total > 0 && counted === total ? 'Ready for Review' : counted > 0 ? 'Incomplete' : 'Draft'
                  return <TableRow key={draft.id}>
                    <TableCell><Checkbox checked={selectedDraftIds.has(draft.id)} disabled={discardingDrafts} onCheckedChange={checked => onToggleDraftSelection(draft.id, checked === true)} aria-label={`Select ${formatDraftLabel(draft)}`} /></TableCell>
                    <TableCell className="font-medium">{draft.reference_name || 'Unnamed draft'}</TableCell>
                    <TableCell>{draft.warehouse_name}</TableCell><TableCell>{draft.category_name}</TableCell>
                    <TableCell>{countTypeLabelFor(draft.count_type)}</TableCell>
                    <TableCell>{counted}/{total}</TableCell>
                    <TableCell><Badge variant="outline" className={legacyReset ? 'border-red-300 text-red-700' : status === 'Ready for Review' ? 'border-emerald-300 text-emerald-700' : status === 'Incomplete' ? 'border-amber-300 text-amber-700' : ''}>{status}</Badge></TableCell>
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
