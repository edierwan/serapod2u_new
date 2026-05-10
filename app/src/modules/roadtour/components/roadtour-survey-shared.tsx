'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface ResponseItem {
    response_id: string
    field_key: string
    field_label_snapshot: string | null
    field_type_snapshot: string | null
    answer_text: string | null
    answer_json: any
    answer_number: number | null
    media_url: string | null
}

export interface ResponseRow {
    id: string
    campaign_id: string
    campaign_name: string
    template_id: string
    template_name: string
    submitted_at: string
    response_status: string
    points_awarded: number
    am_name: string
    am_phone: string | null
    shop_id: string | null
    shop_name: string
    shop_branch: string | null
    shop_city: string | null
    shop_state: string | null
    completion_pct: number
    total_fields: number
    answered_count: number
    items: ResponseItem[]
}

export function formatAnswer(item: ResponseItem): string {
    if (item.answer_text != null && item.answer_text !== '') return String(item.answer_text)
    if (item.answer_number != null) return String(item.answer_number)
    if (item.media_url) return item.media_url
    if (item.answer_json !== null && item.answer_json !== undefined) {
        if (Array.isArray(item.answer_json)) return item.answer_json.join(', ')
        if (typeof item.answer_json === 'boolean') return item.answer_json ? 'Yes' : 'No'
        if (typeof item.answer_json === 'object') return JSON.stringify(item.answer_json)
        return String(item.answer_json)
    }
    return '—'
}

export function maskPhone(value: string): string {
    if (!value) return value
    const trimmed = value.replace(/\s+/g, '')
    if (trimmed.length <= 4) return trimmed
    return trimmed.slice(0, 3) + '****' + trimmed.slice(-3)
}

export function maskEmail(value: string): string {
    if (!value || !value.includes('@')) return value
    const [local, domain] = value.split('@')
    const visible = local.slice(0, Math.min(2, local.length))
    return `${visible}***@${domain}`
}

export function ResponseDetailsDialog({
    row,
    onClose,
}: {
    row: ResponseRow | null
    onClose: () => void
}) {
    return (
        <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose() }}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Response Details</DialogTitle>
                </DialogHeader>
                {row && (
                    <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
                            <div>
                                <p className="text-xs text-muted-foreground">Campaign</p>
                                <p className="font-medium">{row.campaign_name}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Template</p>
                                <p className="font-medium">{row.template_name}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Reference / AM</p>
                                <p className="font-medium">{row.am_name}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Shop</p>
                                <p className="font-medium">{row.shop_name}{row.shop_branch ? ` • ${row.shop_branch}` : ''}</p>
                                <p className="text-xs text-muted-foreground">{[row.shop_city, row.shop_state].filter(Boolean).join(', ')}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Submitted</p>
                                <p className="font-medium">{new Date(row.submitted_at).toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Points Awarded</p>
                                <p className="font-medium">{row.points_awarded}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Completion</p>
                                <p className="font-medium">{row.completion_pct}% ({row.answered_count}/{row.total_fields})</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Status</p>
                                <Badge variant="secondary" className="mt-0.5">{row.response_status}</Badge>
                            </div>
                        </div>

                        <div>
                            <h4 className="text-sm font-semibold mb-2">Answers</h4>
                            {row.items.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-3">No answers recorded.</p>
                            ) : (
                                <div className="space-y-2">
                                    {row.items.map((item) => {
                                        const type = item.field_type_snapshot || 'text'
                                        let display = formatAnswer(item)
                                        if (type === 'phone') display = maskPhone(display)
                                        // Don't auto-mask email here unless we add explicit detection — answer often unmaskable safely.
                                        return (
                                            <div key={item.response_id + ':' + item.field_key} className="rounded-lg border p-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-xs text-muted-foreground">{item.field_label_snapshot || item.field_key}</p>
                                                    <Badge variant="outline" className="text-[10px]">{type}</Badge>
                                                </div>
                                                <p className="text-sm font-medium mt-1 break-words">{display}</p>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end">
                            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
