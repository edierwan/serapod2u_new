'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Landmark,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ChevronDown,
  Info,
  ArrowRight,
  Wallet,
  Receipt,
  Building2,
  CreditCard,
  Banknote,
  Eye,
  ShieldCheck,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  getHrAccountingConfig,
  applyHrCoaTemplate,
  setupDefaultHrGlMappings,
  saveHrGlMapping,
  validateHrGlMappings,
} from '@/modules/hr/accounting/actions'
import {
  PAYROLL_MAPPING_KEYS,
  CLAIMS_MAPPING_KEYS,
  type HrAccountingConfig,
  type GlAccountOption,
} from '@/modules/hr/accounting/types'

// ── Auto-Assign: mapping_key → expected GL account code ──────────
// These match the same codes used in the setup_hr_gl_mappings RPC
const PAYROLL_AUTO_ASSIGN: Record<string, { codes: string[]; side: 'debit' | 'credit' }> = {
  salary_expense:           { codes: ['6100'],        side: 'debit' },
  employer_contributions:   { codes: ['6110', '6100'], side: 'debit' },  // fallback to 6100 if 6110 missing
  payroll_payable:          { codes: ['2200'],        side: 'credit' },
  epf_payable:              { codes: ['2210'],        side: 'credit' },
  socso_payable:            { codes: ['2220'],        side: 'credit' },
  eis_payable:              { codes: ['2230'],        side: 'credit' },
  pcb_payable:              { codes: ['2240'],        side: 'credit' },
  other_deductions_payable: { codes: ['2250'],        side: 'credit' },
}

const CLAIMS_AUTO_ASSIGN: Record<string, { codes: string[]; side: 'debit' | 'credit' }> = {
  claims_expense: { codes: ['6200'], side: 'debit' },
  claims_payable: { codes: ['2300'], side: 'credit' },
}

// Clearing/bank account auto-assign: account_type → candidate GL codes
const CLEARING_AUTO_ASSIGN: Record<string, { codes: string[]; type: 'LIABILITY' | 'ASSET' }> = {
  CLEARING: { codes: ['2200', '2100'], type: 'LIABILITY' },  // Payroll Payable or AP
  BANK:     { codes: ['1100', '1110', '1000'], type: 'ASSET' },  // Bank / Cash
}

// ── Types for new payroll component mapping ──────────────────────

interface PayrollComponent {
  id: string
  code: string
  name: string
  category: 'earning' | 'deduction' | 'employer'
  is_statutory: boolean
  payroll_component_gl_map: Array<{
    id: string
    debit_gl_account_id: string | null
    credit_gl_account_id: string | null
    is_active: boolean
  }>
}

interface ClearingAccount {
  id: string
  account_type: string
  gl_account_id: string
  is_default: boolean
  bank_account_name: string | null
  gl_accounts: { code: string; name: string; account_type: string } | null
}

interface PreviewLine {
  component: string
  description: string
  account_code: string
  account_name: string
  debit: number
  credit: number
  missing_mapping?: boolean
}

interface PreviewResult {
  success: boolean
  lines: PreviewLine[]
  totals: { debit: number; credit: number; balanced: boolean }
  employee_count: number
  period: string
  missing_mappings: string[]
  has_clearing: boolean
}

interface HrAccountingViewProps {
  organizationId: string
  canEdit: boolean
}

// ── Account Picker ───────────────────────────────────────────────

function AccountPicker({
  accounts,
  value,
  onChange,
  filterType,
  disabled,
}: {
  accounts: GlAccountOption[]
  value: string | null
  onChange: (id: string | null) => void
  filterType?: 'ASSET' | 'LIABILITY' | 'EXPENSE' | 'INCOME'
  disabled?: boolean
}) {
  const filtered = filterType
    ? accounts.filter((a) => a.account_type === filterType)
    : accounts

  return (
    <select
      className={cn(
        'w-full rounded-md border bg-background px-3 py-2 text-sm',
        !value && 'text-muted-foreground'
      )}
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
    >
      <option value="">— Select account —</option>
      {filtered.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code} – {a.name} ({a.account_type})
        </option>
      ))}
    </select>
  )
}

// ── Mapping Row ──────────────────────────────────────────────────

function MappingRow({
  label,
  side,
  required,
  accountId,
  accounts,
  onSave,
  canEdit,
}: {
  label: string
  side: 'debit' | 'credit'
  required: boolean
  accountId: string | null
  accounts: GlAccountOption[]
  onSave: (accountId: string | null) => Promise<void>
  canEdit: boolean
}) {
  const [value, setValue] = useState(accountId)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const changed = value !== accountId

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(value)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  // Reset value when accountId changes externally
  useEffect(() => setValue(accountId), [accountId])

  const filterType = side === 'debit' ? 'EXPENSE' as const : 'LIABILITY' as const

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-64 shrink-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-[10px] font-medium px-1.5 py-0.5 rounded',
              side === 'debit'
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                : 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
            )}
          >
            {side === 'debit' ? 'DR' : 'CR'}
          </span>
          <span className="text-sm font-medium">{label}</span>
          {required && <span className="text-red-500 text-xs">*</span>}
        </div>
      </div>
      <div className="flex-1">
        <AccountPicker
          accounts={accounts}
          value={value}
          onChange={(v) => setValue(v)}
          filterType={filterType}
          disabled={!canEdit}
        />
      </div>
      {canEdit && changed && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="h-3 w-3 text-green-500" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          Save
        </Button>
      )}
      {!value && required && (
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
      )}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────

export default function HrAccountingView({ organizationId, canEdit }: HrAccountingViewProps) {
  const [config, setConfig] = useState<HrAccountingConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [settingUp, setSettingUp] = useState(false)
  const [validation, setValidation] = useState<{ valid: boolean; missing: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // New: payroll component mapping state
  const [components, setComponents] = useState<PayrollComponent[]>([])
  const [clearingAccounts, setClearingAccounts] = useState<ClearingAccount[]>([])
  const [allGlAccounts, setAllGlAccounts] = useState<GlAccountOption[]>([])
  const [loadingComponents, setLoadingComponents] = useState(false)
  const [seedingAll, setSeedingAll] = useState(false)
  const [activeTab, setActiveTab] = useState<'legacy' | 'components' | 'clearing'>('components')

  // Control accounts edit state
  const [clearingAccountId, setClearingAccountId] = useState<string>('')
  const [bankAccountId, setBankAccountId] = useState<string>('')
  const [savingControl, setSavingControl] = useState(false)

  // Preview journal state
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
  const [payrollRuns, setPayrollRuns] = useState<Array<{ id: string; period_start: string; period_end: string; status: string }>>([])
  const [selectedRunId, setSelectedRunId] = useState<string>('')

  // Validation state
  const [validating, setValidating] = useState(false)
  const [componentValidation, setComponentValidation] = useState<{ valid: boolean; missing: string[] } | null>(null)

  // Auto-assign state
  const [autoAssigning, setAutoAssigning] = useState(false)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getHrAccountingConfig(organizationId)
      if (result.success && result.data) {
        setConfig(result.data)
      } else {
        setError(result.error || 'Failed to load configuration')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [organizationId])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // ── Load payroll components ────────────────────────────────────

  const loadComponents = useCallback(async () => {
    setLoadingComponents(true)
    try {
      const [compRes, ctrlRes] = await Promise.all([
        fetch('/api/hr/payroll/components'),
        fetch('/api/hr/accounting/control-accounts'),
      ])
      if (compRes.ok) {
        const data = await compRes.json()
        setComponents(data.components || [])
        setClearingAccounts(data.clearingAccounts || [])
      }
      if (ctrlRes.ok) {
        const ctrlData = await ctrlRes.json()
        setAllGlAccounts(ctrlData.glAccounts || [])
        // Set initial dropdown values from existing defaults
        const clearing = (ctrlData.clearingAccounts || []).find(
          (a: ClearingAccount) => a.account_type === 'CLEARING' && a.is_default
        )
        const bank = (ctrlData.clearingAccounts || []).find(
          (a: ClearingAccount) => a.account_type === 'BANK' && a.is_default
        )
        if (clearing) setClearingAccountId(clearing.gl_account_id)
        if (bank) setBankAccountId(bank.gl_account_id)
      }
    } catch (e) {
      console.error('Failed to load payroll components:', e)
    } finally {
      setLoadingComponents(false)
    }
  }, [])

  useEffect(() => {
    loadComponents()
  }, [loadComponents])

  // Load payroll runs for preview selector
  useEffect(() => {
    async function loadRuns() {
      try {
        const res = await fetch('/api/hr/payroll/runs')
        if (res.ok) {
          const data = await res.json()
          setPayrollRuns((data.runs || data || []).filter((r: any) => ['approved', 'calculated', 'posted'].includes(r.status)))
        }
      } catch { /* ignore */ }
    }
    loadRuns()
  }, [])

  // ── Seed everything (accounts + components + mappings) ─────────

  async function handleSeedAll() {
    setSeedingAll(true)
    setError(null)
    try {
      const res = await fetch('/api/hr/payroll/components', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed_all' }),
      })
      const data = await res.json()
      if (data.success) {
        setSuccessMsg('HR GL accounts, payroll components, and GL mappings seeded successfully')
        setTimeout(() => setSuccessMsg(null), 5000)
        await Promise.all([loadConfig(), loadComponents()])
      } else {
        setError(data.error || 'Failed to seed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSeedingAll(false)
    }
  }

  // ── Save component GL mapping ──────────────────────────────────

  async function handleSaveComponentMapping(
    componentId: string,
    debitId: string | null,
    creditId: string | null
  ) {
    try {
      const res = await fetch('/api/hr/payroll/components', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component_id: componentId,
          debit_gl_account_id: debitId,
          credit_gl_account_id: creditId,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error || 'Failed to save mapping')
      }
      await loadComponents()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  // ── Validate on config load ────────────────────────────────────

  useEffect(() => {
    if (!config) return
    validateHrGlMappings(organizationId).then((res) => {
      if (res.success) {
        setValidation({ valid: res.valid, missing: res.missing })
      }
    })
  }, [config, organizationId])

  // ── Apply COA template ─────────────────────────────────────────

  async function handleApplyTemplate(template: string) {
    setApplying(true)
    setError(null)
    try {
      const result = await applyHrCoaTemplate(organizationId, template)
      if (result.success) {
        setSuccessMsg(
          `Template applied: ${result.data?.created ?? 0} accounts created, ${result.data?.skipped_updated ?? 0} existing`
        )
        setTimeout(() => setSuccessMsg(null), 5000)
        await loadConfig()
      } else {
        setError(result.error || 'Failed to apply template')
      }
    } finally {
      setApplying(false)
    }
  }

  // ── Setup default mappings ─────────────────────────────────────

  async function handleSetupMappings() {
    setSettingUp(true)
    setError(null)
    try {
      const result = await setupDefaultHrGlMappings(organizationId)
      if (result.success) {
        setSuccessMsg(
          `Mappings configured: ${result.data?.created ?? 0} created, ${result.data?.skipped ?? 0} existing`
        )
        setTimeout(() => setSuccessMsg(null), 5000)
        await loadConfig()
      } else {
        setError(result.error || 'Failed to setup mappings')
      }
    } finally {
      setSettingUp(false)
    }
  }

  // ── Save mapping handler ───────────────────────────────────────

  function getMappedAccountId(docType: string, key: string, side: 'debit' | 'credit'): string | null {
    if (!config) return null
    const m = config.mappings.find(
      (r) => r.document_type === docType && r.mapping_key === key
    )
    return side === 'debit' ? m?.expense_account_id || null : m?.offset_account_id || null
  }

  async function handleSaveMapping(docType: string, key: string, side: 'debit' | 'credit', accountId: string | null) {
    const result = await saveHrGlMapping(organizationId, docType, key, accountId, side)
    if (!result.success) {
      setError(result.error || 'Failed to save')
    }
    await loadConfig()
  }

  // ── Auto-assign all mappings by matching account codes ─────────

  async function handleAutoAssign(docType: 'PAYROLL_RUN' | 'EXPENSE_CLAIM') {
    const lookup = docType === 'PAYROLL_RUN' ? PAYROLL_AUTO_ASSIGN : CLAIMS_AUTO_ASSIGN
    const accounts = config?.accounts || []
    if (accounts.length === 0) {
      setError('No GL accounts available. Apply a COA template first.')
      return
    }

    setAutoAssigning(true)
    setError(null)
    let assigned = 0
    let skipped = 0
    const notFound: string[] = []

    try {
      for (const [key, spec] of Object.entries(lookup)) {
        // Check if already mapped
        const existing = config?.mappings.find(
          (m) => m.document_type === docType && m.mapping_key === key
        )
        const currentId = spec.side === 'debit' ? existing?.expense_account_id : existing?.offset_account_id
        if (currentId) {
          skipped++
          continue
        }

        // Find matching GL account by code (try each candidate in order)
        let account: GlAccountOption | undefined
        for (const code of spec.codes) {
          account = accounts.find((a) => a.code === code && a.is_active)
          if (account) break
        }
        if (!account) {
          notFound.push(`${key} (code ${spec.codes.join('/')})`)
          continue
        }

        await handleSaveMapping(docType, key, spec.side, account.id)
        assigned++
      }

      if (notFound.length > 0) {
        setError(`Auto-assigned ${assigned}, skipped ${skipped} existing. Could not find accounts for: ${notFound.join(', ')}`)
      } else {
        setSuccessMsg(`Auto-assigned ${assigned} mapping(s), ${skipped} already configured.`)
        setTimeout(() => setSuccessMsg(null), 5000)
      }

      await loadConfig()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto-assign failed')
    } finally {
      setAutoAssigning(false)
    }
  }

  // ── Auto-assign clearing & bank accounts ────────────────────────

  async function handleAutoAssignClearing() {
    const accounts = allGlAccounts.length > 0 ? allGlAccounts : config?.accounts || []
    if (accounts.length === 0) {
      setError('No GL accounts available. Apply a COA template first.')
      return
    }

    // Check if required account types exist at all
    const hasLiability = accounts.some((a) => a.account_type === 'LIABILITY' && a.is_active)
    const hasAsset = accounts.some((a) => a.account_type === 'ASSET' && a.is_active)
    if (!hasLiability && !hasAsset) {
      setError('No LIABILITY or ASSET GL accounts found. Please create bank/cash accounts in Chart of Accounts first (e.g. 1100 – Bank, 2200 – Payroll Payable).')
      return
    }

    setAutoAssigning(true)
    setError(null)
    let assigned = 0
    const notFound: string[] = []

    try {
      for (const [accountType, spec] of Object.entries(CLEARING_AUTO_ASSIGN)) {
        // Skip if already configured
        const currentVal = accountType === 'CLEARING' ? clearingAccountId : bankAccountId
        if (currentVal) {
          continue
        }

        // Find matching account by code + type
        let account: GlAccountOption | undefined
        for (const code of spec.codes) {
          account = accounts.find((a) => a.code === code && a.account_type === spec.type && a.is_active)
          if (account) break
        }
        if (!account) {
          // Fallback: pick first active account of the right type
          account = accounts.find((a) => a.account_type === spec.type && a.is_active)
        }
        if (!account) {
          notFound.push(`${accountType} (${spec.type})`)
          continue
        }

        // Save via API
        const res = await fetch('/api/hr/accounting/control-accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_type: accountType, gl_account_id: account.id, is_default: true }),
        })
        const data = await res.json()
        if (data.success) {
          if (accountType === 'CLEARING') setClearingAccountId(account.id)
          else setBankAccountId(account.id)
          assigned++
        }
      }

      if (notFound.length > 0) {
        setError(`Auto-assigned ${assigned} control account(s). Missing: ${notFound.join(', ')}`)
      } else if (assigned > 0) {
        setSuccessMsg(`Auto-assigned ${assigned} control account(s).`)
        setTimeout(() => setSuccessMsg(null), 5000)
      } else {
        setSuccessMsg('All control accounts already configured.')
        setTimeout(() => setSuccessMsg(null), 3000)
      }

      await loadComponents()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto-assign failed')
    } finally {
      setAutoAssigning(false)
    }
  }

  // ── Loading state ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Landmark className="h-5 w-5 text-blue-600" />
          HR Accounting Integration
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure GL account mappings for payroll posting and expense claims
        </p>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="p-3 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          {successMsg}
        </div>
      )}

      {/* Validation Status */}
      {validation && (
        <Card className={cn(
          'border-l-4',
          validation.valid ? 'border-l-green-500' : 'border-l-amber-500'
        )}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {validation.valid ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
              )}
              <div>
                <p className="font-medium text-sm">
                  {validation.valid
                    ? 'All required mappings configured — ready for auto-posting'
                    : `${validation.missing.length} required mapping(s) missing`}
                </p>
                {!validation.valid && (
                  <ul className="mt-1 text-xs text-muted-foreground space-y-0.5">
                    {validation.missing.map((m) => (
                      <li key={m} className="flex items-center gap-1">
                        <span className="text-amber-500">•</span> {m}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Setup */}
      {canEdit && config && !config.hasCoaTemplate && (
        <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">Quick Setup — COA Template Pack</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Your Chart of Accounts doesn&apos;t have the HR accounts yet. Apply a template
                  to create standard payroll and claims accounts automatically.
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => handleApplyTemplate('SME_BASIC_MY')}
                    disabled={applying}
                  >
                    {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                    SME Basic MY
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleApplyTemplate('SME_MY_PAYROLL_SPLIT')}
                    disabled={applying}
                  >
                    {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    SME MY + Payroll Split
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Auto-setup mappings button */}
      {canEdit && config && config.hasCoaTemplate && config.mappings.length === 0 && (
        <Card className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <RefreshCw className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">Setup Default Mappings</p>
                <p className="text-xs text-muted-foreground mt-1">
                  HR COA accounts exist but no mappings are configured yet. Auto-link them based
                  on standard account codes.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 mt-3"
                  onClick={handleSetupMappings}
                  disabled={settingUp}
                >
                  {settingUp ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Auto-Setup Mappings
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Payroll Mappings ──────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold">Payroll Account Mappings</h2>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => handleAutoAssign('PAYROLL_RUN')}
                disabled={autoAssigning || !config}
              >
                {autoAssigning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Auto Assign
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            When a payroll run is <strong>approved</strong>, the system creates a GL journal with these accounts.
            Salary expense is debited; statutory payables and net payroll are credited.
          </p>

          <div className="space-y-1 divide-y">
            {PAYROLL_MAPPING_KEYS.map((pk) => (
              <MappingRow
                key={pk.key}
                label={pk.label}
                side={pk.side}
                required={pk.required}
                accountId={getMappedAccountId('PAYROLL_RUN', pk.key, pk.side)}
                accounts={config?.accounts || []}
                onSave={(accountId) =>
                  handleSaveMapping('PAYROLL_RUN', pk.key, pk.side, accountId)
                }
                canEdit={canEdit}
              />
            ))}
          </div>

          <div className="mt-4 p-3 rounded-lg bg-muted/30 border">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>Payroll Accrual Journal:</strong></p>
                <p>Dr Salaries &amp; Wages Expense = total gross (basic + OT + allowances)</p>
                <p>Dr Employer Contributions Expense = EPF/SOCSO/EIS employer portion (optional)</p>
                <p>Cr Payroll Payable = net amount, Cr EPF/SOCSO/EIS/PCB Payable = statutory deductions</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Claims Mappings ───────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-green-600" />
              <h2 className="text-lg font-semibold">Expense Claim Mappings</h2>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => handleAutoAssign('EXPENSE_CLAIM')}
                disabled={autoAssigning || !config}
              >
                {autoAssigning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Auto Assign
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            When an expense claim is <strong>approved</strong>, the system creates: Dr Expense, Cr Claims Payable.
            On <strong>reimbursement</strong>: Dr Claims Payable, Cr Cash/Bank.
          </p>

          <div className="space-y-1 divide-y">
            {CLAIMS_MAPPING_KEYS.map((ck) => (
              <MappingRow
                key={ck.key}
                label={ck.label}
                side={ck.side}
                required={ck.required}
                accountId={getMappedAccountId('EXPENSE_CLAIM', ck.key, ck.side)}
                accounts={config?.accounts || []}
                onSave={(accountId) =>
                  handleSaveMapping('EXPENSE_CLAIM', ck.key, ck.side, accountId)
                }
                canEdit={canEdit}
              />
            ))}
          </div>

          <div className="mt-4 p-3 rounded-lg bg-muted/30 border">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>Claim Approval:</strong> Dr Staff Claims Expense, Cr Employee Claims Payable</p>
                <p><strong>Reimbursement:</strong> Dr Employee Claims Payable, Cr Cash/Bank</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Validation & Preview Tools ─────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold">Validation &amp; Preview Tools</h2>
          </div>

          <div className="flex flex-wrap gap-3">
            {/* Validate Mapping */}
            <Button
              variant="outline"
              className="gap-2"
              disabled={validating}
              onClick={async () => {
                setValidating(true)
                setComponentValidation(null)
                try {
                  // Check all active components have at least one GL mapping side
                  const missing: string[] = []
                  for (const comp of components) {
                    const m = comp.payroll_component_gl_map?.[0]
                    if (!m || (!m.debit_gl_account_id && !m.credit_gl_account_id)) {
                      missing.push(`${comp.name} (${comp.code})`)
                    }
                  }
                  setComponentValidation({ valid: missing.length === 0, missing })
                } finally {
                  setValidating(false)
                }
              }}
            >
              {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Validate Mapping
            </Button>

            {/* Preview Journal */}
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="h-4 w-4" />
              Preview Journal
            </Button>

            {/* Refresh */}
            <Button variant="outline" onClick={() => { loadConfig(); loadComponents() }} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>

          {/* Component Validation Result */}
          {componentValidation && (
            <div className={cn(
              'mt-4 p-3 rounded-md border text-sm',
              componentValidation.valid
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
            )}>
              {componentValidation.valid ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  All active components have GL account mappings configured.
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    {componentValidation.missing.length} component(s) missing GL mapping:
                  </div>
                  <ul className="mt-1 ml-6 list-disc text-xs">
                    {componentValidation.missing.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Preview Journal Dialog ─────────────────────────────── */}
      {previewOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Eye className="h-5 w-5 text-blue-600" />
                Preview Payroll Journal
              </h3>
              <Button variant="ghost" size="sm" onClick={() => { setPreviewOpen(false); setPreviewResult(null) }}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto">
              {/* Run Selector */}
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1 block">Select Payroll Run</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={selectedRunId}
                    onChange={(e) => setSelectedRunId(e.target.value)}
                  >
                    <option value="">— Choose a payroll run —</option>
                    {payrollRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.period_start} to {r.period_end} ({r.status})
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  disabled={!selectedRunId || previewLoading}
                  onClick={async () => {
                    setPreviewLoading(true)
                    setPreviewResult(null)
                    try {
                      const res = await fetch('/api/hr/accounting/preview-journal', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ payroll_run_id: selectedRunId }),
                      })
                      const data = await res.json()
                      if (data.success) {
                        setPreviewResult(data)
                      } else {
                        setError(data.error || 'Preview failed')
                      }
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Preview failed')
                    } finally {
                      setPreviewLoading(false)
                    }
                  }}
                  className="gap-2"
                >
                  {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  Generate Preview
                </Button>
              </div>

              {/* Preview Results */}
              {previewResult && (
                <div className="space-y-3">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">Period: <strong>{previewResult.period}</strong></span>
                    <span className="text-muted-foreground">Employees: <strong>{previewResult.employee_count}</strong></span>
                    <span className={cn(
                      'px-2 py-0.5 rounded text-xs font-medium',
                      previewResult.totals.balanced
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    )}>
                      {previewResult.totals.balanced ? 'Balanced' : 'IMBALANCED'}
                    </span>
                  </div>

                  {previewResult.missing_mappings.length > 0 && (
                    <div className="p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-700 dark:text-amber-300">
                      <strong>Missing mappings:</strong> {previewResult.missing_mappings.join(', ')}
                    </div>
                  )}

                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left px-3 py-2 font-medium">Description</th>
                          <th className="text-left px-3 py-2 font-medium">Account</th>
                          <th className="text-right px-3 py-2 font-medium">Debit (RM)</th>
                          <th className="text-right px-3 py-2 font-medium">Credit (RM)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {previewResult.lines.map((line, i) => (
                          <tr key={i} className={cn('hover:bg-muted/20', line.missing_mapping && 'bg-amber-50/50 dark:bg-amber-900/10')}>
                            <td className="px-3 py-2">{line.description}</td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {line.account_code} – {line.account_name}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {line.debit > 0 ? line.debit.toLocaleString('en', { minimumFractionDigits: 2 }) : ''}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {line.credit > 0 ? line.credit.toLocaleString('en', { minimumFractionDigits: 2 }) : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30 border-t-2 font-semibold">
                          <td className="px-3 py-2" colSpan={2}>TOTAL</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {previewResult.totals.debit.toLocaleString('en', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {previewResult.totals.credit.toLocaleString('en', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {!previewResult && !previewLoading && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Select a payroll run and click Generate Preview to see the GL journal entries that would be created.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Payroll Component → GL Mapping Table ────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-purple-600" />
              <h2 className="text-lg font-semibold">Payroll Component → GL Mapping</h2>
            </div>
            {canEdit && components.length === 0 && (
              <Button size="sm" onClick={handleSeedAll} disabled={seedingAll} className="gap-1.5">
                {seedingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Setup All (Accounts + Components + Mappings)
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground mb-4">
            Map each payroll component to its debit (expense) and credit (payable) GL account.
            This determines how payroll journals are generated when a payroll run is approved.
          </p>

          {loadingComponents ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : components.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No payroll components configured yet.</p>
              <p className="text-xs mt-1">Click &quot;Setup All&quot; above to seed HR accounts, components, and default mappings.</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left px-3 py-2 font-medium">Component</th>
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-left px-3 py-2 font-medium">Debit GL (Expense)</th>
                    <th className="text-left px-3 py-2 font-medium">Credit GL (Payable)</th>
                    {canEdit && <th className="text-center px-3 py-2 font-medium w-20">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {/* Group by category */}
                  {(['earning', 'deduction', 'employer'] as const).map((cat) => {
                    const catComponents = components.filter((c) => c.category === cat)
                    if (catComponents.length === 0) return null
                    return (
                      <ComponentCategoryGroup
                        key={cat}
                        category={cat}
                        components={catComponents}
                        accounts={config?.accounts || []}
                        canEdit={canEdit}
                        onSave={handleSaveComponentMapping}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 p-3 rounded-lg bg-muted/30 border">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>How it works:</strong></p>
                <p>• <strong>Earnings</strong> (BASIC, OT, Allowance): Debit expense account, Credit Net Salary Payable</p>
                <p>• <strong>Deductions</strong> (EPF EE, SOCSO EE, PCB): No debit (reduces gross→net), Credit statutory payable</p>
                <p>• <strong>Employer</strong> (EPF ER, SOCSO ER, EIS ER): Debit employer expense, Credit statutory payable</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Clearing Accounts ─────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-orange-600" />
              <h2 className="text-lg font-semibold">Payroll Clearing &amp; Bank Accounts</h2>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handleAutoAssignClearing}
                disabled={autoAssigning}
              >
                {autoAssigning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Auto Assign
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Configure the payroll clearing account and bank accounts used for salary payments.
            When payroll is approved: Dr Expense, Cr Payable. When bank payment is made: Dr Payable, Cr Bank.
          </p>

          {/* Editable Control Account Dropdowns */}
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Payroll Clearing Account</label>
              <p className="text-xs text-muted-foreground mb-2">Used to auto-balance payroll journals if debit/credit totals differ.</p>
              <div className="flex items-center gap-2">
                <select
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                  value={clearingAccountId}
                  onChange={(e) => setClearingAccountId(e.target.value)}
                  disabled={!canEdit}
                >
                  <option value="">— Select clearing account —</option>
                  {(allGlAccounts.length > 0 ? allGlAccounts : config?.accounts || []).filter((a) => a.account_type === 'LIABILITY').map((a) => (
                    <option key={a.id} value={a.id}>{a.code} – {a.name}</option>
                  ))}
                </select>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!clearingAccountId || savingControl}
                    onClick={async () => {
                      setSavingControl(true)
                      try {
                        const res = await fetch('/api/hr/accounting/control-accounts', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ account_type: 'CLEARING', gl_account_id: clearingAccountId, is_default: true }),
                        })
                        const data = await res.json()
                        if (data.success) {
                          setSuccessMsg('Clearing account saved')
                          setTimeout(() => setSuccessMsg(null), 3000)
                          await loadComponents()
                        } else {
                          setError(data.error || 'Failed to save')
                        }
                      } finally { setSavingControl(false) }
                    }}
                  >
                    {savingControl ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  </Button>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Default Payroll Bank Account</label>
              <p className="text-xs text-muted-foreground mb-2">The bank/cash account used when paying out salaries.</p>
              <div className="flex items-center gap-2">
                <select
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  disabled={!canEdit}
                >
                  <option value="">— Select bank/cash account —</option>
                  {(allGlAccounts.length > 0 ? allGlAccounts : config?.accounts || []).filter((a) => a.account_type === 'ASSET').map((a) => (
                    <option key={a.id} value={a.id}>{a.code} – {a.name}</option>
                  ))}
                </select>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!bankAccountId || savingControl}
                    onClick={async () => {
                      setSavingControl(true)
                      try {
                        const res = await fetch('/api/hr/accounting/control-accounts', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ account_type: 'BANK', gl_account_id: bankAccountId, is_default: true }),
                        })
                        const data = await res.json()
                        if (data.success) {
                          setSuccessMsg('Bank account saved')
                          setTimeout(() => setSuccessMsg(null), 3000)
                          await loadComponents()
                        } else {
                          setError(data.error || 'Failed to save')
                        }
                      } finally { setSavingControl(false) }
                    }}
                  >
                    {savingControl ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Existing clearing accounts list */}
          {clearingAccounts.length > 0 && (
            <div className="mt-4 pt-4 border-t space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Current configured accounts:</p>
              {clearingAccounts.map((ca) => (
                <div key={ca.id} className="flex items-center gap-3 p-2 border rounded-lg bg-muted/20">
                  <span className={cn(
                    'text-[10px] font-medium px-1.5 py-0.5 rounded',
                    ca.account_type === 'CLEARING'
                      ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      : ca.account_type === 'BANK'
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      : 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                  )}>
                    {ca.account_type}
                  </span>
                  <span className="text-sm">
                    {ca.gl_accounts?.code} – {ca.gl_accounts?.name}
                  </span>
                  {ca.is_default && (
                    <span className="text-[10px] bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-1.5 py-0.5 rounded">
                      Default
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Component Category Group ─────────────────────────────────────

function ComponentCategoryGroup({
  category,
  components,
  accounts,
  canEdit,
  onSave,
}: {
  category: 'earning' | 'deduction' | 'employer'
  components: PayrollComponent[]
  accounts: GlAccountOption[]
  canEdit: boolean
  onSave: (componentId: string, debitId: string | null, creditId: string | null) => Promise<void>
}) {
  const categoryLabels = {
    earning: { label: 'Earnings', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
    deduction: { label: 'Deductions', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
    employer: { label: 'Employer Contributions', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  }

  const { label, color } = categoryLabels[category]

  return (
    <>
      <tr>
        <td colSpan={5} className="px-3 py-1.5 bg-muted/30">
          <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded', color)}>
            {label}
          </span>
        </td>
      </tr>
      {components.map((comp) => (
        <ComponentMappingRow
          key={comp.id}
          component={comp}
          accounts={accounts}
          category={category}
          canEdit={canEdit}
          onSave={onSave}
        />
      ))}
    </>
  )
}

// ── Single Component Mapping Row ─────────────────────────────────

function ComponentMappingRow({
  component,
  accounts,
  category,
  canEdit,
  onSave,
}: {
  component: PayrollComponent
  accounts: GlAccountOption[]
  category: 'earning' | 'deduction' | 'employer'
  canEdit: boolean
  onSave: (componentId: string, debitId: string | null, creditId: string | null) => Promise<void>
}) {
  const mapping = component.payroll_component_gl_map?.[0]
  const [debitId, setDebitId] = useState(mapping?.debit_gl_account_id || '')
  const [creditId, setCreditId] = useState(mapping?.credit_gl_account_id || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const origDebit = mapping?.debit_gl_account_id || ''
  const origCredit = mapping?.credit_gl_account_id || ''
  const changed = debitId !== origDebit || creditId !== origCredit

  useEffect(() => {
    setDebitId(mapping?.debit_gl_account_id || '')
    setCreditId(mapping?.credit_gl_account_id || '')
  }, [mapping])

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(component.id, debitId || null, creditId || null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const expenseAccounts = accounts.filter((a) => a.account_type === 'EXPENSE')
  const liabilityAccounts = accounts.filter((a) => a.account_type === 'LIABILITY')

  return (
    <tr className="hover:bg-muted/20">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{component.name}</span>
          {component.is_statutory && (
            <span className="text-[9px] bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-1 py-0.5 rounded">
              Statutory
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">{component.code}</span>
      </td>
      <td className="px-3 py-2">
        <span className={cn(
          'text-[10px] font-medium px-1.5 py-0.5 rounded',
          category === 'earning'
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
            : category === 'deduction'
            ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
            : 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
        )}>
          {category}
        </span>
      </td>
      <td className="px-3 py-2">
        {category === 'deduction' ? (
          <span className="text-xs text-muted-foreground italic">N/A (reduces net)</span>
        ) : (
          <select
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
            value={debitId}
            onChange={(e) => setDebitId(e.target.value)}
            disabled={!canEdit}
          >
            <option value="">— Select DR account —</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} – {a.name}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="px-3 py-2">
        <select
          className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          value={creditId}
          onChange={(e) => setCreditId(e.target.value)}
          disabled={!canEdit}
        >
          <option value="">— Select CR account —</option>
          {liabilityAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} – {a.name}
            </option>
          ))}
        </select>
      </td>
      {canEdit && (
        <td className="px-3 py-2 text-center">
          {changed ? (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : saved ? (
                <CheckCircle2 className="h-3 w-3 text-green-500" />
              ) : (
                <Save className="h-3 w-3" />
              )}
            </Button>
          ) : mapping ? (
            <CheckCircle2 className="h-4 w-4 text-green-400 mx-auto" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-400 mx-auto" />
          )}
        </td>
      )}
    </tr>
  )
}
