"use client"

/**
 * WhatsApp Recovery Operations Center
 *
 * Replaces the raw WhatsAppActivityTab with an actionable recovery hub:
 *   - KPI cards (Failed Today / Recovery Sent / Delivered / Read / Resolved)
 *   - 24-hour delivery & recovery trend chart
 *   - Right sidebar: Gateway Status / Quick Actions / Recovery Templates
 *   - Recovery queue table with bulk selection
 *   - Per-row & bulk "Notify User" actions (sends recovery message via Baileys)
 *   - Custom recovery message modal with preview
 *
 * Backed by:
 *   GET  /api/settings/notifications/whatsapp-recovery/summary
 *   GET  /api/settings/notifications/whatsapp-recovery/send  (templates)
 *   POST /api/settings/notifications/whatsapp-recovery/send  (single/bulk)
 *   GET  /api/settings/whatsapp/status (gateway status)
 *
 * Does NOT resend expired OTPs. Recovery messages are notifications only.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
    AlertCircle, MessageCircle, CheckCircle2, BookOpen, Send, Plus, MailWarning,
    Activity, Eye, Mail, RefreshCw, Search, Download, Loader2, ListChecks,
    AlertTriangle, Smartphone, FileText, Sparkles, KeyRound, UserPlus, QrCode,
    CheckCheck, MoreHorizontal, ShieldCheck, Clock, Wifi, WifiOff,
} from "lucide-react"
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts"
import type { UserProfileWithRelations } from "@/lib/server/get-user-profile"

interface Props { userProfile: UserProfileWithRelations }

interface ActivityRecord {
    id: string
    createdAt: string
    recipientPhone: string
    eventType: string
    purpose: string
    status: string
    provider: string
    errorMessage: string
}

interface Summary {
    kpis: { failedToday: number; recoverySent: number; delivered: number; read: number; resolved: number }
    trend: { hour: string; failed: number; recoverySent: number; delivered: number; read: number }[]
    failedByPurpose: Record<string, number>
}

interface RecoveryTemplate {
    key: string
    name: string
    purpose: string
    body: string
    hint?: string
    active: boolean
    updated_at: string
}

const PURPOSE_LABELS: Record<string, string> = {
    password_reset: "Password Reset",
    registration_verification: "Registration",
    phone_verification: "Phone Verification",
    order_notification: "Order Notification",
    document_workflow: "Document Workflow",
    inventory_stock: "Inventory & Stock",
    qr_consumer: "QR & Consumer",
    user_account: "User Account",
    system: "System",
    recovery_notice: "Recovery Notice",
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

function parseProviderResponse(value: unknown): Record<string, any> | null {
    if (!value) return null
    if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>
    if (typeof value === "string") { try { return JSON.parse(value) } catch { return null } }
    return null
}

function resolveLogRecipientPhone(recipient: unknown, providerResponse: unknown) {
    const direct = String(recipient || "").trim()
    if (direct && direct.toLowerCase() !== "unknown") return direct
    const resp = parseProviderResponse(providerResponse)
    const gw = String(resp?.to || resp?.jid || "").trim()
    return gw.replace(/@s\.whatsapp\.net$/i, "").replace(/^\+/, "")
}

function formatTime(iso: string) {
    const d = new Date(iso); if (isNaN(d.getTime())) return "—"
    return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
}

// ──────────────────────── KPI Card ────────────────────────
function KpiCard({ tone, icon, label, value, hint }: {
    tone: "red" | "orange" | "blue" | "emerald" | "purple"
    icon: React.ReactNode; label: string; value: string | number; hint?: string
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
                    <p className="text-2xl font-bold text-slate-900 tabular-nums leading-tight mt-0.5">{value}</p>
                    {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
                </div>
            </div>
        </div>
    )
}

// ──────────────────────── Status badge ─────────────────────
function StatusPill({ status }: { status: string }) {
    const tone = status === "sent" ? "bg-green-100 text-green-800" :
        status === "delivered" ? "bg-emerald-100 text-emerald-800" :
            status === "read" ? "bg-blue-100 text-blue-800" :
                status === "failed" || status === "send_failed" ? "bg-red-100 text-red-800" :
                    status === "verified" || status === "completed" || status === "resolved" ? "bg-emerald-100 text-emerald-800" :
                        status === "rate_limited" ? "bg-orange-100 text-orange-800" :
                            "bg-slate-100 text-slate-700"
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${tone}`}>{status}</span>
}

// ───────────────────── Main ─────────────────────────────────
export function WhatsAppRecoveryCenter({ userProfile }: Props) {
    const [summary, setSummary] = useState<Summary | null>(null)
    const [summaryLoading, setSummaryLoading] = useState(true)
    const [templates, setTemplates] = useState<RecoveryTemplate[]>([])

    const [events, setEvents] = useState<ActivityRecord[]>([])
    const [allEvents, setAllEvents] = useState<ActivityRecord[]>([])
    const [eventsLoading, setEventsLoading] = useState(false)
    const [page, setPage] = useState(1)
    const [pageSize] = useState(10)

    const [statusTab, setStatusTab] = useState<"all" | "failed" | "recovery_sent" | "delivered" | "read" | "resolved">("failed")
    const [filterPurpose, setFilterPurpose] = useState("all")
    const [filterStatus, setFilterStatus] = useState("all")
    const [filterProvider, setFilterProvider] = useState("all")
    const [filterSearch, setFilterSearch] = useState("")

    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [sendingPhone, setSendingPhone] = useState<string | null>(null)
    const [confirmBulk, setConfirmBulk] = useState(false)
    const [customOpen, setCustomOpen] = useState(false)
    const [customMessage, setCustomMessage] = useState("")
    const [customTargetPhone, setCustomTargetPhone] = useState<string | null>(null)
    const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

    const [gatewayStatus, setGatewayStatus] = useState<{ connected: boolean; phone?: string | null; loading: boolean }>({
        connected: false, loading: true,
    })

    const supabase = createClient()

    // ── data loading ──
    const loadSummary = useCallback(async () => {
        setSummaryLoading(true)
        try {
            const r = await fetch("/api/settings/notifications/whatsapp-recovery/summary")
            if (r.ok) setSummary(await r.json())
        } catch (e) { console.error(e) } finally { setSummaryLoading(false) }
    }, [])

    const loadTemplates = useCallback(async () => {
        try {
            const r = await fetch("/api/settings/notifications/whatsapp-recovery/send", { method: "GET" })
            if (r.ok) {
                const d = await r.json(); setTemplates(d.templates || [])
            }
        } catch (e) { console.error(e) }
    }, [])

    const loadGateway = useCallback(async () => {
        setGatewayStatus(s => ({ ...s, loading: true }))
        try {
            const r = await fetch("/api/settings/whatsapp/status")
            if (r.ok) {
                const d = await r.json()
                setGatewayStatus({ connected: !!d.connected, phone: d.phone_number, loading: false })
            } else {
                setGatewayStatus({ connected: false, loading: false })
            }
        } catch { setGatewayStatus({ connected: false, loading: false }) }
    }, [])

    const loadEvents = useCallback(async () => {
        setEventsLoading(true)
        try {
            const orgId = (userProfile as any)?.organization_id || (userProfile as any)?.organizations?.id || null
            const [eventsResult, logsResult] = await Promise.all([
                (supabase as any).from("notification_events")
                    .select("id, created_at, status, recipient_phone, event_type, purpose, provider, error_message")
                    .eq("channel", "whatsapp")
                    .order("created_at", { ascending: false }).limit(500),
                orgId ? (supabase as any).from("notification_logs")
                    .select("id, created_at, sent_at, delivered_at, failed_at, status, recipient_value, event_code, provider_name, error_message, provider_response")
                    .eq("channel", "whatsapp").eq("org_id", orgId)
                    .order("created_at", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
            ])
            const ev: ActivityRecord[] = (eventsResult.data || []).map((e: any) => ({
                id: `event-${e.id}`,
                createdAt: e.created_at,
                recipientPhone: String(e.recipient_phone || "").trim(),
                eventType: String(e.event_type || ""),
                purpose: String(e.purpose || "system"),
                status: String(e.status || "unknown"),
                provider: String(e.provider || ""),
                errorMessage: String(e.error_message || ""),
            }))
            const lg: ActivityRecord[] = (logsResult.data || []).map((l: any) => ({
                id: `log-${l.id}`,
                createdAt: l.sent_at || l.delivered_at || l.failed_at || l.created_at,
                recipientPhone: resolveLogRecipientPhone(l.recipient_value, l.provider_response),
                eventType: String(l.event_code || ""),
                purpose: "system",
                status: String(l.status || "unknown"),
                provider: String(l.provider_name || ""),
                errorMessage: String(l.error_message || ""),
            }))
            const merged = [...lg, ...ev].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            setAllEvents(merged)
        } catch (e) {
            console.error("loadEvents", e)
        } finally { setEventsLoading(false) }
    }, [supabase, userProfile])

    useEffect(() => {
        loadSummary(); loadTemplates(); loadGateway(); loadEvents() // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── filters ──
    const filtered = useMemo(() => {
        const s = normalizePhoneForSearch(filterSearch)
        const RECOVERY_PURPOSES = ["recovery_notice", "password_reset_recovery", "registration_recovery", "qr_claim_recovery"]
        return allEvents.filter(e => {
            // Tab filter
            if (statusTab === "failed" && !(e.status === "failed" || e.status === "send_failed")) return false
            if (statusTab === "recovery_sent" && !(RECOVERY_PURPOSES.includes(e.purpose) && e.status === "sent")) return false
            if (statusTab === "delivered" && e.status !== "delivered") return false
            if (statusTab === "read" && e.status !== "read") return false
            if (statusTab === "resolved" && !(e.status === "verified" || e.status === "completed")) return false
            // Filters
            if (filterPurpose !== "all" && e.purpose !== filterPurpose) return false
            if (filterStatus !== "all" && e.status !== filterStatus) return false
            if (filterProvider !== "all" && e.provider !== filterProvider) return false
            if (s && !normalizePhoneForSearch(e.recipientPhone).includes(s)
                && !e.purpose.toLowerCase().includes(filterSearch.toLowerCase())
                && !e.eventType.toLowerCase().includes(filterSearch.toLowerCase())) return false
            return true
        })
    }, [allEvents, statusTab, filterPurpose, filterStatus, filterProvider, filterSearch])

    const total = filtered.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    useEffect(() => { setPage(1) }, [statusTab, filterPurpose, filterStatus, filterProvider, filterSearch])
    useEffect(() => { setEvents(filtered.slice((page - 1) * pageSize, page * pageSize)) }, [filtered, page, pageSize])

    // ── tab counts ──
    const tabCounts = useMemo(() => {
        const RECOVERY_PURPOSES = ["recovery_notice", "password_reset_recovery", "registration_recovery", "qr_claim_recovery"]
        return {
            all: allEvents.length,
            failed: allEvents.filter(e => e.status === "failed" || e.status === "send_failed").length,
            recovery_sent: allEvents.filter(e => RECOVERY_PURPOSES.includes(e.purpose) && e.status === "sent").length,
            delivered: allEvents.filter(e => e.status === "delivered").length,
            read: allEvents.filter(e => e.status === "read").length,
            resolved: allEvents.filter(e => e.status === "verified" || e.status === "completed").length,
        }
    }, [allEvents])

    // ── actions ──
    function showToast(kind: "ok" | "err", text: string) {
        setToast({ kind, text }); setTimeout(() => setToast(null), 4000)
    }

    async function notifyOne(phone: string, failedPurpose: string, opts?: { customMessage?: string; templateKey?: string }) {
        setSendingPhone(phone)
        try {
            const r = await fetch("/api/settings/notifications/whatsapp-recovery/send", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ mode: "single", phone, failedPurpose, ...opts }),
            })
            const d = await r.json()
            if (r.ok && d.sent > 0) {
                showToast("ok", `Recovery message sent to ${phone}`)
                loadSummary(); loadEvents()
            } else {
                showToast("err", d.error || "Failed to send recovery message")
            }
        } catch (e: any) { showToast("err", e?.message || "Network error") }
        finally { setSendingPhone(null) }
    }

    async function notifyBulk(phones: string[], opts?: { templateKey?: string; customMessage?: string; filterPurpose?: string }) {
        if (phones.length === 0) return
        try {
            const r = await fetch("/api/settings/notifications/whatsapp-recovery/send", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ mode: "bulk", phones, ...opts }),
            })
            const d = await r.json()
            if (r.ok) {
                showToast("ok", `Sent: ${d.sent} • Skipped (dedupe): ${d.skipped} • Failed: ${d.failed}`)
                setSelected(new Set()); loadSummary(); loadEvents()
            } else {
                showToast("err", d.error || "Bulk send failed")
            }
        } catch (e: any) { showToast("err", e?.message || "Network error") }
    }

    function toggleSelected(id: string) {
        setSelected(prev => {
            const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
        })
    }

    function selectVisible(checked: boolean) {
        setSelected(prev => {
            const n = new Set(prev)
            if (checked) events.forEach(e => { if (e.recipientPhone) n.add(e.id) })
            else events.forEach(e => n.delete(e.id))
            return n
        })
    }

    function exportCsv() {
        const rows = [["created_at", "phone", "event_type", "purpose", "status", "provider", "error"]]
        filtered.forEach(e => rows.push([
            e.createdAt, e.recipientPhone, e.eventType, e.purpose, e.status, e.provider, e.errorMessage,
        ]))
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a"); a.href = url
        a.download = `wa-recovery_${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
    }

    // ── Quick action helpers ──
    function failedPhonesByPurpose(purposeMatch: (p: string) => boolean): string[] {
        const seen = new Set<string>()
        for (const e of allEvents) {
            if (!(e.status === "failed" || e.status === "send_failed")) continue
            if (!purposeMatch(e.purpose) && !purposeMatch(e.eventType)) continue
            const p = normalizePhoneForSearch(e.recipientPhone)
            if (p) seen.add(p)
        }
        return Array.from(seen)
    }

    const quickActions = [
        { label: "Notify All Failed Password Reset", key: "password_reset_recovery", match: (p: string) => p.includes("password_reset"), icon: <KeyRound className="h-3.5 w-3.5" /> },
        { label: "Notify All Failed Registration", key: "registration_recovery", match: (p: string) => p.includes("registration") || p.includes("phone_verification"), icon: <UserPlus className="h-3.5 w-3.5" /> },
        { label: "Notify All Failed QR Claim", key: "qr_claim_recovery", match: (p: string) => p.includes("qr") || p.includes("claim"), icon: <QrCode className="h-3.5 w-3.5" /> },
        { label: "Send System Restored Message", key: "recovery_notice", match: () => true, icon: <Sparkles className="h-3.5 w-3.5" /> },
    ]
    const [pendingQuickAction, setPendingQuickAction] = useState<{ label: string; templateKey: string; phones: string[] } | null>(null)

    // ── selected phones (for bulk action) ──
    const selectedPhones = useMemo(() => {
        const m = new Map<string, string>() // id -> phone
        for (const e of allEvents) if (selected.has(e.id) && e.recipientPhone) m.set(e.id, normalizePhoneForSearch(e.recipientPhone))
        return Array.from(new Set(m.values()))
    }, [selected, allEvents])

    // ── All failed phones (filtered) ──
    const allFailedPhones = useMemo(() => {
        const seen = new Set<string>()
        for (const e of filtered) {
            if (e.status === "failed" || e.status === "send_failed") {
                const p = normalizePhoneForSearch(e.recipientPhone); if (p) seen.add(p)
            }
        }
        return Array.from(seen)
    }, [filtered])

    // ──────────────────────── Render ─────────────────────────
    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                        <MessageCircle className="h-5 w-5" />
                    </span>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">WhatsApp Recovery Operations Center</h1>
                        <p className="text-sm text-slate-500 mt-0.5 max-w-2xl">
                            Monitor failed WhatsApp notifications and recover customer communication.
                            Notify users that our system is now back to normal.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { loadSummary(); loadEvents(); loadGateway() }}>
                        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${summaryLoading || eventsLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button variant="outline" size="sm"><BookOpen className="h-3.5 w-3.5 mr-1.5" />How it works?</Button>
                </div>
            </div>

            {/* Main grid */}
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
                <div className="space-y-5 min-w-0">
                    {/* KPIs */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                        <KpiCard tone="red" icon={<AlertCircle className="h-4 w-4" />} label="Failed Today" value={summary?.kpis.failedToday ?? 0} hint="vs 24h ago" />
                        <KpiCard tone="orange" icon={<MailWarning className="h-4 w-4" />} label="Recovery Sent" value={summary?.kpis.recoverySent ?? 0} hint="24h window" />
                        <KpiCard tone="blue" icon={<Mail className="h-4 w-4" />} label="Delivered" value={summary?.kpis.delivered ?? 0} hint="if available" />
                        <KpiCard tone="emerald" icon={<Eye className="h-4 w-4" />} label="Read" value={summary?.kpis.read ?? 0} hint="if available" />
                        <KpiCard tone="purple" icon={<ShieldCheck className="h-4 w-4" />} label="Resolved" value={summary?.kpis.resolved ?? 0} hint="Auto resolved" />
                    </div>

                    {/* Trend chart */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900">Delivery Trend (Last 24 Hours)</h3>
                                <p className="text-[11px] text-slate-500">Failed · Recovery Sent · Delivered · Read</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Select defaultValue="24h">
                                    <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="24h">Last 24 Hours</SelectItem>
                                        <SelectItem value="7d">Last 7 days</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select defaultValue="all">
                                    <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Purposes</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="h-[240px]">
                            {summary && summary.trend.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={summary.trend} margin={{ top: 5, right: 12, left: -8, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={3} />
                                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
                                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                        <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={1.5} dot={{ r: 2 }} name="Failed" />
                                        <Line type="monotone" dataKey="recoverySent" stroke="#f97316" strokeWidth={1.5} dot={{ r: 2 }} name="Recovery Sent" />
                                        <Line type="monotone" dataKey="delivered" stroke="#3b82f6" strokeWidth={1.5} dot={{ r: 2 }} name="Delivered" />
                                        <Line type="monotone" dataKey="read" stroke="#10b981" strokeWidth={1.5} dot={{ r: 2 }} name="Read" />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex items-center justify-center text-xs text-slate-400">No data in the last 24 hours</div>
                            )}
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative flex-1 min-w-[220px]">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                                <Input placeholder="Search by phone number, email or purpose..." value={filterSearch} onChange={e => setFilterSearch(e.target.value)} className="pl-8 h-9" />
                            </div>
                            <Select value={filterPurpose} onValueChange={setFilterPurpose}>
                                <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="All Purposes" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Purposes</SelectItem>
                                    <SelectItem value="password_reset">Password Reset</SelectItem>
                                    <SelectItem value="registration_verification">Registration</SelectItem>
                                    <SelectItem value="phone_verification">Phone Verification</SelectItem>
                                    <SelectItem value="qr_consumer">QR & Consumer</SelectItem>
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
                            <Button variant="ghost" size="sm" className="h-9 text-slate-600" onClick={() => {
                                setFilterPurpose("all"); setFilterStatus("all"); setFilterProvider("all"); setFilterSearch("")
                            }}>Clear</Button>
                        </div>
                    </div>

                    {/* Bulk action row + tabs */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" disabled={selectedPhones.length === 0}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                onClick={() => notifyBulk(selectedPhones, { templateKey: "recovery_notice" })}>
                                <Send className="h-3.5 w-3.5 mr-1.5" />Notify Selected ({selectedPhones.length})
                            </Button>
                            <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50"
                                disabled={allFailedPhones.length === 0}
                                onClick={() => setConfirmBulk(true)}>
                                <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />Notify All Failed ({allFailedPhones.length})
                            </Button>
                            <Button size="sm" variant="outline" onClick={exportCsv}>
                                <Download className="h-3.5 w-3.5 mr-1.5" />Export
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

                        {/* Status Tabs */}
                        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-2">
                            {([
                                ["all", "All", tabCounts.all, "text-slate-700"],
                                ["failed", "Failed", tabCounts.failed, "text-red-600"],
                                ["recovery_sent", "Recovery Sent", tabCounts.recovery_sent, "text-orange-600"],
                                ["delivered", "Delivered", tabCounts.delivered, "text-blue-600"],
                                ["read", "Read", tabCounts.read, "text-emerald-600"],
                                ["resolved", "Resolved", tabCounts.resolved, "text-emerald-700"],
                            ] as const).map(([key, label, count, color]) => (
                                <button key={key}
                                    onClick={() => setStatusTab(key as any)}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${statusTab === key ? "bg-slate-900 text-white" : `bg-slate-50 ${color} hover:bg-slate-100`}`}>
                                    {label} <span className="ml-1 opacity-80">({count})</span>
                                </button>
                            ))}
                        </div>

                        {/* Table */}
                        {eventsLoading ? (
                            <div className="py-8 flex items-center justify-center text-sm text-slate-500 gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />Loading…
                            </div>
                        ) : events.length === 0 ? (
                            <div className="py-10 text-center text-slate-400">
                                <ListChecks className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                                <p className="text-sm">No records in this view</p>
                                <p className="text-xs mt-0.5">Try changing the tab or clearing filters.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-left">
                                            <th className="px-2 py-2 w-8">
                                                <input type="checkbox" onChange={e => selectVisible(e.target.checked)}
                                                    checked={events.every(e => selected.has(e.id)) && events.length > 0} />
                                            </th>
                                            <th className="px-2 py-2 w-6"></th>
                                            <th className="px-2 py-2 text-xs font-medium text-slate-500">Phone</th>
                                            <th className="px-2 py-2 text-xs font-medium text-slate-500">Date · Event</th>
                                            <th className="px-2 py-2 text-xs font-medium text-slate-500">Purpose</th>
                                            <th className="px-2 py-2 text-xs font-medium text-slate-500">Status</th>
                                            <th className="px-2 py-2 text-xs font-medium text-slate-500">Provider</th>
                                            <th className="px-2 py-2 text-xs font-medium text-slate-500 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {events.map(e => {
                                            const isFailed = e.status === "failed" || e.status === "send_failed"
                                            const dotTone = isFailed ? "bg-red-500" : e.status === "sent" ? "bg-orange-400" :
                                                e.status === "delivered" ? "bg-blue-500" : e.status === "read" ? "bg-emerald-500" : "bg-slate-400"
                                            return (
                                                <tr key={e.id} className="hover:bg-slate-50/60">
                                                    <td className="px-2 py-2.5">
                                                        <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelected(e.id)} />
                                                    </td>
                                                    <td className="px-2 py-2.5">
                                                        <span className={`inline-block h-2 w-2 rounded-full ${dotTone}`} />
                                                    </td>
                                                    <td className="px-2 py-2.5 text-xs font-mono text-slate-800">+{e.recipientPhone || "—"}</td>
                                                    <td className="px-2 py-2.5 text-xs text-slate-600">
                                                        <div>{formatTime(e.createdAt)}</div>
                                                        <div className="text-slate-400">{(e.eventType || "").replace(/_/g, " ")}</div>
                                                    </td>
                                                    <td className="px-2 py-2.5">
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${PURPOSE_TONE[e.purpose] || "bg-slate-100 text-slate-700"}`}>
                                                            {formatPurpose(e.purpose)}
                                                        </span>
                                                    </td>
                                                    <td className="px-2 py-2.5">
                                                        <StatusPill status={e.status} />
                                                        {isFailed && e.errorMessage && (
                                                            <div className="text-[10px] text-red-500 mt-0.5 max-w-[140px] truncate" title={e.errorMessage}>
                                                                {e.errorMessage}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-2 py-2.5 text-xs text-slate-500">{e.provider || "—"}</td>
                                                    <td className="px-2 py-2.5 text-right whitespace-nowrap">
                                                        {isFailed && e.recipientPhone ? (
                                                            <div className="inline-flex items-center gap-1">
                                                                <Button size="sm" variant="outline" className="h-7 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                                                    disabled={sendingPhone === e.recipientPhone}
                                                                    onClick={() => notifyOne(normalizePhoneForSearch(e.recipientPhone), e.purpose || e.eventType)}>
                                                                    {sendingPhone === e.recipientPhone ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
                                                                    Notify User
                                                                </Button>
                                                                <Button size="icon" variant="ghost" className="h-7 w-7"
                                                                    onClick={() => { setCustomTargetPhone(normalizePhoneForSearch(e.recipientPhone)); setCustomMessage(""); setCustomOpen(true) }}>
                                                                    <FileText className="h-3.5 w-3.5 text-slate-500" />
                                                                </Button>
                                                                <Button size="icon" variant="ghost" className="h-7 w-7">
                                                                    <MoreHorizontal className="h-3.5 w-3.5 text-slate-500" />
                                                                </Button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-300 text-xs">—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {total > 0 && (
                            <div className="flex items-center justify-between pt-2">
                                <p className="text-xs text-slate-500">
                                    Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} results
                                </p>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
                                    <span className="text-xs text-slate-700">Page {page} of {totalPages}</span>
                                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ───── Right Sidebar ───── */}
                <aside className="space-y-4 xl:sticky xl:top-4 self-start">
                    {/* Gateway status */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-slate-900">Gateway Status</h3>
                            <Badge variant="outline" className={gatewayStatus.connected
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-red-50 text-red-700 border-red-200"}>
                                {gatewayStatus.connected ? "● Healthy" : "● Offline"}
                            </Badge>
                        </div>
                        <div className="flex items-start gap-3 mb-3">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                                {gatewayStatus.connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                            </span>
                            <div>
                                <p className="text-sm font-medium text-slate-900">Baileys Gateway</p>
                                <p className="text-xs text-emerald-600">{gatewayStatus.connected ? "Connected" : "Disconnected"}</p>
                                {gatewayStatus.phone && <p className="text-[11px] text-slate-500 mt-0.5">{gatewayStatus.phone}</p>}
                            </div>
                        </div>
                        <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between"><span className="text-slate-500">Failed (24h)</span><span className="font-medium text-slate-900">{summary?.kpis.failedToday ?? 0}</span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Recovery Sent (24h)</span><span className="font-medium text-slate-900">{summary?.kpis.recoverySent ?? 0}</span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Delivered (24h)</span><span className="font-medium text-slate-900">{summary?.kpis.delivered ?? 0}</span></div>
                        </div>
                        <Button variant="outline" size="sm" className="w-full mt-3" onClick={() => loadGateway()}>
                            <Activity className="h-3.5 w-3.5 mr-1.5" />View Gateway Logs
                        </Button>
                    </div>

                    {/* Quick actions */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-slate-900 mb-3">Quick Actions</h3>
                        <div className="space-y-1.5">
                            {quickActions.map(a => {
                                const phones = failedPhonesByPurpose(a.match)
                                return (
                                    <button key={a.key} disabled={phones.length === 0}
                                        className="w-full flex items-center justify-between text-xs px-2 py-2 rounded-md border border-slate-100 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={() => setPendingQuickAction({ label: a.label, templateKey: a.key, phones })}>
                                        <span className="flex items-center gap-2 text-slate-700">{a.icon}{a.label}</span>
                                        <span className="text-slate-400">{phones.length}</span>
                                    </button>
                                )
                            })}
                            <button className="w-full flex items-center justify-between text-xs px-2 py-2 rounded-md border border-slate-100 hover:bg-slate-50"
                                onClick={() => { setCustomTargetPhone(null); setCustomMessage(""); setCustomOpen(true) }}>
                                <span className="flex items-center gap-2 text-slate-700"><FileText className="h-3.5 w-3.5" />Custom Recovery Message</span>
                                <Plus className="h-3.5 w-3.5 text-slate-400" />
                            </button>
                        </div>
                    </div>

                    {/* Templates */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-slate-900">Recovery Templates</h3>
                            <button className="text-xs text-blue-600 hover:text-blue-700">View All</button>
                        </div>
                        <div className="space-y-2">
                            {templates.slice(0, 4).map(t => (
                                <div key={t.key} className="rounded-md border border-slate-100 px-2.5 py-2">
                                    <p className="text-xs font-medium text-slate-900">{t.name}</p>
                                    <p className="text-[10px] text-slate-500 truncate">{t.hint || t.body.slice(0, 60) + "…"}</p>
                                </div>
                            ))}
                        </div>
                        <Button variant="outline" size="sm" className="w-full mt-3" disabled title="Template management coming soon">
                            <Plus className="h-3.5 w-3.5 mr-1.5" />Create New Template
                        </Button>
                        <p className="text-[10px] text-slate-400 mt-2 leading-snug">
                            Templates are currently bundled with the app. Migration to DB-backed templates is planned.
                        </p>
                    </div>

                    {/* Help */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs text-slate-600 mb-2">Need Help?</p>
                        <p className="text-[11px] text-slate-500 mb-3">Learn how recovery and notification works.</p>
                        <Button variant="outline" size="sm" className="w-full"><BookOpen className="h-3.5 w-3.5 mr-1.5" />View Guide</Button>
                    </div>
                </aside>
            </div>

            {/* Confirm bulk modal */}
            <Dialog open={confirmBulk} onOpenChange={setConfirmBulk}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-500" />Confirm bulk recovery send
                        </DialogTitle>
                        <DialogDescription>
                            You are about to send a recovery notification to <span className="font-semibold">{allFailedPhones.length}</span> phone number{allFailedPhones.length === 1 ? "" : "s"}.
                            Recent recipients (24h) will be skipped automatically to prevent spam.
                            <br /><br />
                            This is <span className="font-semibold">not</span> an OTP resend. The message simply informs the user that the WhatsApp system is restored.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setConfirmBulk(false)}>Cancel</Button>
                        <Button className="bg-red-600 hover:bg-red-700 text-white"
                            onClick={() => { setConfirmBulk(false); notifyBulk(allFailedPhones, { templateKey: "recovery_notice" }) }}>
                            Yes, send to {allFailedPhones.length}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Quick action confirm */}
            <Dialog open={!!pendingQuickAction} onOpenChange={(o) => !o && setPendingQuickAction(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{pendingQuickAction?.label}</DialogTitle>
                        <DialogDescription>
                            Send recovery message to <span className="font-semibold">{pendingQuickAction?.phones.length}</span> failed user{pendingQuickAction?.phones.length === 1 ? "" : "s"}?
                            Recent recipients will be auto-skipped (24h dedupe window).
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setPendingQuickAction(null)}>Cancel</Button>
                        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => {
                            const p = pendingQuickAction; setPendingQuickAction(null)
                            if (p) notifyBulk(p.phones, { templateKey: p.templateKey })
                        }}>Send</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Custom message modal */}
            <Dialog open={customOpen} onOpenChange={setCustomOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Custom Recovery Message</DialogTitle>
                        <DialogDescription>
                            {customTargetPhone ? <>To <span className="font-mono">+{customTargetPhone}</span></> : <>Send to selected/filtered failed users</>}.
                            This sends a one-off recovery message — not an OTP.
                        </DialogDescription>
                    </DialogHeader>
                    <textarea
                        className="w-full h-40 rounded-md border border-slate-200 p-2 text-sm"
                        placeholder="Type your message..."
                        value={customMessage} onChange={e => setCustomMessage(e.target.value)} />
                    <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Preview</p>
                        {customMessage || "(empty)"}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCustomOpen(false)}>Cancel</Button>
                        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            disabled={!customMessage.trim()}
                            onClick={() => {
                                const msg = customMessage.trim(); setCustomOpen(false)
                                if (customTargetPhone) {
                                    notifyOne(customTargetPhone, "recovery_notice", { customMessage: msg })
                                } else if (selectedPhones.length > 0) {
                                    notifyBulk(selectedPhones, { customMessage: msg })
                                } else if (allFailedPhones.length > 0) {
                                    notifyBulk(allFailedPhones, { customMessage: msg })
                                }
                            }}>
                            <Send className="h-3.5 w-3.5 mr-1.5" />Send
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Toast */}
            {toast && (
                <div className={`fixed bottom-4 right-4 z-50 rounded-lg shadow-lg border px-4 py-3 text-sm ${toast.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
                    <div className="flex items-center gap-2">
                        {toast.kind === "ok" ? <CheckCheck className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                        {toast.text}
                    </div>
                </div>
            )}
        </div>
    )
}

export default WhatsAppRecoveryCenter
