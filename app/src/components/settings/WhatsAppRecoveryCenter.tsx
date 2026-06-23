"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { formatPhoneDisplay } from "@/utils/phone"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    Activity,
    AlertCircle,
    AlertTriangle,
    BookOpen,
    CheckCheck,
    Download,
    Eye,
    FileText,
    KeyRound,
    ListChecks,
    Loader2,
    Mail,
    MailWarning,
    MessageCircle,
    Plus,
    QrCode,
    RefreshCw,
    Save,
    Search,
    Send,
    ShieldCheck,
    Sparkles,
    Trash2,
    UserPlus,
    Wifi,
    WifiOff,
} from "lucide-react"
import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

import type { UserProfileWithRelations } from "@/lib/server/get-user-profile"
import type { RecoveryPurpose } from "@/lib/wa-recovery/templates"
import {
    hasTrendActivity,
    isFailedStatus,
    isRecoverySentStatus,
    isResolvedStatus,
    RECOVERY_PURPOSES,
    type RecoveryTrendPoint,
} from "@/lib/wa-recovery/activity-status"

interface Props {
    userProfile: UserProfileWithRelations
}

interface RecoveryStatusInfo {
    id: string
    status: string
    createdAt: string
    sentAt: string | null
    purpose: string
    messageBody: string | null
    messageTemplate: string | null
    errorMessage: string | null
}

interface ActivityRecord {
    id: string
    sourceType: string
    sourceRecordId: string
    sourceKey: string
    createdAt: string
    recipientPhone: string
    eventType: string
    purpose: string
    status: string
    provider: string
    errorMessage: string
    userId: string | null
    providerMessageId: string | null
    messageTemplate: string | null
    messageBody: string | null
    contactName: string
    contactSource: string
    resolvedUserId: string | null
    resolvedOrganizationId: string | null
    suggestedTemplateKey: RecoveryPurpose
    suggestedTemplateName: string
    suggestedMessagePreview: string
    latestRecovery: RecoveryStatusInfo | null
}

interface Summary {
    kpis: {
        failed: number
        recoverySent: number
        delivered: number
        read: number
        resolved: number
    }
    trend: RecoveryTrendPoint[]
    hasActivityLast24h: boolean
    failedByPurpose: Record<string, number>
}

interface RecoveryTemplate {
    key: RecoveryPurpose
    name: string
    purpose: RecoveryPurpose
    body: string
    hint?: string
    variables?: string[]
    active: boolean
    updated_at: string
}

interface BulkActionState {
    label: string
    records: ActivityRecord[]
    templateKey?: RecoveryPurpose
}

const PURPOSE_LABELS: Record<string, string> = {
    password_reset: "Password Reset",
    registration_verification: "Registration",
    phone_verification: "Phone Verification",
    order_notification: "Order Notification",
    document_workflow: "Document Workflow",
    inventory_stock: "Inventory & Stock",
    qr_consumer: "QR Claim",
    user_account: "User Account",
    system: "System",
    recovery_notice: "System Restored",
    password_reset_recovery: "Password Reset Recovery",
    registration_recovery: "Registration Recovery",
    qr_claim_recovery: "QR Claim Recovery",
}

const PURPOSE_TONE: Record<string, string> = {
    password_reset: "bg-purple-50 text-purple-700",
    registration_verification: "bg-blue-50 text-blue-700",
    phone_verification: "bg-blue-50 text-blue-700",
    qr_consumer: "bg-orange-50 text-orange-700",
    recovery_notice: "bg-emerald-50 text-emerald-700",
    password_reset_recovery: "bg-emerald-50 text-emerald-700",
    registration_recovery: "bg-emerald-50 text-emerald-700",
    qr_claim_recovery: "bg-emerald-50 text-emerald-700",
}

function formatPurpose(value: string) {
    return PURPOSE_LABELS[value] || value.replace(/_/g, " ")
}

function normalizePhoneForSearch(value: string) {
    return String(value || "").replace(/\D/g, "")
}

function formatTime(value: string) {
    const dt = new Date(value)
    if (Number.isNaN(dt.getTime())) return "-"
    return dt.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
}

function formatDateAndTime(value: string) {
    const dt = new Date(value)
    if (Number.isNaN(dt.getTime())) {
        return { date: "-", time: "-" }
    }

    return {
        date: dt.toLocaleDateString(undefined, { dateStyle: "medium" }),
        time: dt.toLocaleTimeString(undefined, { timeStyle: "short" }),
    }
}

function formatPhoneLine(value: string) {
    const formatted = formatPhoneDisplay(value || "")
    return formatted || value || "-"
}

function buildUniqueTargets(records: ActivityRecord[], explicitTemplateKey?: RecoveryPurpose) {
    const unique = new Map<string, ActivityRecord>()

    for (const record of records) {
        if (!isFailedStatus(record.status) || !record.recipientPhone) continue
        const groupKey = `${normalizePhoneForSearch(record.recipientPhone)}:${explicitTemplateKey || record.suggestedTemplateKey}`
        const existing = unique.get(groupKey)
        if (!existing || new Date(record.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
            unique.set(groupKey, record)
        }
    }

    return Array.from(unique.values())
}

function KpiCard({
    tone,
    icon,
    label,
    value,
    hint,
}: {
    tone: "red" | "orange" | "blue" | "emerald" | "purple"
    icon: React.ReactNode
    label: string
    value: string | number
    hint?: string
}) {
    const map = {
        red: "bg-red-50 text-red-600 border-red-100",
        orange: "bg-orange-50 text-orange-600 border-orange-100",
        blue: "bg-blue-50 text-blue-600 border-blue-100",
        emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
        purple: "bg-purple-50 text-purple-600 border-purple-100",
    } as const

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${map[tone]}`}>{icon}</span>
                <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    <p className="mt-0.5 text-2xl font-bold leading-tight text-slate-900 tabular-nums">{value}</p>
                    {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
                </div>
            </div>
        </div>
    )
}

function StatusPill({ status }: { status: string }) {
    const tone = status === "recovery_sent" || status === "sent"
        ? "bg-emerald-100 text-emerald-800"
        : status === "delivered"
            ? "bg-blue-100 text-blue-800"
            : status === "read"
                ? "bg-cyan-100 text-cyan-800"
                : isFailedStatus(status)
                    ? "bg-red-100 text-red-800"
                    : isResolvedStatus(status)
                        ? "bg-emerald-100 text-emerald-800"
                        : status === "rate_limited"
                            ? "bg-orange-100 text-orange-800"
                            : "bg-slate-100 text-slate-700"

    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>
            {status.replace(/_/g, " ")}
        </span>
    )
}

export function WhatsAppRecoveryCenter({ userProfile: _userProfile }: Props) {
    const [summary, setSummary] = useState<Summary | null>(null)
    const [summaryLoading, setSummaryLoading] = useState(true)
    const [templates, setTemplates] = useState<RecoveryTemplate[]>([])
    const [allEvents, setAllEvents] = useState<ActivityRecord[]>([])
    const [eventsLoading, setEventsLoading] = useState(false)
    const [page, setPage] = useState(1)
    const pageSize = 10

    const [statusTab, setStatusTab] = useState<"all" | "failed" | "recovery_sent" | "delivered" | "read" | "resolved">("failed")
    const [filterPurpose, setFilterPurpose] = useState("all")
    const [filterStatus, setFilterStatus] = useState("all")
    const [filterProvider, setFilterProvider] = useState("all")
    const [filterSearch, setFilterSearch] = useState("")

    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [sendingRecordId, setSendingRecordId] = useState<string | null>(null)
    const [bulkSending, setBulkSending] = useState(false)
    const [confirmRecord, setConfirmRecord] = useState<ActivityRecord | null>(null)
    const [clearRecord, setClearRecord] = useState<ActivityRecord | null>(null)
    const [previewRecord, setPreviewRecord] = useState<ActivityRecord | null>(null)
    const [bulkAction, setBulkAction] = useState<BulkActionState | null>(null)
    const [customOpen, setCustomOpen] = useState(false)
    const [customMessage, setCustomMessage] = useState("")
    const [customTargetRecord, setCustomTargetRecord] = useState<ActivityRecord | null>(null)
    const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
    const [clearingRecordId, setClearingRecordId] = useState<string | null>(null)

    const [templateEditorOpen, setTemplateEditorOpen] = useState(false)
    const [editingTemplateKey, setEditingTemplateKey] = useState<RecoveryPurpose>("recovery_notice")
    const [editingTemplateBody, setEditingTemplateBody] = useState("")
    const [savingTemplate, setSavingTemplate] = useState(false)

    const [gatewayStatus, setGatewayStatus] = useState<{ connected: boolean; phone?: string | null; providerName?: string; providerKey?: string; providerType?: string; loading: boolean }>({
        connected: false,
        loading: true,
    })

    const loadSummary = useCallback(async () => {
        setSummaryLoading(true)
        try {
            const response = await fetch("/api/settings/notifications/whatsapp-recovery/summary")
            if (!response.ok) throw new Error("Failed to load summary")
            setSummary(await response.json())
        } catch (error) {
            console.error(error)
        } finally {
            setSummaryLoading(false)
        }
    }, [])

    const loadTemplates = useCallback(async () => {
        try {
            const response = await fetch("/api/settings/notifications/whatsapp-recovery/templates")
            if (!response.ok) throw new Error("Failed to load templates")
            const payload = await response.json()
            setTemplates(payload.templates || [])
        } catch (error) {
            console.error(error)
        }
    }, [])

    const loadGateway = useCallback(async () => {
        setGatewayStatus((state) => ({ ...state, loading: true }))
        try {
            const response = await fetch("/api/settings/whatsapp/status")
            if (response.ok) {
                const payload = await response.json()
                setGatewayStatus({ connected: !!payload.connected, phone: payload.phone_number, providerName: payload.provider_name, providerKey: payload.provider_key, providerType: payload.provider_type, loading: false })
            } else {
                setGatewayStatus({ connected: false, loading: false })
            }
        } catch {
            setGatewayStatus({ connected: false, loading: false })
        }
    }, [])

    const loadEvents = useCallback(async () => {
        setEventsLoading(true)
        try {
            const response = await fetch("/api/settings/notifications/whatsapp-recovery/records")
            if (!response.ok) throw new Error("Failed to load recovery records")
            const payload = await response.json()
            setAllEvents(payload.records || [])
        } catch (error) {
            console.error("loadEvents", error)
        } finally {
            setEventsLoading(false)
        }
    }, [])

    useEffect(() => {
        loadSummary()
        loadTemplates()
        loadGateway()
        loadEvents()
    }, [loadEvents, loadGateway, loadSummary, loadTemplates])

    const filtered = useMemo(() => {
        const search = normalizePhoneForSearch(filterSearch)
        return allEvents.filter((record) => {
            if (statusTab === "failed" && !isFailedStatus(record.status)) return false
            if (statusTab === "recovery_sent" && !(RECOVERY_PURPOSES.includes(record.purpose as RecoveryPurpose) && isRecoverySentStatus(record.status))) return false
            if (statusTab === "delivered" && record.status !== "delivered") return false
            if (statusTab === "read" && record.status !== "read") return false
            if (statusTab === "resolved" && !isResolvedStatus(record.status)) return false

            if (filterPurpose !== "all" && record.purpose !== filterPurpose) return false
            if (filterStatus !== "all" && record.status !== filterStatus) return false
            if (filterProvider !== "all" && record.provider !== filterProvider) return false

            if (!search && !filterSearch.trim()) return true

            const plainSearch = filterSearch.toLowerCase()
            return (
                normalizePhoneForSearch(record.recipientPhone).includes(search) ||
                record.contactName.toLowerCase().includes(plainSearch) ||
                record.contactSource.toLowerCase().includes(plainSearch) ||
                record.purpose.toLowerCase().includes(plainSearch) ||
                record.eventType.toLowerCase().includes(plainSearch)
            )
        })
    }, [allEvents, filterProvider, filterPurpose, filterSearch, filterStatus, statusTab])

    const total = filtered.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    useEffect(() => {
        setPage(1)
    }, [filterProvider, filterPurpose, filterSearch, filterStatus, statusTab])

    const pagedEvents = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page])

    const tabCounts = useMemo(() => ({
        all: allEvents.length,
        failed: allEvents.filter((record) => isFailedStatus(record.status)).length,
        recovery_sent: allEvents.filter((record) => RECOVERY_PURPOSES.includes(record.purpose as RecoveryPurpose) && isRecoverySentStatus(record.status)).length,
        delivered: allEvents.filter((record) => record.status === "delivered").length,
        read: allEvents.filter((record) => record.status === "read").length,
        resolved: allEvents.filter((record) => isResolvedStatus(record.status)).length,
    }), [allEvents])

    const selectedTargets = useMemo(
        () => buildUniqueTargets(allEvents.filter((record) => selected.has(record.id))),
        [allEvents, selected],
    )

    const allFailedTargets = useMemo(
        () => buildUniqueTargets(filtered.filter((record) => isFailedStatus(record.status))),
        [filtered],
    )

    const quickActions = useMemo(() => ([
        {
            label: "Notify All Failed Password Reset",
            key: "password_reset_recovery" as RecoveryPurpose,
            icon: <KeyRound className="h-3.5 w-3.5" />,
            records: buildUniqueTargets(allEvents.filter((record) => isFailedStatus(record.status) && record.purpose.toLowerCase().includes("password_reset")), "password_reset_recovery"),
        },
        {
            label: "Notify All Failed Registration",
            key: "registration_recovery" as RecoveryPurpose,
            icon: <UserPlus className="h-3.5 w-3.5" />,
            records: buildUniqueTargets(allEvents.filter((record) => isFailedStatus(record.status) && (record.purpose.toLowerCase().includes("registration") || record.purpose.toLowerCase().includes("phone_verification"))), "registration_recovery"),
        },
        {
            label: "Notify All Failed QR Claim",
            key: "qr_claim_recovery" as RecoveryPurpose,
            icon: <QrCode className="h-3.5 w-3.5" />,
            records: buildUniqueTargets(allEvents.filter((record) => isFailedStatus(record.status) && (record.purpose.toLowerCase().includes("qr") || record.purpose.toLowerCase().includes("claim"))), "qr_claim_recovery"),
        },
        {
            label: "Send System Restored Message",
            key: "recovery_notice" as RecoveryPurpose,
            icon: <Sparkles className="h-3.5 w-3.5" />,
            records: buildUniqueTargets(allEvents.filter((record) => isFailedStatus(record.status)), "recovery_notice"),
        },
    ]), [allEvents])

    const activeTemplate = useMemo(
        () => templates.find((template) => template.key === editingTemplateKey) || null,
        [editingTemplateKey, templates],
    )

    useEffect(() => {
        if (!templateEditorOpen) return
        const template = templates.find((item) => item.key === editingTemplateKey)
        if (template) setEditingTemplateBody(template.body)
    }, [editingTemplateKey, templateEditorOpen, templates])

    function showToast(kind: "ok" | "err", text: string) {
        setToast({ kind, text })
        window.setTimeout(() => setToast(null), 4000)
    }

    function toggleSelected(id: string) {
        setSelected((previous) => {
            const next = new Set(previous)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    function selectVisible(checked: boolean) {
        setSelected((previous) => {
            const next = new Set(previous)
            if (checked) {
                pagedEvents.forEach((record) => {
                    if (isFailedStatus(record.status)) next.add(record.id)
                })
            } else {
                pagedEvents.forEach((record) => next.delete(record.id))
            }
            return next
        })
    }

    function exportCsv() {
        const rows = [["created_at", "phone", "resolved_name", "resolved_source", "event_type", "purpose", "status", "provider", "error"]]
        filtered.forEach((record) => rows.push([
            record.createdAt,
            record.recipientPhone,
            record.contactName,
            record.contactSource,
            record.eventType,
            record.purpose,
            record.status,
            record.provider,
            record.errorMessage,
        ]))

        const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n")
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = `wa-recovery_${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        URL.revokeObjectURL(url)
    }

    function serializeRecord(record: ActivityRecord) {
        return {
            sourceType: record.sourceType,
            sourceRecordId: record.sourceRecordId,
            sourceKey: record.sourceKey,
            phone: record.recipientPhone,
            failedPurpose: record.purpose,
            failedAt: record.createdAt,
            provider: record.provider,
            userId: record.resolvedUserId || record.userId,
            resolvedName: record.contactName,
            resolvedSource: record.contactSource,
        }
    }

    async function clearFailedRecord(record: ActivityRecord) {
        const previousEvents = allEvents
        const previousSelected = new Set(selected)

        setClearingRecordId(record.id)
        setAllEvents((current) => current.filter((item) => item.id !== record.id))
        setSelected((current) => {
            const next = new Set(current)
            next.delete(record.id)
            return next
        })

        try {
            const response = await fetch("/api/settings/notifications/whatsapp-recovery/records/clear", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    sourceType: record.sourceType,
                    sourceRecordId: record.sourceRecordId,
                }),
            })

            const payload = await response.json()
            if (!response.ok) {
                throw new Error(payload.error || "Failed to clear WhatsApp activity")
            }

            showToast("ok", "Failed WhatsApp activity cleared")
            await Promise.all([loadSummary(), loadEvents()])
        } catch (error: any) {
            setAllEvents(previousEvents)
            setSelected(previousSelected)
            showToast("err", error?.message || "Failed to clear WhatsApp activity")
        } finally {
            setClearingRecordId(null)
        }
    }

    async function notifyOne(record: ActivityRecord, opts?: { customMessage?: string; allowResend?: boolean }) {
        setSendingRecordId(record.id)
        try {
            const response = await fetch("/api/settings/notifications/whatsapp-recovery/send", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    mode: "single",
                    record: serializeRecord(record),
                    templateKey: record.suggestedTemplateKey,
                    customMessage: opts?.customMessage,
                    allowResend: opts?.allowResend === true,
                }),
            })

            const payload = await response.json()
            if (!response.ok) {
                throw new Error(payload.error || "Failed to send recovery message")
            }

            if (payload.sent > 0) {
                showToast("ok", `Recovery message sent to ${formatPhoneLine(record.recipientPhone)}`)
            } else if (payload.skipped > 0) {
                showToast("ok", `Skipped duplicate recovery send for ${formatPhoneLine(record.recipientPhone)}`)
            } else {
                showToast("err", payload.error || "No recovery message was sent")
            }

            await Promise.all([loadSummary(), loadEvents()])
        } catch (error: any) {
            showToast("err", error?.message || "Network error")
        } finally {
            setSendingRecordId(null)
        }
    }

    async function notifyBulk(records: ActivityRecord[], opts?: { templateKey?: RecoveryPurpose; customMessage?: string; allowResend?: boolean }) {
        const uniqueTargets = buildUniqueTargets(records, opts?.templateKey)
        if (uniqueTargets.length === 0) return

        setBulkSending(true)
        try {
            const response = await fetch("/api/settings/notifications/whatsapp-recovery/send", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    mode: "bulk",
                    records: uniqueTargets.map(serializeRecord),
                    templateKey: opts?.templateKey,
                    customMessage: opts?.customMessage,
                    allowResend: opts?.allowResend === true,
                }),
            })

            const payload = await response.json()
            if (!response.ok) {
                throw new Error(payload.error || "Bulk recovery send failed")
            }

            showToast("ok", `Sent: ${payload.sent} • Skipped: ${payload.skipped} • Failed: ${payload.failed}`)
            setSelected(new Set())
            await Promise.all([loadSummary(), loadEvents()])
        } catch (error: any) {
            showToast("err", error?.message || "Network error")
        } finally {
            setBulkSending(false)
        }
    }

    async function saveTemplate() {
        setSavingTemplate(true)
        try {
            const response = await fetch("/api/settings/notifications/whatsapp-recovery/templates", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    key: editingTemplateKey,
                    body: editingTemplateBody,
                    isActive: true,
                }),
            })
            const payload = await response.json()
            if (!response.ok) {
                throw new Error(payload.error || "Failed to save template")
            }
            showToast("ok", `${payload.template?.name || "Template"} saved`)
            setTemplateEditorOpen(false)
            await Promise.all([loadTemplates(), loadEvents()])
        } catch (error: any) {
            showToast("err", error?.message || "Failed to save template")
        } finally {
            setSavingTemplate(false)
        }
    }

    function openTemplateEditor(template?: RecoveryTemplate | null) {
        const selectedTemplate = template || templates[0] || null
        if (!selectedTemplate) return
        setEditingTemplateKey(selectedTemplate.key)
        setEditingTemplateBody(selectedTemplate.body)
        setTemplateEditorOpen(true)
    }

    const bulkAlreadySentCount = useMemo(() => {
        if (!bulkAction) return 0
        return buildUniqueTargets(bulkAction.records, bulkAction.templateKey).filter((record) => isRecoverySentStatus(record.latestRecovery?.status)).length
    }, [bulkAction])

    const bulkUniqueCount = useMemo(() => {
        if (!bulkAction) return 0
        return buildUniqueTargets(bulkAction.records, bulkAction.templateKey).length
    }, [bulkAction])

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                        <MessageCircle className="h-5 w-5" />
                    </span>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">WhatsApp Activity & Recovery</h1>
                        <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
                            Monitor failed WhatsApp notifications, identify the affected contact, and send a safe recovery message once the service has been restored.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { loadSummary(); loadTemplates(); loadEvents(); loadGateway() }}>
                        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${summaryLoading || eventsLoading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                    <Button variant="outline" size="sm">
                        <BookOpen className="mr-1.5 h-3.5 w-3.5" />How it works?
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
                <div className="min-w-0 space-y-5">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
                        <KpiCard tone="red" icon={<AlertCircle className="h-4 w-4" />} label="Failed" value={summary?.kpis.failed ?? 0} hint="Last 24 hours" />
                        <KpiCard tone="orange" icon={<MailWarning className="h-4 w-4" />} label="Recovery Sent" value={summary?.kpis.recoverySent ?? 0} hint="Last 24 hours" />
                        <KpiCard tone="blue" icon={<Mail className="h-4 w-4" />} label="Delivered" value={summary?.kpis.delivered ?? 0} hint="If receipts are available" />
                        <KpiCard tone="emerald" icon={<Eye className="h-4 w-4" />} label="Read" value={summary?.kpis.read ?? 0} hint="If receipts are available" />
                        <KpiCard tone="purple" icon={<ShieldCheck className="h-4 w-4" />} label="Resolved" value={summary?.kpis.resolved ?? 0} hint="Resolved, verified, or completed" />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900">Delivery Trend (Last 24 Hours)</h3>
                                <p className="text-[11px] text-slate-500">Failed · Recovery Sent · Delivered · Read · Resolved</p>
                            </div>
                        </div>
                        <div className="h-[240px]">
                            {summary && summary.hasActivityLast24h ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={summary.trend} margin={{ top: 5, right: 12, left: -8, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={3} />
                                        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={28} />
                                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                        <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={1.5} dot={{ r: 2 }} name="Failed" />
                                        <Line type="monotone" dataKey="recoverySent" stroke="#f97316" strokeWidth={1.5} dot={{ r: 2 }} name="Recovery Sent" />
                                        <Line type="monotone" dataKey="delivered" stroke="#3b82f6" strokeWidth={1.5} dot={{ r: 2 }} name="Delivered" />
                                        <Line type="monotone" dataKey="read" stroke="#10b981" strokeWidth={1.5} dot={{ r: 2 }} name="Read" />
                                        <Line type="monotone" dataKey="resolved" stroke="#a855f7" strokeWidth={1.5} dot={{ r: 2 }} name="Resolved" />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex h-full items-center justify-center text-xs text-slate-400">No WhatsApp activity in the last 24 hours</div>
                            )}
                        </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative min-w-[220px] flex-1">
                                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                <Input
                                    placeholder="Search by phone number, contact name, source or purpose..."
                                    value={filterSearch}
                                    onChange={(event) => setFilterSearch(event.target.value)}
                                    className="h-9 pl-8"
                                />
                            </div>
                            <Select value={filterPurpose} onValueChange={setFilterPurpose}>
                                <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="All Purposes" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Purposes</SelectItem>
                                    <SelectItem value="password_reset">Password Reset</SelectItem>
                                    <SelectItem value="registration_verification">Registration</SelectItem>
                                    <SelectItem value="phone_verification">Phone Verification</SelectItem>
                                    <SelectItem value="qr_consumer">QR &amp; Consumer</SelectItem>
                                    <SelectItem value="recovery_notice">Recovery Notice</SelectItem>
                                    <SelectItem value="password_reset_recovery">Password Reset Recovery</SelectItem>
                                    <SelectItem value="registration_recovery">Registration Recovery</SelectItem>
                                    <SelectItem value="qr_claim_recovery">QR Claim Recovery</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={filterStatus} onValueChange={setFilterStatus}>
                                <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Statuses</SelectItem>
                                    <SelectItem value="failed">Failed</SelectItem>
                                    <SelectItem value="send_failed">Send Failed</SelectItem>
                                    <SelectItem value="recovery_sent">Recovery Sent</SelectItem>
                                    <SelectItem value="resolved">Resolved</SelectItem>
                                    <SelectItem value="sent">Sent</SelectItem>
                                    <SelectItem value="delivered">Delivered</SelectItem>
                                    <SelectItem value="read">Read</SelectItem>
                                    <SelectItem value="verified">Verified</SelectItem>
                                    <SelectItem value="completed">Completed</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={filterProvider} onValueChange={setFilterProvider}>
                                <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="All Providers" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Providers</SelectItem>
                                    <SelectItem value="baileys">Baileys</SelectItem>
                                    <SelectItem value="baileys_home">Baileys Home</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-9 text-slate-600"
                                onClick={() => {
                                    setFilterPurpose("all")
                                    setFilterStatus("all")
                                    setFilterProvider("all")
                                    setFilterSearch("")
                                }}
                            >
                                Clear
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                size="sm"
                                disabled={selectedTargets.length === 0}
                                className="bg-emerald-600 text-white hover:bg-emerald-700"
                                onClick={() => setBulkAction({ label: "Notify Selected", records: selectedTargets })}
                            >
                                <Send className="mr-1.5 h-3.5 w-3.5" />Notify Selected ({selectedTargets.length})
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="border-red-200 text-red-700 hover:bg-red-50"
                                disabled={allFailedTargets.length === 0}
                                onClick={() => setBulkAction({ label: "Notify All Failed", records: allFailedTargets })}
                            >
                                <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />Notify All Failed ({allFailedTargets.length})
                            </Button>
                            <Button size="sm" variant="outline" onClick={exportCsv}>
                                <Download className="mr-1.5 h-3.5 w-3.5" />Export
                            </Button>
                            <div className="ml-auto">
                                <Select defaultValue="latest">
                                    <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="latest">Sort by: Latest First</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-2">
                            {([
                                ["all", "All", tabCounts.all, "text-slate-700"],
                                ["failed", "Failed", tabCounts.failed, "text-red-600"],
                                ["recovery_sent", "Recovery Sent", tabCounts.recovery_sent, "text-orange-600"],
                                ["delivered", "Delivered", tabCounts.delivered, "text-blue-600"],
                                ["read", "Read", tabCounts.read, "text-emerald-600"],
                                ["resolved", "Resolved", tabCounts.resolved, "text-emerald-700"],
                            ] as const).map(([key, label, count, color]) => (
                                <button
                                    key={key}
                                    onClick={() => setStatusTab(key as typeof statusTab)}
                                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${statusTab === key ? "bg-slate-900 text-white" : `bg-slate-50 ${color} hover:bg-slate-100`}`}
                                >
                                    {label} <span className="ml-1 opacity-80">({count})</span>
                                </button>
                            ))}
                        </div>

                        {eventsLoading ? (
                            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
                                <Loader2 className="h-4 w-4 animate-spin" />Loading...
                            </div>
                        ) : pagedEvents.length === 0 ? (
                            <div className="py-10 text-center text-slate-400">
                                <ListChecks className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                                <p className="text-sm">No records in this view</p>
                                <p className="mt-0.5 text-xs">Try changing the tab or clearing filters.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-left">
                                            <th className="w-8 px-2 py-2">
                                                <input
                                                    type="checkbox"
                                                    onChange={(event) => selectVisible(event.target.checked)}
                                                    checked={pagedEvents.length > 0 && pagedEvents.filter((record) => isFailedStatus(record.status)).every((record) => selected.has(record.id))}
                                                />
                                            </th>
                                            <th className="w-6 px-2 py-2"></th>
                                            <th className="px-2 py-2 text-xs font-medium text-slate-500">Phone</th>
                                            <th className="px-2 py-2 text-xs font-medium text-slate-500">Date · Event</th>
                                            <th className="px-2 py-2 text-xs font-medium text-slate-500">Purpose</th>
                                            <th className="px-2 py-2 text-xs font-medium text-slate-500">Status</th>
                                            <th className="px-2 py-2 text-xs font-medium text-slate-500">Provider</th>
                                            <th className="px-2 py-2 text-right text-xs font-medium text-slate-500">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {pagedEvents.map((record) => {
                                            const isFailed = isFailedStatus(record.status)
                                            const alreadySent = isRecoverySentStatus(record.latestRecovery?.status)
                                            const dotTone = isFailed
                                                ? "bg-red-500"
                                                : isRecoverySentStatus(record.status)
                                                    ? "bg-emerald-500"
                                                    : record.status === "delivered"
                                                        ? "bg-blue-500"
                                                        : record.status === "read"
                                                            ? "bg-cyan-500"
                                                            : isResolvedStatus(record.status)
                                                                ? "bg-violet-500"
                                                                : "bg-slate-400"
                                            return (
                                                <tr key={record.id} className="hover:bg-slate-50/60">
                                                    <td className="px-2 py-2.5 align-top">
                                                        {isFailed ? <input type="checkbox" checked={selected.has(record.id)} onChange={() => toggleSelected(record.id)} /> : null}
                                                    </td>
                                                    <td className="px-2 py-2.5 align-top">
                                                        <span className={`mt-2 inline-block h-2 w-2 rounded-full ${dotTone}`} />
                                                    </td>
                                                    <td className="px-2 py-2.5 align-top">
                                                        <div className="text-xs font-mono text-slate-800">{formatPhoneLine(record.recipientPhone)}</div>
                                                        <div className="mt-0.5 text-xs font-medium text-slate-800">{record.contactName}</div>
                                                        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{record.contactSource}</div>
                                                    </td>
                                                    <td className="px-2 py-2.5 align-top text-xs text-slate-600">
                                                        <div>{formatTime(record.createdAt)}</div>
                                                        <div className="text-slate-400">{record.eventType.replace(/_/g, " ") || "-"}</div>
                                                    </td>
                                                    <td className="px-2 py-2.5 align-top">
                                                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${PURPOSE_TONE[record.purpose] || "bg-slate-100 text-slate-700"}`}>
                                                            {formatPurpose(record.purpose)}
                                                        </span>
                                                    </td>
                                                    <td className="px-2 py-2.5 align-top">
                                                        <StatusPill status={record.status} />
                                                        {record.latestRecovery && isFailed ? (
                                                            <div className={`mt-1 text-[10px] ${isRecoverySentStatus(record.latestRecovery.status) ? "text-emerald-600" : "text-red-500"}`}>
                                                                {isRecoverySentStatus(record.latestRecovery.status) ? "Recovery sent" : "Recovery failed"} {formatTime(record.latestRecovery.sentAt || record.latestRecovery.createdAt)}
                                                            </div>
                                                        ) : null}
                                                        {isFailed && record.errorMessage ? (
                                                            <div className="mt-0.5 max-w-[180px] truncate text-[10px] text-red-500" title={record.errorMessage}>
                                                                {record.errorMessage}
                                                            </div>
                                                        ) : null}
                                                    </td>
                                                    <td className="px-2 py-2.5 align-top text-xs text-slate-500">{record.provider || "-"}</td>
                                                    <td className="px-2 py-2.5 text-right align-top whitespace-nowrap">
                                                        {isFailed && record.recipientPhone ? (
                                                            <div className="inline-flex items-center gap-1">
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 border-emerald-200 text-xs text-emerald-700 hover:bg-emerald-50"
                                                                    disabled={sendingRecordId === record.id}
                                                                    onClick={() => setConfirmRecord(record)}
                                                                >
                                                                    {sendingRecordId === record.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                                                                    {alreadySent ? "Resend" : "Notify User"}
                                                                </Button>
                                                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPreviewRecord(record)}>
                                                                    <FileText className="h-3.5 w-3.5 text-slate-500" />
                                                                </Button>
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-7 w-7"
                                                                    onClick={() => {
                                                                        setCustomTargetRecord(record)
                                                                        setCustomMessage(record.suggestedMessagePreview)
                                                                        setCustomOpen(true)
                                                                    }}
                                                                >
                                                                    <Plus className="h-3.5 w-3.5 text-slate-500" />
                                                                </Button>
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                                                                    disabled={clearingRecordId === record.id}
                                                                    onClick={() => setClearRecord(record)}
                                                                    title="Clear failed activity"
                                                                >
                                                                    {clearingRecordId === record.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                                                </Button>
                                                            </div>
                                                        ) : (
                                                            <div className="inline-flex items-center gap-1">
                                                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPreviewRecord(record)}>
                                                                    <FileText className="h-3.5 w-3.5 text-slate-500" />
                                                                </Button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {total > 0 ? (
                            <div className="flex items-center justify-between pt-2">
                                <p className="text-xs text-slate-500">
                                    Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} results
                                </p>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
                                    <span className="text-xs text-slate-700">Page {page} of {totalPages}</span>
                                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                <aside className="self-start space-y-4 xl:sticky xl:top-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-slate-900">Gateway Status</h3>
                            <Badge variant="outline" className={gatewayStatus.connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}>
                                {gatewayStatus.connected ? "Healthy" : "Offline"}
                            </Badge>
                        </div>
                        <div className="mb-3 flex items-start gap-3">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                                {gatewayStatus.connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                            </span>
                            <div>
                                <p className="text-sm font-medium text-slate-900">{gatewayStatus.providerName || "No default provider"}</p>
                                {gatewayStatus.providerType ? <p className="text-[11px] text-slate-400">{gatewayStatus.providerType}</p> : null}
                                <p className="text-xs text-slate-500">{gatewayStatus.connected ? "Connected" : "Disconnected"}</p>
                                {gatewayStatus.phone ? <p className="mt-0.5 text-[11px] text-slate-500">{gatewayStatus.phone}</p> : null}
                            </div>
                        </div>
                        <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between"><span className="text-slate-500">Failed (24h)</span><span className="font-medium text-slate-900">{summary?.kpis.failed ?? 0}</span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Recovery Sent (24h)</span><span className="font-medium text-slate-900">{summary?.kpis.recoverySent ?? 0}</span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Delivered (24h)</span><span className="font-medium text-slate-900">{summary?.kpis.delivered ?? 0}</span></div>
                        </div>
                        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => { if (gatewayStatus.providerKey) setFilterProvider(gatewayStatus.providerKey); loadGateway() }}>
                            <Activity className="mr-1.5 h-3.5 w-3.5" />View Gateway Logs
                        </Button>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <h3 className="mb-3 text-sm font-semibold text-slate-900">Quick Actions</h3>
                        <div className="space-y-1.5">
                            {quickActions.map((action) => (
                                <button
                                    key={action.key}
                                    disabled={action.records.length === 0}
                                    className="flex w-full items-center justify-between rounded-md border border-slate-100 px-2 py-2 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={() => setBulkAction({ label: action.label, records: action.records, templateKey: action.key })}
                                >
                                    <span className="flex items-center gap-2 text-slate-700">{action.icon}{action.label}</span>
                                    <span className="text-slate-400">{action.records.length}</span>
                                </button>
                            ))}
                            <button
                                className="flex w-full items-center justify-between rounded-md border border-slate-100 px-2 py-2 text-xs hover:bg-slate-50"
                                onClick={() => {
                                    setCustomTargetRecord(null)
                                    setCustomMessage("")
                                    setCustomOpen(true)
                                }}
                            >
                                <span className="flex items-center gap-2 text-slate-700"><FileText className="h-3.5 w-3.5" />Custom Recovery Message</span>
                                <Plus className="h-3.5 w-3.5 text-slate-400" />
                            </button>
                        </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-slate-900">Recovery Templates</h3>
                            <button className="text-xs text-blue-600 hover:text-blue-700" onClick={() => openTemplateEditor(templates[0] || null)}>View All</button>
                        </div>
                        <div className="space-y-2">
                            {templates.slice(0, 4).map((template) => (
                                <button
                                    key={template.key}
                                    className="w-full rounded-md border border-slate-100 px-2.5 py-2 text-left hover:bg-slate-50"
                                    onClick={() => openTemplateEditor(template)}
                                >
                                    <p className="text-xs font-medium text-slate-900">{template.name}</p>
                                    <p className="truncate text-[10px] text-slate-500">{template.hint || template.body.slice(0, 60)}</p>
                                </button>
                            ))}
                        </div>
                        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => openTemplateEditor(templates[0] || null)}>
                            <Plus className="mr-1.5 h-3.5 w-3.5" />Create New Template
                        </Button>
                        <p className="mt-2 text-[10px] leading-snug text-slate-400">
                            Templates are stored in the existing message template table and support variables such as greeting, date, time and app name.
                        </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="mb-2 text-xs text-slate-600">Need Help?</p>
                        <p className="mb-3 text-[11px] text-slate-500">Recovery notifications are after-service messages only. They do not resend OTP codes or password reset links.</p>
                        <Button variant="outline" size="sm" className="w-full">
                            <BookOpen className="mr-1.5 h-3.5 w-3.5" />View Guide
                        </Button>
                    </div>
                </aside>
            </div>

            <Dialog open={!!confirmRecord} onOpenChange={(open) => !open && setConfirmRecord(null)}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{confirmRecord && isRecoverySentStatus(confirmRecord.latestRecovery?.status) ? "Resend recovery message" : "Notify User"}</DialogTitle>
                        <DialogDescription>
                            This sends a recovery/support message only. It does not resend any OTP or password reset link.
                        </DialogDescription>
                    </DialogHeader>
                    {confirmRecord ? (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Recipient</p>
                                    <p className="mt-1 font-medium text-slate-900">{confirmRecord.contactName}</p>
                                    <p className="text-xs text-slate-500">{formatPhoneLine(confirmRecord.recipientPhone)} · {confirmRecord.contactSource}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Purpose</p>
                                    <p className="mt-1 text-slate-900">{formatPurpose(confirmRecord.purpose)}</p>
                                    <p className="text-xs text-slate-500">{confirmRecord.suggestedTemplateName}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Original failed event</p>
                                    <p className="mt-1 text-slate-900">{formatDateAndTime(confirmRecord.createdAt).date}</p>
                                    <p className="text-xs text-slate-500">{formatDateAndTime(confirmRecord.createdAt).time}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Provider</p>
                                    <p className="mt-1 text-slate-900">{confirmRecord.provider || "-"}</p>
                                    {confirmRecord.latestRecovery ? <p className="text-xs text-slate-500">Last recovery: {formatTime(confirmRecord.latestRecovery.sentAt || confirmRecord.latestRecovery.createdAt)}</p> : null}
                                </div>
                            </div>
                            {confirmRecord.latestRecovery ? (
                                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                    A recovery notification has already been logged for this failed event. Sending again will create a new audit entry.
                                </div>
                            ) : null}
                            <div className="rounded-md bg-slate-50 p-3 text-xs whitespace-pre-wrap text-slate-700">
                                <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Message preview</p>
                                {confirmRecord.suggestedMessagePreview}
                            </div>
                        </div>
                    ) : null}
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setConfirmRecord(null)}>Cancel</Button>
                        <Button
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                            disabled={!confirmRecord || sendingRecordId === confirmRecord.id}
                            onClick={async () => {
                                if (!confirmRecord) return
                                const record = confirmRecord
                                setConfirmRecord(null)
                                await notifyOne(record, { allowResend: isRecoverySentStatus(record.latestRecovery?.status) })
                            }}
                        >
                            {confirmRecord && sendingRecordId === confirmRecord.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                            {confirmRecord && isRecoverySentStatus(confirmRecord.latestRecovery?.status) ? "Resend" : "Send"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!clearRecord} onOpenChange={(open) => !open && !clearingRecordId && setClearRecord(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Clear failed WhatsApp activity?</DialogTitle>
                        <DialogDescription>
                            This will remove the selected failed notification from the monitoring list. This action should only be used when the record no longer needs recovery monitoring.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" disabled={!!clearingRecordId} onClick={() => setClearRecord(null)}>Cancel</Button>
                        <Button
                            className="bg-red-600 text-white hover:bg-red-700"
                            disabled={!clearRecord || !!clearingRecordId}
                            onClick={async () => {
                                if (!clearRecord) return
                                const record = clearRecord
                                setClearRecord(null)
                                await clearFailedRecord(record)
                            }}
                        >
                            {clearingRecordId ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                            Clear
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!previewRecord} onOpenChange={(open) => !open && setPreviewRecord(null)}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Message Preview &amp; Log</DialogTitle>
                        <DialogDescription>
                            Review the recipient, suggested recovery text and the latest logged recovery attempt for this row.
                        </DialogDescription>
                    </DialogHeader>
                    {previewRecord ? (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Recipient</p>
                                    <p className="mt-1 font-medium text-slate-900">{previewRecord.contactName}</p>
                                    <p className="text-xs text-slate-500">{formatPhoneLine(previewRecord.recipientPhone)} · {previewRecord.contactSource}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Purpose</p>
                                    <p className="mt-1 text-slate-900">{formatPurpose(previewRecord.purpose)}</p>
                                    <p className="text-xs text-slate-500">{previewRecord.suggestedTemplateName}</p>
                                </div>
                            </div>
                            <div className="rounded-md bg-slate-50 p-3 text-xs whitespace-pre-wrap text-slate-700">
                                <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Preview</p>
                                {previewRecord.messageBody || previewRecord.latestRecovery?.messageBody || previewRecord.suggestedMessagePreview}
                            </div>
                            {previewRecord.latestRecovery ? (
                                <div className="rounded-md border border-slate-200 p-3 text-xs text-slate-700">
                                    <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-400">Latest recovery log</p>
                                    <div className="space-y-1">
                                        <div className="flex justify-between"><span>Status</span><span>{previewRecord.latestRecovery.status.replace(/_/g, " ")}</span></div>
                                        <div className="flex justify-between"><span>Logged at</span><span>{formatTime(previewRecord.latestRecovery.sentAt || previewRecord.latestRecovery.createdAt)}</span></div>
                                        <div className="flex justify-between"><span>Template</span><span>{previewRecord.latestRecovery.messageTemplate || previewRecord.suggestedTemplateKey}</span></div>
                                        {previewRecord.latestRecovery.errorMessage ? <div className="text-red-600">{previewRecord.latestRecovery.errorMessage}</div> : null}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setPreviewRecord(null)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!bulkAction} onOpenChange={(open) => !open && setBulkAction(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{bulkAction?.label}</DialogTitle>
                        <DialogDescription>
                            You are about to send a recovery notification to <span className="font-semibold">{bulkUniqueCount}</span> unique recipient{bulkUniqueCount === 1 ? "" : "s"}.
                            {bulkAlreadySentCount > 0 ? <><br /><br />{bulkAlreadySentCount} of them already have a recovery notification and will be skipped unless you choose to resend.</> : null}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setBulkAction(null)}>Cancel</Button>
                        <Button
                            variant="outline"
                            disabled={!bulkAction || bulkSending || bulkUniqueCount - bulkAlreadySentCount <= 0}
                            onClick={async () => {
                                if (!bulkAction) return
                                const action = bulkAction
                                setBulkAction(null)
                                await notifyBulk(action.records, { templateKey: action.templateKey, allowResend: false })
                            }}
                        >
                            {bulkSending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                            Send Eligible ({Math.max(0, bulkUniqueCount - bulkAlreadySentCount)})
                        </Button>
                        <Button
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                            disabled={!bulkAction || bulkSending}
                            onClick={async () => {
                                if (!bulkAction) return
                                const action = bulkAction
                                setBulkAction(null)
                                await notifyBulk(action.records, { templateKey: action.templateKey, allowResend: true })
                            }}
                        >
                            {bulkSending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                            {bulkAlreadySentCount > 0 ? `Resend All (${bulkUniqueCount})` : `Send All (${bulkUniqueCount})`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={customOpen} onOpenChange={setCustomOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Custom Recovery Message</DialogTitle>
                        <DialogDescription>
                            {customTargetRecord ? <>To <span className="font-mono">{formatPhoneLine(customTargetRecord.recipientPhone)}</span> ({customTargetRecord.contactName})</> : <>Send to the selected or filtered failed recipients.</>}
                            This sends a one-off recovery message only.
                        </DialogDescription>
                    </DialogHeader>
                    <textarea
                        className="h-40 w-full rounded-md border border-slate-200 p-2 text-sm"
                        placeholder="Type your message..."
                        value={customMessage}
                        onChange={(event) => setCustomMessage(event.target.value)}
                    />
                    <div className="rounded-md bg-slate-50 p-3 text-xs whitespace-pre-wrap text-slate-600">
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Preview</p>
                        {customMessage || "(empty)"}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCustomOpen(false)}>Cancel</Button>
                        <Button
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                            disabled={!customMessage.trim()}
                            onClick={async () => {
                                const message = customMessage.trim()
                                setCustomOpen(false)
                                if (customTargetRecord) {
                                    await notifyOne(customTargetRecord, {
                                        customMessage: message,
                                        allowResend: isRecoverySentStatus(customTargetRecord.latestRecovery?.status),
                                    })
                                } else if (selectedTargets.length > 0) {
                                    await notifyBulk(selectedTargets, { customMessage: message, allowResend: false })
                                } else if (allFailedTargets.length > 0) {
                                    await notifyBulk(allFailedTargets, { customMessage: message, allowResend: false })
                                }
                                setCustomTargetRecord(null)
                                setCustomMessage("")
                            }}
                        >
                            <Send className="mr-1.5 h-3.5 w-3.5" />Send
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={templateEditorOpen} onOpenChange={setTemplateEditorOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Recovery Template Manager</DialogTitle>
                        <DialogDescription>
                            Save an org-specific recovery template. Supported variables: {activeTemplate?.variables?.join(", ") || "greeting, date, time, app_name"}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-medium text-slate-700">Template</label>
                            <Select
                                value={editingTemplateKey}
                                onValueChange={(value) => {
                                    const key = value as RecoveryPurpose
                                    setEditingTemplateKey(key)
                                    const template = templates.find((item) => item.key === key)
                                    setEditingTemplateBody(template?.body || "")
                                }}
                            >
                                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {templates.map((template) => (
                                        <SelectItem key={template.key} value={template.key}>{template.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-700">Body</label>
                            <textarea
                                className="mt-1 h-52 w-full rounded-md border border-slate-200 p-3 text-sm"
                                value={editingTemplateBody}
                                onChange={(event) => setEditingTemplateBody(event.target.value)}
                            />
                        </div>
                        <div className="rounded-md bg-slate-50 p-3 text-xs whitespace-pre-wrap text-slate-600">
                            <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Current preview</p>
                            {editingTemplateBody}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setTemplateEditorOpen(false)}>Cancel</Button>
                        <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={savingTemplate || !editingTemplateBody.trim()} onClick={saveTemplate}>
                            {savingTemplate ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}Save Template
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {toast ? (
                <div className={`fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg ${toast.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
                    <div className="flex items-center gap-2">
                        {toast.kind === "ok" ? <CheckCheck className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                        {toast.text}
                    </div>
                </div>
            ) : null}
        </div>
    )
}

export default WhatsAppRecoveryCenter
