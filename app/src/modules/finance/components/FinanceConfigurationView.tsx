'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
    Wrench, Loader2,
    CheckCircle2, AlertTriangle, XCircle, ArrowRight, Zap,
    Building, BookOpen, Cog, TrendingUp, Wallet, Landmark,
    RefreshCw, AlertOctagon, Info, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/use-toast'

// ── Types ────────────────────────────────────────────────────────

interface FinanceConfigurationViewProps {
    organizationId: string
    canEdit: boolean
    onNavigate?: (viewId: string) => void
}

type AuditStatus = 'configured' | 'partial' | 'missing'

interface AuditCheck {
    key: string
    label: string
    status: AuditStatus
    detail: string
    link?: string
    linkLabel?: string
    autoSetupKey?: string
    count?: number
    blocker?: boolean
}

interface AuditSection {
    section: string
    icon: string
    checks: AuditCheck[]
}

interface AuditData {
    sections: AuditSection[]
    summary: { total: number; configured: number; partial: number; missing: number; blockers: number }
}

const SECTION_ICONS: Record<string, React.ElementType> = {
    building: Building,
    book: BookOpen,
    cog: Cog,
    trending: TrendingUp,
    wallet: Wallet,
    landmark: Landmark,
}

const STATUS_CONFIG: Record<AuditStatus, { icon: React.ElementType; color: string; bg: string; label: string }> = {
    configured: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', label: 'Configured' },
    partial: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', label: 'Partial' },
    missing: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20', label: 'Missing' },
}

// ── Guided Setup explanations ────────────────────────────────────

const GUIDED_EXPLANATIONS: Record<string, { why: string; impact: string }> = {
    currency: {
        why: 'Base currency determines how all financial amounts are recorded and reported.',
        impact: 'Without a base currency, journal entries cannot be created and reports will not function.',
    },
    fiscal_year: {
        why: 'Fiscal years define your accounting periods for financial reporting.',
        impact: 'Journals cannot be posted without an open fiscal year and period.',
    },
    fiscal_periods: {
        why: 'Periods break the fiscal year into monthly segments for P&L and balance sheet reporting.',
        impact: 'Closed or missing periods block all journal postings for those date ranges.',
    },
    gl_accounts: {
        why: 'The Chart of Accounts is the foundation of all accounting — every transaction maps to GL accounts.',
        impact: 'No accounts = no journals, no reports, no receivables/payables tracking.',
    },
    default_accounts: {
        why: 'Control accounts tell the system where to post different transaction types automatically.',
        impact: 'Missing control accounts mean invoices, receipts, and payments cannot be auto-posted to GL.',
    },
    posting_mode: {
        why: 'Posting mode controls whether journal entries are created manually or automatically from documents.',
        impact: 'Manual mode requires explicit journal creation; Auto mode posts from invoices/receipts/payments.',
    },
    posting_rules: {
        why: 'Posting rules define the debit/credit mapping for each document type.',
        impact: 'Without rules, auto-posting cannot determine which accounts to use.',
    },
    ar_control: {
        why: 'AR control account tracks total customer receivables on the balance sheet.',
        impact: 'Customer invoices cannot post to GL without an AR control account.',
    },
    tax_codes: {
        why: 'Malaysia SST requires proper tax code setup for compliant invoicing.',
        impact: 'Missing tax codes mean all invoices will be zero-rated — potential compliance risk.',
    },
    ap_control: {
        why: 'AP control account tracks total supplier payables on the balance sheet.',
        impact: 'Supplier bills cannot post to GL without an AP control account.',
    },
    supplier_clearing: {
        why: 'Supplier deposit clearing tracks advance payments to vendors before invoice matching.',
        impact: 'Supplier deposits will not be tracked separately — potential reporting inaccuracy.',
    },
    bank_accounts: {
        why: 'Bank accounts are needed for all payment and receipt processing.',
        impact: 'Payments and receipts cannot be recorded without at least one bank account.',
    },
    bank_gl_mapping: {
        why: 'Each bank account should link to a GL account for proper cash position reporting.',
        impact: 'Bank transactions without GL links will not appear in financial reports.',
    },
    cash_account: {
        why: 'The cash control account is the default GL account for cash receipt/payment postings.',
        impact: 'Receipts and payments cannot auto-post without a cash account.',
    },
}

// ── Component ────────────────────────────────────────────────────

export default function FinanceConfigurationView({
    organizationId,
    canEdit,
    onNavigate,
}: FinanceConfigurationViewProps) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const isGuided = searchParams?.get('guided') === 'true'

    // Audit state
    const [audit, setAudit] = useState<AuditData | null>(null)
    const [auditLoading, setAuditLoading] = useState(true)
    const [autoSetupLoading, setAutoSetupLoading] = useState<string | null>(null)
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

    // ── Load audit ──────────────────────────────────────────────

    const loadAudit = useCallback(async () => {
        try {
            setAuditLoading(true)
            const res = await fetch('/api/finance/config/audit')
            if (!res.ok) throw new Error('Failed to load audit')
            const data = await res.json()
            setAudit(data)
            // In guided mode, auto-expand sections that need attention
            if (isGuided) {
                const needsAttention = new Set<string>(
                    (data.sections || [])
                        .filter((s: AuditSection) => s.checks.some((c: AuditCheck) => c.status !== 'configured'))
                        .map((s: AuditSection) => s.section)
                )
                setExpandedSections(needsAttention)
            }
        } catch (err) {
            console.error('Finance audit load error:', err)
        } finally {
            setAuditLoading(false)
        }
    }, [isGuided])

    useEffect(() => { loadAudit() }, [loadAudit])

    // ── Auto-setup handler ──────────────────────────────────────

    const handleAutoSetup = async (actionKey: string) => {
        try {
            setAutoSetupLoading(actionKey)
            const res = await fetch('/api/finance/config/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: actionKey }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed')
            toast({ title: 'Auto Setup', description: data.message })
            loadAudit()
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setAutoSetupLoading(null)
        }
    }

    // ── Navigate handler ────────────────────────────────────────

    const handleNav = (viewId: string, guided = false) => {
        const suffix = guided ? '?guided=true' : ''
        if (onNavigate) {
            onNavigate(viewId)
        } else {
            const url = '/' + viewId + suffix
            router.push(url)
        }
    }

    // ── Toggle section ──────────────────────────────────────────

    const toggleSection = (sectionName: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev)
            if (next.has(sectionName)) next.delete(sectionName)
            else next.add(sectionName)
            return next
        })
    }

    // ── Render ──────────────────────────────────────────────────

    if (auditLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    const pct = audit ? Math.round((audit.summary.configured / audit.summary.total) * 100) : 0
    const blockerCount = audit?.summary.blockers || 0

    return (
        <div className="space-y-6">
            {/* ─── Header ─── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <Wrench className="h-5 w-5 text-emerald-600" />
                        Finance Configuration
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {isGuided
                            ? 'Guided setup — follow each section to configure your finance module.'
                            : 'Control center — audit all finance settings and fix gaps from one place.'}
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={loadAudit} disabled={auditLoading} className="gap-1">
                    <RefreshCw className={`h-4 w-4 ${auditLoading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            {/* ─── Blocker Warning ─── */}
            {blockerCount > 0 && (
                <Card className="border-red-200 dark:border-red-800">
                    <CardContent className="py-4">
                        <div className="flex items-start gap-3">
                            <AlertOctagon className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
                                    {blockerCount} Blocking Issue{blockerCount > 1 ? 's' : ''}
                                </h3>
                                <p className="text-xs text-red-600 dark:text-red-300 mt-0.5">
                                    Finance modules cannot function correctly until these are resolved.
                                    Items marked with a red badge are hard blockers.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ─── Summary Card ─── */}
            {audit && (
                <Card>
                    <CardContent className="py-5">
                        <div className="flex items-center gap-6 flex-wrap">
                            {/* Progress ring */}
                            <div className="relative h-16 w-16 flex-shrink-0">
                                <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36">
                                    <path
                                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="3"
                                        className="text-muted/20"
                                    />
                                    <path
                                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="3"
                                        strokeDasharray={`${pct}, 100`}
                                        className={pct >= 80 ? 'text-green-500' : pct >= 50 ? 'text-amber-500' : 'text-red-500'}
                                    />
                                </svg>
                                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">
                                    {pct}%
                                </span>
                            </div>

                            <div className="flex-1 min-w-0">
                                <h2 className="text-base font-semibold">Configuration Readiness</h2>
                                <p className="text-sm text-muted-foreground">
                                    {audit.summary.configured} of {audit.summary.total} checks passed
                                </p>
                            </div>

                            <div className="flex gap-4 text-sm">
                                <span className="flex items-center gap-1.5">
                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                    <span className="font-medium">{audit.summary.configured}</span>
                                    <span className="text-muted-foreground">OK</span>
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                                    <span className="font-medium">{audit.summary.partial}</span>
                                    <span className="text-muted-foreground">Partial</span>
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <XCircle className="h-4 w-4 text-red-500" />
                                    <span className="font-medium">{audit.summary.missing}</span>
                                    <span className="text-muted-foreground">Missing</span>
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ─── Audit Sections ─── */}
            {audit?.sections.map((section, sectionIndex) => {
                const SectionIcon = SECTION_ICONS[section.icon] || Wrench
                const sectionConfigured = section.checks.filter(c => c.status === 'configured').length
                const sectionTotal = section.checks.length
                const isExpanded = !isGuided || expandedSections.has(section.section)
                const hasBlocers = section.checks.some(c => c.blocker && c.status !== 'configured')

                return (
                    <Card key={section.section} className={hasBlocers ? 'border-red-200 dark:border-red-800/50' : ''}>
                        <CardHeader className="pb-3">
                            <div
                                className="flex items-center justify-between cursor-pointer"
                                onClick={() => isGuided && toggleSection(section.section)}
                            >
                                <CardTitle className="text-base flex items-center gap-2">
                                    <SectionIcon className="h-5 w-5 text-emerald-600" />
                                    {isGuided && (
                                        <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                            Step {sectionIndex + 1}
                                        </span>
                                    )}
                                    {section.section}
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                    <Badge
                                        variant="outline"
                                        className={
                                            sectionConfigured === sectionTotal
                                                ? 'border-green-200 text-green-700 dark:text-green-400'
                                                : hasBlocers
                                                    ? 'border-red-200 text-red-700 dark:text-red-400'
                                                    : 'border-amber-200 text-amber-700 dark:text-amber-400'
                                        }
                                    >
                                        {sectionConfigured}/{sectionTotal}
                                    </Badge>
                                    {isGuided && (
                                        expandedSections.has(section.section)
                                            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        {isExpanded && (
                            <CardContent className="pt-0">
                                <div className="divide-y">
                                    {section.checks.map((check) => {
                                        const cfg = STATUS_CONFIG[check.status]
                                        const StatusIcon = cfg.icon
                                        const explanation = isGuided ? GUIDED_EXPLANATIONS[check.key] : null

                                        return (
                                            <div key={check.key} className="py-3 first:pt-0 last:pb-0">
                                                <div className="flex items-center gap-3">
                                                    <div className={`flex-shrink-0 rounded-full p-1.5 ${cfg.bg}`}>
                                                        <StatusIcon className={`h-4 w-4 ${cfg.color}`} />
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-medium">{check.label}</span>
                                                            {typeof check.count === 'number' && check.count > 0 && (
                                                                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                                                                    {check.count}
                                                                </Badge>
                                                            )}
                                                            {check.blocker && check.status !== 'configured' && (
                                                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                                                    Blocker
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-muted-foreground truncate">{check.detail}</p>
                                                    </div>

                                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                                        {canEdit && check.autoSetupKey && check.status !== 'configured' && (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="text-xs gap-1 h-7"
                                                                disabled={autoSetupLoading === check.autoSetupKey}
                                                                onClick={() => handleAutoSetup(check.autoSetupKey!)}
                                                            >
                                                                {autoSetupLoading === check.autoSetupKey ? (
                                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                                ) : (
                                                                    <Zap className="h-3 w-3" />
                                                                )}
                                                                Auto Setup
                                                            </Button>
                                                        )}
                                                        {check.link && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="text-xs gap-1 h-7"
                                                                onClick={() => handleNav(check.link!, isGuided)}
                                                            >
                                                                {check.status === 'configured' ? 'View' : 'Fix Now'}
                                                                <ArrowRight className="h-3 w-3" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Guided mode explanation */}
                                                {isGuided && explanation && check.status !== 'configured' && (
                                                    <div className="ml-10 mt-2 p-2 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs space-y-1">
                                                        <div className="flex items-start gap-1.5">
                                                            <Info className="h-3 w-3 text-blue-500 mt-0.5 flex-shrink-0" />
                                                            <div>
                                                                <span className="font-medium text-blue-700 dark:text-blue-300">Why: </span>
                                                                <span className="text-blue-600 dark:text-blue-400">{explanation.why}</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-start gap-1.5">
                                                            <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" />
                                                            <div>
                                                                <span className="font-medium text-amber-700 dark:text-amber-300">If skipped: </span>
                                                                <span className="text-amber-600 dark:text-amber-400">{explanation.impact}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </CardContent>
                        )}
                    </Card>
                )
            })}

            {/* ─── Quick Setup All (guided mode) ─── */}
            {isGuided && canEdit && audit && pct < 100 && (
                <Card className="border-emerald-200 dark:border-emerald-800">
                    <CardContent className="py-5">
                        <div className="flex items-center gap-4">
                            <Zap className="h-8 w-8 text-emerald-500" />
                            <div className="flex-1">
                                <h3 className="text-sm font-semibold">Quick Setup — Apply All Defaults</h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Automatically configure currency (MYR), fiscal year, chart of accounts, tax codes, and posting rules with safe Malaysian defaults.
                                    You can customize everything later.
                                </p>
                            </div>
                            <Button
                                size="sm"
                                className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                                disabled={!!autoSetupLoading}
                                onClick={async () => {
                                    const actions = ['default_currency', 'default_fiscal_year', 'seed_chart_of_accounts', 'default_tax_codes', 'default_posting_rules']
                                    for (const action of actions) {
                                        try {
                                            setAutoSetupLoading(action)
                                            const res = await fetch('/api/finance/config/audit', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ action }),
                                            })
                                            const data = await res.json()
                                            if (!res.ok) {
                                                toast({ title: `Setup: ${action}`, description: data.error || 'Failed', variant: 'destructive' })
                                                break
                                            }
                                        } catch (err: any) {
                                            toast({ title: 'Error', description: err.message, variant: 'destructive' })
                                            break
                                        }
                                    }
                                    setAutoSetupLoading(null)
                                    toast({ title: 'Quick Setup Complete', description: 'Default finance configuration applied. Review and customize as needed.' })
                                    loadAudit()
                                }}
                            >
                                {autoSetupLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Zap className="h-4 w-4" />
                                )}
                                Apply All Defaults
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
