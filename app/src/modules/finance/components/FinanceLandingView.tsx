'use client'

import { useRouter } from 'next/navigation'
import {
    ArrowRight,
    BookOpen,
    TrendingUp,
    Wallet,
    Landmark,
    PieChart,
    Settings as SettingsIcon,
    AlertCircle,
    Construction,
} from 'lucide-react'
import { financeNavGroups, type FinanceNavGroup } from '@/modules/finance/financeNav'
import FinanceHeroBanner from './FinanceHeroBanner'
import SetupReadinessBanner from '@/components/shared/SetupReadinessBanner'
import { Badge } from '@/components/ui/badge'

// ── Props ────────────────────────────────────────────────────────

interface FinanceLandingViewProps {
    userName?: string | null
    bannerImageUrl?: string | null
}

// ── Card metadata (extra descriptions for landing page) ──────────

const cardDescriptions: Record<string, { description: string; status: 'live' | 'coming-soon' | 'placeholder' }> = {
    'finance-gl': {
        description: 'Manage journal entries, review pending postings, and maintain your Chart of Accounts.',
        status: 'live',
    },
    'finance-ar': {
        description: 'Track customer invoices, receipts, and aging analysis. Malaysia SST/e-Invoice ready.',
        status: 'live',
    },
    'finance-ap': {
        description: 'Manage supplier bills, payment vouchers, and AP aging. Integrates with Purchase Orders.',
        status: 'live',
    },
    'finance-cash': {
        description: 'Bank account register, reconciliation workflows, and cash flow monitoring.',
        status: 'live',
    },
    'finance-reports': {
        description: 'Trial Balance, Profit & Loss, Balance Sheet, GL Detail, and Cash Flow Statement.',
        status: 'live',
    },
    'finance-settings': {
        description: 'Default posting accounts, currency, fiscal year periods, posting rules, and permissions.',
        status: 'live',
    },
}

// ── Accent colours per card ──────────────────────────────────────

const cardAccents: Record<string, { bg: string; text: string; hoverBorder: string }> = {
    'finance-gl': { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-300', hoverBorder: 'hover:border-emerald-200 dark:hover:border-emerald-800' },
    'finance-ar': { bg: 'bg-sky-50 dark:bg-sky-900/30', text: 'text-sky-600 dark:text-sky-300', hoverBorder: 'hover:border-sky-200 dark:hover:border-sky-800' },
    'finance-ap': { bg: 'bg-orange-50 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-300', hoverBorder: 'hover:border-orange-200 dark:hover:border-orange-800' },
    'finance-cash': { bg: 'bg-indigo-50 dark:bg-indigo-900/30', text: 'text-indigo-600 dark:text-indigo-300', hoverBorder: 'hover:border-indigo-200 dark:hover:border-indigo-800' },
    'finance-reports': { bg: 'bg-violet-50 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-300', hoverBorder: 'hover:border-violet-200 dark:hover:border-violet-800' },
    'finance-settings': { bg: 'bg-slate-50 dark:bg-slate-900/30', text: 'text-slate-600 dark:text-slate-300', hoverBorder: 'hover:border-slate-200 dark:hover:border-slate-800' },
}

const defaultAccent = { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-300', hoverBorder: 'hover:border-emerald-200 dark:hover:border-emerald-800' }

// ── Status badge helper ──────────────────────────────────────────

function StatusBadge({ status }: { status: 'live' | 'coming-soon' | 'placeholder' }) {
    if (status === 'live') return null
    if (status === 'coming-soon') {
        return (
            <Badge variant="outline" className="text-amber-600 border-amber-200 text-[10px] px-1.5 py-0">
                <Construction className="h-2.5 w-2.5 mr-0.5" />
                Coming Soon
            </Badge>
        )
    }
    return (
        <Badge variant="outline" className="text-slate-500 border-slate-200 text-[10px] px-1.5 py-0">
            <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
            Placeholder
        </Badge>
    )
}

/**
 * Finance Landing / Overview page.
 * Shows hero banner + grouped quick-link cards generated from financeNav config.
 */
export default function FinanceLandingView({ userName, bannerImageUrl }: FinanceLandingViewProps) {
    const router = useRouter()

    return (
        <div className="w-full space-y-6">
            {/* Hero Banner */}
            <FinanceHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            {/* Setup Readiness */}
            <SetupReadinessBanner
                auditEndpoint="/api/finance/config/audit"
                settingsHref="/dashboard?view=finance/settings/configuration"
                moduleName="Finance"
                accentColor="emerald"
            />

            {/* Section subtitle */}
            <div>
                <p className="text-sm text-muted-foreground">
                    Manage your finances — general ledger, receivables, payables, cash &amp; banking, reports, and settings.
                </p>
            </div>

            {/* Quick link grid — responsive, uses full available width */}
            <div className="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {financeNavGroups.map((group: FinanceNavGroup) => {
                    const Icon = group.icon
                    const meta = cardDescriptions[group.id]
                    const accent = cardAccents[group.id] || defaultAccent

                    return (
                        <div
                            key={group.id}
                            className={`bg-card border border-border rounded-xl p-5 space-y-3 hover:shadow-md ${accent.hoverBorder} transition-all duration-200 group/card`}
                        >
                            <div className="flex items-center gap-2.5">
                                <div className={`flex items-center justify-center h-9 w-9 rounded-lg ${accent.bg} ${accent.text} transition-colors`}>
                                    <Icon className="h-4.5 w-4.5" />
                                </div>
                                <h2 className="font-semibold text-base text-foreground flex-1">{group.label}</h2>
                                {meta && <StatusBadge status={meta.status} />}
                            </div>

                            {meta && (
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    {meta.description}
                                </p>
                            )}

                            <ul className="space-y-0.5">
                                {group.children.map((child) => {
                                    const ChildIcon = child.icon
                                    const isComingSoon = meta && meta.status !== 'live'

                                    return (
                                        <li key={child.id}>
                                            <button
                                                onClick={() => router.push(child.href)}
                                                disabled={isComingSoon}
                                                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors group ${
                                                    isComingSoon
                                                        ? 'text-muted-foreground/50 cursor-not-allowed'
                                                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                                                }`}
                                            >
                                                <ChildIcon className="h-4 w-4 shrink-0" />
                                                <span className="flex-1 text-left">{child.label}</span>
                                                {!isComingSoon && (
                                                    <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                )}
                                            </button>
                                        </li>
                                    )
                                })}
                            </ul>
                        </div>
                    )
                })}
            </div>

            {/* ── Suggestions for missing features (Malaysia context) ── */}
            <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <h3 className="font-semibold text-sm text-amber-800 dark:text-amber-200">
                        Suggested Enhancements (Malaysia Context)
                    </h3>
                </div>
                <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1.5 list-disc list-inside">
                    <li><strong>Bank Reconciliation Workflow</strong> — Import bank statements (CSV/OFX), auto-match transactions, manual matching, and reconciliation reports.</li>
                    <li><strong>Period Lock / Close Controls</strong> — Prevent posting to closed periods, year-end closing wizard with retained earnings journal.</li>
                    <li><strong>Audit Trail Reports</strong> — Journal modification history, user activity log per period.</li>
                    <li><strong>SST / e-Invoice Readiness</strong> — Tax code configuration, LHDN MyInvois integration hooks (placeholder screens for future phase).</li>
                    <li><strong>Multi-Currency Support</strong> — Exchange rate table, unrealised gain/loss revaluation.</li>
                    <li><strong>Budgeting</strong> — Budget vs actual by account and period, variance reporting.</li>
                </ul>
            </div>
        </div>
    )
}
