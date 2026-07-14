'use client'

/**
 * Email Report dialog for the Return Product management dashboard.
 *
 * The PDF attachment is generated once when the dialog opens — the exact same
 * document Preview PDF shows — then sent server-side through the configured
 * email provider (never mailto:). Subject and message are auto-generated from
 * the current report but remain fully editable.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mail, X, FileText, Eye } from 'lucide-react'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import type { ReturnReportPdf } from '@/lib/returns/report-pdf'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const dataUrl = String(reader.result || '')
            resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
        }
        reader.onerror = () => reject(new Error('Failed to read the PDF attachment'))
        reader.readAsDataURL(blob)
    })
}

/** Chip-style multi email input: Enter / comma / blur adds an address. */
function EmailChipsInput({
    id, emails, onChange, placeholder, disabled,
}: {
    id: string
    emails: string[]
    onChange: (emails: string[]) => void
    placeholder?: string
    disabled?: boolean
}) {
    const [draft, setDraft] = useState('')
    const [error, setError] = useState<string | null>(null)

    const commit = () => {
        const value = draft.trim().replace(/[,;]+$/, '')
        if (!value) { setDraft(''); return }
        if (!EMAIL_RE.test(value)) {
            setError(`"${value}" is not a valid email address`)
            return
        }
        if (emails.some((e) => e.toLowerCase() === value.toLowerCase())) {
            setError(`${value} has already been added`)
            setDraft('')
            return
        }
        onChange([...emails, value])
        setDraft('')
        setError(null)
    }

    return (
        <div>
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
                {emails.map((email) => (
                    <span key={email} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                        {email}
                        {!disabled && (
                            <button
                                type="button"
                                onClick={() => onChange(emails.filter((e) => e !== email))}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={`Remove ${email}`}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        )}
                    </span>
                ))}
                <input
                    id={id}
                    className="min-w-[160px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                    value={draft}
                    placeholder={emails.length === 0 ? placeholder : undefined}
                    disabled={disabled}
                    onChange={(e) => { setDraft(e.target.value); setError(null) }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); commit() }
                        if (e.key === 'Backspace' && !draft && emails.length > 0) onChange(emails.slice(0, -1))
                    }}
                    onBlur={commit}
                />
            </div>
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
    )
}

export interface ReturnReportEmailDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Builds the exact report PDF (same generator as Preview / Download). */
    buildPdf: () => Promise<ReturnReportPdf>
    reportMode: 'monthly' | 'quarterly'
    periodLabel: string
    defaultSubject: string
    defaultMessage: string
}

export function ReturnReportEmailDialog({
    open, onOpenChange, buildPdf, reportMode, periodLabel, defaultSubject, defaultMessage,
}: ReturnReportEmailDialogProps) {
    const { toast } = useToast()
    const [to, setTo] = useState<string[]>([])
    const [cc, setCc] = useState<string[]>([])
    const [subject, setSubject] = useState(defaultSubject)
    const [message, setMessage] = useState(defaultMessage)
    const [pdf, setPdf] = useState<ReturnReportPdf | null>(null)
    const [pdfError, setPdfError] = useState<string | null>(null)
    const [sending, setSending] = useState(false)
    const sendingRef = useRef(false)

    // Regenerate the attachment + templates each time the dialog opens so it
    // always reflects the currently selected period and filters.
    useEffect(() => {
        if (!open) return
        setSubject(defaultSubject)
        setMessage(defaultMessage)
        setPdf(null)
        setPdfError(null)
        let cancelled = false
        buildPdf()
            .then((result) => { if (!cancelled) setPdf(result) })
            .catch(() => { if (!cancelled) setPdfError('Failed to generate the report PDF. Close and try again.') })
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    const previewPdf = useCallback(() => {
        if (!pdf) return
        const url = URL.createObjectURL(pdf.blob)
        window.open(url, '_blank')
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }, [pdf])

    const send = async () => {
        // Guard against double submission (state + ref for immediate re-entry).
        if (sendingRef.current || !pdf) return
        if (to.length === 0) {
            toast({ title: 'Recipient required', description: 'Enter at least one valid To email address.', variant: 'destructive' })
            return
        }
        if (!subject.trim() || !message.trim()) {
            toast({ title: 'Subject and message required', variant: 'destructive' })
            return
        }
        sendingRef.current = true
        setSending(true)
        try {
            const pdfBase64 = await blobToBase64(pdf.blob)
            const res = await fetch('/api/returns/reporting/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to, cc,
                    subject: subject.trim(),
                    message: message.trim(),
                    filename: pdf.filename,
                    pdfBase64,
                    reportMode,
                    periodLabel,
                }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Unable to send the report. Please check the email configuration and try again.')
            toast({
                title: 'Report sent',
                description: `Return Product Report for ${periodLabel} was sent successfully to ${json.recipientCount} recipient(s).`,
            })
            onOpenChange(false)
            setTo([])
            setCc([])
        } catch (e: any) {
            toast({ title: 'Failed to send report', description: e.message, variant: 'destructive' })
        } finally {
            sendingRef.current = false
            setSending(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!sending) onOpenChange(next) }}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Email Report</DialogTitle>
                    <DialogDescription>
                        Send the Return Product Report for {periodLabel} as a PDF attachment.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="report-email-to">To <span className="text-destructive">*</span></Label>
                        <EmailChipsInput id="report-email-to" emails={to} onChange={setTo} placeholder="management@company.com — press Enter to add" disabled={sending} />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="report-email-cc">CC</Label>
                        <EmailChipsInput id="report-email-cc" emails={cc} onChange={setCc} placeholder="Optional" disabled={sending} />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="report-email-subject">Subject <span className="text-destructive">*</span></Label>
                        <Input id="report-email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={sending} maxLength={250} />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="report-email-message">Message <span className="text-destructive">*</span></Label>
                        <Textarea id="report-email-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={9} disabled={sending} className="text-sm" />
                    </div>

                    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {pdfError ? (
                            <span className="text-destructive">{pdfError}</span>
                        ) : pdf ? (
                            <>
                                <span className="truncate font-medium">{pdf.filename}</span>
                                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatBytes(pdf.size)}</span>
                            </>
                        ) : (
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating PDF attachment…
                            </span>
                        )}
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
                    <Button variant="outline" onClick={previewPdf} disabled={!pdf || sending} className="gap-1.5">
                        <Eye className="h-4 w-4" /> Preview PDF
                    </Button>
                    <Button onClick={send} disabled={!pdf || sending || to.length === 0} className="gap-1.5">
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                        {sending ? 'Sending…' : 'Send Report'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
