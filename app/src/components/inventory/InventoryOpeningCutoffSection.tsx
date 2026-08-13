'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  History,
  Loader2,
  Lock,
  MoreHorizontal,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  canExecuteInventoryCutoff,
  inventoryCutoffReportCsv,
  type CutoffDecision,
  type CutoffReport,
} from '@/lib/inventory/inventory-cutoff'
import {
  OPENING_BALANCE_STEPS,
  deriveWorkspaceState,
  distributorBulkTargets,
  distributorGroupDecisionState,
  d2hReviewActionLabel,
  groupDistributorOrders,
  groupManufacturerOrders,
  groupWarehouseActivity,
  matchesSearch,
  openingBalanceContinueLabel,
  type DistributorLine,
  type DistributorOrderGroup,
  type ManufacturerLine,
  type ManufacturerOrderGroup,
  type OpeningBalanceStepId,
  type WorkspaceFilter,
} from '@/lib/inventory/opening-balance-workspace'
import {
  formatActivityRequiredAction,
  formatActivityStockConfiguration,
  formatActivityVariantLabel,
  formatWarehouseActivityReference,
  formatWarehouseActivityType,
  summarizeWarehouseActivity,
  warehouseActivityItems,
  warehouseActivityLineCount,
  warehouseActivityOpenHref,
  warehouseActivityOpenLabel,
  warehouseActivityQuantity,
  warehouseActivityTechnicalId,
  warehouseActivityVariantCount,
} from '@/lib/inventory/opening-balance-activity-presentation'
import {
  cancelledOpeningBalanceNextAction,
  formatOpeningBalanceDraftCreatedAt,
} from '@/lib/inventory/opening-balance-active-draft'
import {
  isValidStockCountPostingNote,
  normalizeStockCountPostingNote,
  formatStockCountClientError,
  requiresFreshStockCountVerification,
} from '@/lib/inventory/stock-count-verification-errors'
import { broadcastInventoryDataRefresh } from '@/lib/inventory/inventory-data-refresh'
import {
  deriveOpeningBalanceReadiness,
  type OpeningBalanceBlocker,
} from '@/lib/inventory/opening-balance-readiness'
import {
  transactionsGateFor,
  deriveOpeningBalanceReviewState,
} from '@/lib/inventory/opening-balance-workflow-guard'
import {
  blockerShortName,
  type OpeningBalanceBlockerDetail,
} from '@/lib/inventory/opening-balance-blockers'
import {
  CARRY_FORWARD_BLOCKED_EXPLANATION,
  carryForwardBlockedOrderItemIds,
  d2hCarryForwardStatus,
  d2hContinueGate,
  mapOpeningBalanceError,
  type CarryForwardAffectedItem,
  type CarryForwardEligibilityMap,
  type D2hCarryForwardStatus,
} from '@/lib/inventory/opening-balance-carry-forward-preflight'
import {
  h2mContinueGate,
  h2mDecisionState,
  h2mOrderEligibility,
  type H2mAffectedItem,
  type H2mIncomingEligibilityMap,
  type H2mOrderEligibility,
} from '@/lib/inventory/opening-balance-h2m-preflight'
import type {
  H2mPreflightErrorCategory,
} from '@/lib/inventory/opening-balance-h2m-preflight-server'
import {
  parseH2mBulkSummary,
  type H2mBulkAction,
} from '@/lib/inventory/opening-balance-h2m-bulk'
import {
  D2H_POLICY_DESCRIPTIONS,
  D2H_POLICY_LABELS,
  parseD2hPolicySummary,
  type D2hPolicy,
} from '@/lib/inventory/opening-balance-d2h-policy'
import {
  H2M_POLICY_DESCRIPTIONS,
  H2M_POLICY_LABELS,
  parseH2mPolicySummary,
  type H2mPolicy,
} from '@/lib/inventory/opening-balance-h2m-policy'
import {
  TRANSACTIONS_FILTERS,
  TRANSACTIONS_POLICY_DESCRIPTIONS,
  TRANSACTIONS_POLICY_HEADING,
  TRANSACTIONS_POLICY_LABELS,
  TRANSACTIONS_POLICY_ORDER,
  TRANSACTIONS_REVIEW_CHECKBOX_HINT,
  TRANSACTION_TYPE_LABELS,
  deriveEffectiveCarried,
  parseTransactionsPolicySummary,
  serializeCarriedRefs,
  type TransactionRef,
  type TransactionsFilter,
  type TransactionsPolicy,
} from '@/lib/inventory/opening-balance-transactions-policy'
import { withStockStrengthUnit } from '@/lib/inventory/stock-config-unit-label'

interface Props {
  userProfile: any
  sessionId: string | null
  warehouseOrganizationId: string
  /** Human-readable warehouse name (never the raw UUID). */
  warehouseName?: string
  /** Human-readable draft reference, e.g. "OB-20260727" (never the raw UUID). */
  draftReference?: string
  productCategoryId: string
  productCategoryName: string
  countsReady: boolean
  savedDraftSignature: string
  openingBalancePosted: boolean
  /** Another resumable active draft for this warehouse/category, if any. */
  activeDraft?: {
    sessionId: string
    referenceName: string
    createdAt?: string | null
    progressLabel: string
  } | null
  onReturnToActiveDraft?: (sessionId: string) => void
  onCreateNewOpeningBalance?: () => void
  onCancelled?: () => void | Promise<void>
  onPosted?: () => void | Promise<void>
}

const localDateTime = () => {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const num = (value: unknown) => Number(value || 0).toLocaleString()

const READINESS_BADGE: Record<string, string> = {
  Ready: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  Completed: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  'Action Required': 'bg-amber-100 text-amber-800 border border-amber-200',
  Blocked: 'bg-red-100 text-red-800 border border-red-200',
}

interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  disabled?: boolean
  onViewAffected?: () => void
  onViewBlocked?: () => void
  onConfirm: () => void | Promise<void>
}

export default function InventoryOpeningCutoffSection({
  userProfile,
  sessionId,
  warehouseOrganizationId,
  warehouseName,
  draftReference,
  productCategoryId,
  productCategoryName,
  countsReady,
  savedDraftSignature,
  openingBalancePosted,
  activeDraft = null,
  onReturnToActiveDraft,
  onCreateNewOpeningBalance,
  onCancelled,
  onPosted,
}: Props) {
  const { supabase, isReady } = useSupabaseAuth()
  const { toast } = useToast()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cutoff, setCutoff] = useState<any | null>(null)
  const [reports, setReports] = useState<any[]>([])
  const [proposedAt, setProposedAt] = useState(localDateTime)
  const [report, setReport] = useState<CutoffReport | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [otp, setOtp] = useState('')
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  // --- Protected cancellation state -----------------------------------------
  // Cancel Entire Opening Balance Exercise is a dangerous, separate flow kept
  // under a collapsed Danger Zone. A single click never cancels: it opens a
  // confirmation that requires a reason and the exact draft reference name.
  const [dangerZoneOpen, setDangerZoneOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelConfirmText, setCancelConfirmText] = useState('')
  const [showCancelledDetail, setShowCancelledDetail] = useState(false)
  const cancelSubmitRef = useRef(false)

  // --- Posting Note (stock_count_sessions.notes) -----------------------------
  // Required by prepare_stock_count_verification / preflight whenever any
  // counted row has a non-zero adjustment_quantity. Kept in local state so
  // preview refreshes and Back/return never erase in-progress text.
  const [postingNote, setPostingNote] = useState('')
  const [postingNoteError, setPostingNoteError] = useState<string | null>(null)
  const [hasCountVariance, setHasCountVariance] = useState(false)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  // Correlation reference for the failed attempt, shown alongside the actionable
  // message so the operator can quote it to an administrator.
  const [verificationErrorReference, setVerificationErrorReference] = useState<string | null>(null)
  // Set only when the server says the verification request itself is spent
  // (used / expired / snapshot changed / already posted). The OTP input is then
  // withdrawn so a consumed or invalid code can never be re-submitted.
  const [otpRequiresRefresh, setOtpRequiresRefresh] = useState(false)
  const postingNoteDirtyRef = useRef(false)
  const postingNoteLoadedForRef = useRef<string | null>(null)
  const postingNoteInputRef = useRef<HTMLTextAreaElement | null>(null)
  const otpRequestInFlightRef = useRef(false)
  const otpVerifyInFlightRef = useRef(false)

  // --- Wizard-only presentation state (never resets the fetched report) -------
  const [step, setStep] = useState<OpeningBalanceStepId>('freeze')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selectedH2m, setSelectedH2m] = useState<Set<string>>(() => new Set())
  const [selectedD2h, setSelectedD2h] = useState<Set<string>>(() => new Set())
  const [d2hSelectedOnly, setD2hSelectedOnly] = useState(false)
  /** UI-only Option B draft. Cleared when switching to Option A or after save. */
  const [d2hReviewDraft, setD2hReviewDraft] = useState(false)
  const [d2hPolicyBusy, setD2hPolicyBusy] = useState(false)
  const d2hPolicyRef = useRef(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<WorkspaceFilter>('all')
  const [showHistoricalD2h, setShowHistoricalD2h] = useState(false)
  const [showSafeTx, setShowSafeTx] = useState(false)
  const [showHistoryTx, setShowHistoryTx] = useState(false)
  const [showExcludedD2hTx, setShowExcludedD2hTx] = useState(false)
  // --- Transactions policy (Step 4) presentation state ----------------------
  /** `${type}:${id}` keys checked to Carry Forward under review_select. */
  const [selectedTx, setSelectedTx] = useState<Set<string>>(() => new Set())
  /** UI-only Review draft. Cleared when switching to Start Fresh / Carry All. */
  const [txReviewDraft, setTxReviewDraft] = useState(false)
  const [txPolicyBusy, setTxPolicyBusy] = useState(false)
  const txPolicyRef = useRef(false)
  const [txFilter, setTxFilter] = useState<TransactionsFilter>('all')
  const [showExcludedTx, setShowExcludedTx] = useState(false)
  const [expandedTx, setExpandedTx] = useState<Set<string>>(() => new Set())
  // Blocker the operator was guided here to resolve (from Review & Post). Drives
  // the Step 4 auto-open, scroll-to, highlight and the "you were brought here…"
  // banner. `fromReview` distinguishes a guided arrival from a manual step click.
  const [focusBlocker, setFocusBlocker] = useState<{ id: string; step: OpeningBalanceStepId; fromReview: boolean } | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  // "View Unresolved Order" opens this list of every unresolved blocker (details
  // + jump-to). The allocation resolver confirmation (reason + explicit action)
  // opens the `resolveTarget` dialog.
  const [blockerListOpen, setBlockerListOpen] = useState(false)
  const [resolveTarget, setResolveTarget] = useState<
    { blocker: OpeningBalanceBlockerDetail; action: 'exclude_and_release' | 'mark_manual_investigation' } | null
  >(null)
  const [resolveReason, setResolveReason] = useState('')
  const [resolveBusy, setResolveBusy] = useState(false)
  // Synchronous re-entrancy guard for the footer save/advance action. React
  // re-renders (and so disables the button) a tick after `setSaving(true)`, so a
  // second click fired in the same tick would otherwise slip through; the ref
  // blocks it immediately, guaranteeing one save request and one navigation.
  const savingRef = useRef(false)
  // Covers both order-level and line-level writes. Unlike React state, this is
  // synchronous, so two clicks in the same tick cannot submit duplicate RPCs.
  const decisionWriteRef = useRef(false)

  // --- Read-only Carry Forward preflight state -------------------------------
  // `cfEligibility` maps order_item_id → authoritative Carry Forward readiness,
  // resolved server-side by the read-only preflight route. `preflightRef` blocks
  // simultaneous rechecks so rapid clicks cannot duplicate the read-only request.
  const [cfEligibility, setCfEligibility] = useState<CarryForwardEligibilityMap>({})
  const [preflightBusy, setPreflightBusy] = useState(false)
  const preflightRef = useRef(false)
  const [h2mEligibility, setH2mEligibility] = useState<H2mIncomingEligibilityMap>({})
  const [h2mPreflightBusy, setH2mPreflightBusy] = useState(false)
  const [h2mPreflightError, setH2mPreflightError] = useState<{
    category: H2mPreflightErrorCategory
    message: string
    correlationId?: string
  } | null>(null)
  const h2mPreflightRef = useRef(false)
  const h2mAutoPreflightKeyRef = useRef('')
  const [h2mBulkBusy, setH2mBulkBusy] = useState(false)
  const h2mBulkRef = useRef(false)
  const [h2mSelectedOnly, setH2mSelectedOnly] = useState(false)
  const [h2mReviewDraft, setH2mReviewDraft] = useState(false)
  const [h2mPolicyBusy, setH2mPolicyBusy] = useState(false)
  const h2mPolicyRef = useRef(false)
  const [showHistoricalH2m, setShowHistoricalH2m] = useState(false)

  const isHqAdmin = userProfile?.organizations?.org_type_code === 'HQ'
    && Number(userProfile?.roles?.role_level) <= 10
  const activeCutoff = cutoff?.status === 'counting' ? cutoff : null

  // User-facing labels. Raw UUIDs (session/warehouse/category) are kept only for
  // routing and API calls; they are never rendered. When a name cannot be
  // resolved we show a neutral fallback rather than leaking an internal ID.
  const warehouseLabel = warehouseName?.trim() || 'Warehouse unavailable'
  const categoryLabel = report?.product_category_name?.trim()
    || productCategoryName?.trim()
    || 'Category unavailable'
  const draftLabel = draftReference?.trim() || 'Opening Balance Draft'

  const load = useCallback(async () => {
    if (!isReady) return
    if (!sessionId) {
      setCutoff(null)
      setReports([])
      setReport(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const cutoffResult = await (supabase as any).from('inventory_opening_cutoffs')
          .select('id,status,stock_count_session_id,warehouse_organization_id,proposed_cutoff_at,posted_at,created_at')
          .eq('stock_count_session_id', sessionId)
          .maybeSingle()
      if (cutoffResult.error) throw cutoffResult.error
      setCutoff(cutoffResult.data || null)
      if (cutoffResult.data?.id) {
        const reportResult = await (supabase as any).from('inventory_cutoff_reports')
          .select('id,cutoff_id,readiness,report_payload,generated_at')
          .eq('cutoff_id', cutoffResult.data.id)
          .order('generated_at', { ascending: false })
        if (reportResult.error) throw reportResult.error
        setReports(reportResult.data || [])
        if (cutoffResult.data.status === 'posted' && reportResult.data?.[0]?.report_payload) {
          setReport(reportResult.data[0].report_payload)
        }
      } else {
        setReports([])
      }
    } catch (error: any) {
      toast({ title: 'Cut-off data unavailable', description: error.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [isReady, sessionId, supabase, toast])

  useEffect(() => { void load() }, [load])

  // Load the persisted Posting Note and authoritative variance flag once per
  // session. Never overwrite local edits after the operator has typed.
  useEffect(() => {
    if (!isReady || !sessionId) return
    if (postingNoteLoadedForRef.current === sessionId) return
    postingNoteLoadedForRef.current = sessionId
    let cancelled = false
    void (async () => {
      try {
        const [sessionResult, itemsResult] = await Promise.all([
          (supabase as any)
            .from('stock_count_sessions')
            .select('notes')
            .eq('id', sessionId)
            .maybeSingle(),
          (supabase as any)
            .from('stock_count_session_items')
            .select('adjustment_quantity')
            .eq('session_id', sessionId),
        ])
        if (cancelled) return
        if (!postingNoteDirtyRef.current) {
          setPostingNote(String(sessionResult.data?.notes || ''))
        }
        const items = Array.isArray(itemsResult.data) ? itemsResult.data : []
        setHasCountVariance(items.some((item: any) => Number(item.adjustment_quantity || 0) !== 0))
      } catch {
        // Variance/note load failure must not break the wizard; OTP request will
        // still be validated authoritatively by the server preflight.
      }
    })()
    return () => { cancelled = true }
  }, [isReady, sessionId, supabase])

  // Keep the variance indicator aligned with the latest preview inventory when
  // available, without clearing the operator-entered Posting Note.
  useEffect(() => {
    const inventory = report?.inventory
    if (!Array.isArray(inventory) || inventory.length === 0) return
    const previewVariance = inventory.some((row: any) => Number(row.variance || 0) !== 0)
    if (previewVariance) setHasCountVariance(true)
  }, [report?.inventory])

  const persistPostingNote = useCallback(async (): Promise<string> => {
    if (!sessionId) throw new Error('Save the Opening Balance draft before requesting OTP.')
    const normalized = normalizeStockCountPostingNote(postingNote)
    const { error } = await (supabase as any)
      .from('stock_count_sessions')
      .update({
        notes: normalized || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('status', 'draft')
    if (error) throw error
    return normalized
  }, [postingNote, sessionId, supabase])

  // Returns the freshly-fetched report so callers (e.g. the Continue handler) can
  // recompute the authoritative gate from the SAME data that was just stored —
  // one atomic refetch, no stale ref/closure.
  const preview = useCallback(async (cutoffId = activeCutoff?.id): Promise<CutoffReport | null> => {
    if (!cutoffId) return null
    setBusy(true)
    try {
      const { data, error } = await (supabase as any).rpc('inventory_cutoff_preview', { p_cutoff_id: cutoffId })
      if (error) throw error
      setReport(data as CutoffReport)
      return data as CutoffReport
    } catch (error: any) {
      toast({ title: 'Preview failed', description: error.message, variant: 'destructive' })
      return null
    } finally {
      setBusy(false)
    }
  }, [activeCutoff?.id, supabase, toast])

  // Guards the initial auto-preview so it dispatches at most once per cut-off id.
  // Without it, React 18 StrictMode double-invokes this effect on mount (and any
  // re-render that keeps `report` null re-runs it), firing the preview RPC — and,
  // when it fails, the "Preview failed" toast — twice for a single load. The
  // guard is keyed by cut-off id so a genuinely new cut-off still auto-previews,
  // and explicit `preview()` calls after user actions still surface their own
  // independent errors.
  const autoPreviewRef = useRef<string | null>(null)
  useEffect(() => {
    const id = activeCutoff?.id
    if (id && !report && autoPreviewRef.current !== id) {
      autoPreviewRef.current = id
      void preview(id)
    }
  }, [activeCutoff?.id, preview, report])

  /**
   * READ-ONLY Carry Forward preflight. Asks the authoritative server resolver
   * whether each submitted D2H variant has a valid 20ml New Box target
   * configuration at the counted warehouse. It records no decision and mutates
   * nothing; the `preflightRef` guard makes rapid re-checks idempotent (one
   * in-flight request at a time). A failure is non-fatal — the server still
   * re-validates on Apply — so it only warns and leaves prior results intact.
   */
  const runCarryForwardPreflight = useCallback(async (orderItemIds: string[]) => {
    if (!activeCutoff?.id || orderItemIds.length === 0) return
    if (preflightRef.current) return
    preflightRef.current = true
    setPreflightBusy(true)
    try {
      const response = await fetch('/api/inventory/opening-balance/carry-forward-preflight', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ cutoffId: activeCutoff.id, orderItemIds }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Carry Forward check failed')
      // Replace the snapshot rather than merging it: a successful recheck must
      // clear stale failures and removed order items immediately.
      setCfEligibility(body.eligibility || {})
    } catch (error: any) {
      toast({ title: 'Carry Forward check unavailable', description: error.message, variant: 'destructive' })
    } finally {
      preflightRef.current = false
      setPreflightBusy(false)
    }
  }, [activeCutoff?.id, toast])

  const runH2mIncomingPreflight = useCallback(async (orderItemIds: string[]) => {
    if (!activeCutoff?.id || orderItemIds.length === 0) return
    if (h2mPreflightRef.current) return
    h2mPreflightRef.current = true
    setH2mPreflightBusy(true)
    try {
      const response = await fetch('/api/inventory/opening-balance/h2m-incoming-preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ cutoffId: activeCutoff.id, orderItemIds }),
      })
      const body = await response.json().catch(() => null)
      if (!body || typeof body !== 'object') {
        throw Object.assign(new Error('The H2M readiness service returned an invalid response.'), {
          category: 'h2m_preflight_invalid_response' as H2mPreflightErrorCategory,
        })
      }
      if (!response.ok) {
        throw Object.assign(new Error(body.error || 'H2M Incoming check failed'), {
          category: (body.category || 'h2m_preflight_failed') as H2mPreflightErrorCategory,
          correlationId: body.correlationId,
        })
      }
      if (!body.eligibility || typeof body.eligibility !== 'object') {
        throw Object.assign(new Error('The H2M readiness service returned an invalid response.'), {
          category: 'h2m_preflight_invalid_response' as H2mPreflightErrorCategory,
          correlationId: body.correlationId,
        })
      }
      setH2mEligibility(body.eligibility || {})
      setH2mPreflightError(null)
    } catch (error: any) {
      // A failed current-data check invalidates the old snapshot. Unknown or
      // stale readiness must never leave Incoming enabled.
      setH2mEligibility({})
      const category = (error?.category || 'h2m_preflight_failed') as H2mPreflightErrorCategory
      const failure = {
        category,
        message: error?.message || 'The H2M readiness check failed unexpectedly.',
        correlationId: error?.correlationId as string | undefined,
      }
      setH2mPreflightError(failure)
      toast({
        title: category === 'h2m_cutoff_not_ready'
          ? 'H2M Incoming check not ready'
          : category === 'h2m_preflight_unauthorized'
            ? 'H2M Incoming check not authorized'
            : 'H2M Incoming check unavailable',
        description: failure.message,
        variant: 'destructive',
      })
    } finally {
      h2mPreflightRef.current = false
      setH2mPreflightBusy(false)
    }
  }, [activeCutoff?.id, toast])

  const openH2mBulkConfirmation: (
    action: H2mBulkAction,
    orderIds: string[],
  ) => Promise<void> = useCallback(async (
    action: H2mBulkAction,
    orderIds: string[],
  ) => {
    if (!activeCutoff?.id || h2mBulkRef.current) return
    h2mBulkRef.current = true
    setH2mBulkBusy(true)
    try {
      const response = await fetch('/api/inventory/opening-balance/h2m-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ cutoffId: activeCutoff.id, action, orderIds }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw Object.assign(
          new Error(body?.error || 'Current H2M bulk scope could not be checked.'),
          { category: body?.category },
        )
      }
      const summary = parseH2mBulkSummary(body)
      const currentGroups = groupManufacturerOrders(
        (report?.manufacturer_incoming ?? []) as ManufacturerLine[],
      )
      const actionLabel = action === 'selected_incoming'
        ? 'Incoming After Cut-off'
        : 'Not Incoming'
      const requestKey = crypto.randomUUID()
      const selectedOrderIds = [...orderIds]
      const showOrders = (ids: string[]) => {
        const keys = currentGroups
          .filter(group => ids.includes(group.orderId))
          .map(group => group.key)
        setExpanded(prev => new Set([...prev, ...keys]))
      }
      setConfirm({
        title: action === 'all_remaining_not_incoming'
          ? 'Mark all remaining H2M items as Not Incoming?'
          : `Mark selected H2M orders as ${actionLabel}?`,
        description:
          `${summary.eligibleItemCount} unresolved actionable item(s) across ${summary.affectedOrderCount} order(s) will be marked ${actionLabel} for ${summary.productCategoryName}. ` +
          `${summary.resolvedItemCount} previously resolved item(s) will remain unchanged, including ${summary.savedIncomingCount} saved Incoming and ${summary.savedNotIncomingCount} saved Not Incoming. ` +
          `${summary.blockedItemCount} blocked item(s) will remain unresolved.` +
          (summary.eligibleItemCount === 0 ? ' Nothing can be applied because no currently eligible unresolved items match this action.' : ''),
        confirmLabel: summary.eligibleItemCount === 0 ? 'Nothing to Apply' : 'Confirm and Apply',
        disabled: summary.eligibleItemCount === 0,
        onViewAffected: () => {
          showOrders(summary.eligibleOrderIds)
          setConfirm(null)
        },
        onViewBlocked: summary.blockedItemCount > 0
          ? () => {
              const blocked = new Set(summary.blockedItemIds)
              showOrders(currentGroups
                .filter(group => group.lines.some(line => line.order_item_id && blocked.has(line.order_item_id)))
                .map(group => group.orderId))
              setConfirm(null)
            }
          : undefined,
        onConfirm: async () => {
          if (h2mBulkRef.current || summary.eligibleItemCount === 0) return
          h2mBulkRef.current = true
          setH2mBulkBusy(true)
          try {
            const applyResponse = await fetch('/api/inventory/opening-balance/h2m-bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({
                cutoffId: activeCutoff.id,
                action,
                orderIds: selectedOrderIds,
                confirmationFingerprint: summary.confirmationFingerprint,
                idempotencyKey: requestKey,
                apply: true,
              }),
            })
            const applied = await applyResponse.json().catch(() => null)
            if (!applyResponse.ok) {
              if (applyResponse.status === 409) {
                toast({ title: 'H2M counts changed', description: applied?.error, variant: 'destructive' })
                h2mBulkRef.current = false
                setH2mBulkBusy(false)
                await openH2mBulkConfirmation(action, selectedOrderIds)
                return
              }
              throw Object.assign(
                new Error(applied?.error || 'The H2M decisions were not applied.'),
                { category: applied?.category },
              )
            }
            await preview(activeCutoff.id)
            setSelectedH2m(new Set())
            toast({
              title: 'H2M decisions applied',
              description: `${Number(applied?.applied_item_count || summary.eligibleItemCount)} item(s) updated atomically.`,
            })
          } catch (error: any) {
            toast({
              title: error?.category === 'h2m_bulk_resolver_unavailable'
                ? 'H2M database update required'
                : 'H2M decisions not applied',
              description: error.message,
              variant: 'destructive',
            })
          } finally {
            h2mBulkRef.current = false
            setH2mBulkBusy(false)
          }
        },
      })
    } catch (error: any) {
      toast({
        title: error?.category === 'h2m_bulk_resolver_unavailable'
          ? 'H2M database update required'
          : 'H2M bulk check unavailable',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      h2mBulkRef.current = false
      setH2mBulkBusy(false)
    }
  }, [activeCutoff?.id, preview, report, toast])

  const openD2hPolicyConfirmation = useCallback(async (
    policy: D2hPolicy,
    orderIds: string[],
  ) => {
    if (!activeCutoff?.id || d2hPolicyRef.current) return
    d2hPolicyRef.current = true
    setD2hPolicyBusy(true)
    try {
      const response = await fetch('/api/inventory/opening-balance/d2h-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ cutoffId: activeCutoff.id, policy, orderIds }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw Object.assign(
          new Error(body?.error || 'Current D2H policy scope could not be checked.'),
          { category: body?.category },
        )
      }
      const summary = parseD2hPolicySummary(body)
      const title = D2H_POLICY_LABELS[policy]
      const description = policy === 'exclude_all'
        ? `${summary.notice}\n\nNo orders will be cancelled or deleted.\nNo historical stock will be returned to inventory.\nThe Opening Balance will not be cancelled by saving this policy.`
        : [
            summary.notice,
            `Selected: ${summary.selectedOrderCount} order(s) · ${num(summary.selectedQuantity)} units will receive a new allocation baseline under Opening Balance (historical order_fulfillment is never replayed).`,
            `Excluded: ${summary.excludedOrderCount} order(s) remain historical with no new inventory impact.`,
            summary.blockedOrderCount > 0
              ? `${summary.blockedOrderCount} selected order(s) are blocked and must be cleared before saving.`
              : 'No orders will be cancelled or deleted by this save.',
          ].join('\n\n')

      setConfirm({
        title,
        description,
        confirmLabel: policy === 'exclude_all' ? 'Save Start Fresh policy' : 'Save D2H selection',
        disabled: summary.blockedOrderCount > 0,
        onConfirm: async () => {
          d2hPolicyRef.current = true
          setD2hPolicyBusy(true)
          try {
            const applyResponse = await fetch('/api/inventory/opening-balance/d2h-policy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({
                cutoffId: activeCutoff.id,
                policy,
                orderIds,
                apply: true,
                confirmationFingerprint: summary.confirmationFingerprint,
                idempotencyKey: crypto.randomUUID(),
              }),
            })
            const applied = await applyResponse.json().catch(() => null)
            if (!applyResponse.ok) {
              if (applied?.category === 'd2h_policy_stale_confirmation') {
                await openD2hPolicyConfirmation(policy, orderIds)
                return
              }
              throw Object.assign(
                new Error(applied?.error || 'The D2H policy was not saved.'),
                { category: applied?.category },
              )
            }
            await preview(activeCutoff.id)
            setSelectedD2h(new Set())
            setD2hReviewDraft(policy === 'review_select')
            toast({
              title: 'D2H policy saved',
              description: summary.notice,
            })
          } catch (error: any) {
            toast({
              title: error?.category === 'd2h_policy_resolver_unavailable'
                ? 'D2H database update required'
                : 'D2H policy not saved',
              description: error.message,
              variant: 'destructive',
            })
          } finally {
            d2hPolicyRef.current = false
            setD2hPolicyBusy(false)
          }
        },
      })
    } catch (error: any) {
      toast({
        title: error?.category === 'd2h_policy_resolver_unavailable'
          ? 'D2H database update required'
          : 'D2H policy check unavailable',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      d2hPolicyRef.current = false
      setD2hPolicyBusy(false)
    }
  }, [activeCutoff?.id, preview, toast])

  const openTransactionsPolicyConfirmation = useCallback(async (
    policy: TransactionsPolicy,
    carriedRefs: TransactionRef[],
  ) => {
    if (!activeCutoff?.id || txPolicyRef.current) return
    txPolicyRef.current = true
    setTxPolicyBusy(true)
    const refs = serializeCarriedRefs(policy === 'review_select' ? carriedRefs : [])
    try {
      const response = await fetch('/api/inventory/opening-balance/transactions-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ cutoffId: activeCutoff.id, policy, carriedRefs: refs }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw Object.assign(
          new Error(body?.error || 'Current Transactions policy scope could not be checked.'),
          { category: body?.category },
        )
      }
      const summary = parseTransactionsPolicySummary(body)
      const title = TRANSACTIONS_POLICY_LABELS[policy]
      const description = [
        summary.notice,
        `Inventory impact during Opening Balance: 0. No stock movements are created, no processed quantity is replayed.`,
        summary.blockedCount > 0
          ? `${summary.blockedCount} transaction(s) require individual resolution and are never carried by policy.`
          : 'No transaction will be cancelled, deleted, or have its status changed by this save.',
      ].join('\n\n')

      setConfirm({
        title,
        description,
        confirmLabel: policy === 'exclude_all'
          ? 'Save Start Fresh policy'
          : policy === 'carry_forward_all'
            ? 'Save Carry Forward policy'
            : 'Save Review selection',
        onConfirm: async () => {
          txPolicyRef.current = true
          setTxPolicyBusy(true)
          try {
            const applyResponse = await fetch('/api/inventory/opening-balance/transactions-policy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({
                cutoffId: activeCutoff.id,
                policy,
                carriedRefs: refs,
                apply: true,
                confirmationFingerprint: summary.confirmationFingerprint,
                idempotencyKey: crypto.randomUUID(),
              }),
            })
            const applied = await applyResponse.json().catch(() => null)
            if (!applyResponse.ok) {
              if (applied?.category === 'transactions_policy_stale_confirmation') {
                await openTransactionsPolicyConfirmation(policy, carriedRefs)
                return
              }
              throw Object.assign(
                new Error(applied?.error || 'The Transactions policy was not saved.'),
                { category: applied?.category },
              )
            }
            await preview(activeCutoff.id)
            setSelectedTx(new Set())
            setTxReviewDraft(policy === 'review_select')
            toast({ title: 'Transactions policy saved', description: summary.notice })
          } catch (error: any) {
            toast({
              title: error?.category === 'transactions_policy_resolver_unavailable'
                ? 'Transactions database update required'
                : 'Transactions policy not saved',
              description: error.message,
              variant: 'destructive',
            })
          } finally {
            txPolicyRef.current = false
            setTxPolicyBusy(false)
          }
        },
      })
    } catch (error: any) {
      toast({
        title: error?.category === 'transactions_policy_resolver_unavailable'
          ? 'Transactions database update required'
          : 'Transactions policy check unavailable',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      txPolicyRef.current = false
      setTxPolicyBusy(false)
    }
  }, [activeCutoff?.id, preview, toast])

  const openH2mPolicyConfirmation = useCallback(async (
    policy: H2mPolicy,
    orderIds: string[],
  ) => {
    if (!activeCutoff?.id || h2mPolicyRef.current) return
    h2mPolicyRef.current = true
    setH2mPolicyBusy(true)
    try {
      const response = await fetch('/api/inventory/opening-balance/h2m-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ cutoffId: activeCutoff.id, policy, orderIds }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw Object.assign(
          new Error(body?.error || 'Current H2M policy scope could not be checked.'),
          { category: body?.category },
        )
      }
      const summary = parseH2mPolicySummary(body)
      const title = H2M_POLICY_LABELS[policy]
      const description = policy === 'exclude_all'
        ? `${summary.notice}\n\nNo H2M orders will be cancelled or deleted.\nOpening Balance posting adds zero H2M quantity.\nThe Opening Balance will not be cancelled by saving this policy.`
        : [
            summary.notice,
            `Selected: ${summary.selectedOrderCount} order(s) · ${num(summary.selectedOutstandingQuantity)} outstanding units remain Expected Incoming (informational only during Opening Balance).`,
            `Excluded: ${summary.excludedOrderCount} order(s) remain historical.`,
            summary.blockedOrderCount > 0
              ? `${summary.blockedOrderCount} selected order(s) are blocked and must be cleared before saving.`
              : 'No H2M quantity is added during Opening Balance posting.',
          ].join('\n\n')

      setConfirm({
        title,
        description,
        confirmLabel: policy === 'exclude_all' ? 'Save Start Fresh policy' : 'Save H2M Decision',
        disabled: summary.blockedOrderCount > 0,
        onConfirm: async () => {
          h2mPolicyRef.current = true
          setH2mPolicyBusy(true)
          try {
            const applyResponse = await fetch('/api/inventory/opening-balance/h2m-policy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({
                cutoffId: activeCutoff.id,
                policy,
                orderIds,
                apply: true,
                confirmationFingerprint: summary.confirmationFingerprint,
                idempotencyKey: crypto.randomUUID(),
              }),
            })
            const applied = await applyResponse.json().catch(() => null)
            if (!applyResponse.ok) {
              if (applied?.category === 'h2m_policy_stale_confirmation') {
                await openH2mPolicyConfirmation(policy, orderIds)
                return
              }
              throw Object.assign(
                new Error(applied?.error || 'The H2M policy was not saved.'),
                { category: applied?.category },
              )
            }
            await preview(activeCutoff.id)
            setSelectedH2m(new Set())
            setH2mReviewDraft(policy === 'review_select')
            toast({
              title: 'H2M policy saved',
              description: summary.notice,
            })
          } catch (error: any) {
            toast({
              title: error?.category === 'h2m_policy_resolver_unavailable'
                ? 'H2M database update required'
                : 'H2M policy not saved',
              description: error.message,
              variant: 'destructive',
            })
          } finally {
            h2mPolicyRef.current = false
            setH2mPolicyBusy(false)
          }
        },
      })
    } catch (error: any) {
      toast({
        title: error?.category === 'h2m_policy_resolver_unavailable'
          ? 'H2M database update required'
          : 'H2M policy check unavailable',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      h2mPolicyRef.current = false
      setH2mPolicyBusy(false)
    }
  }, [activeCutoff?.id, preview, toast])

  const startCutoff = async () => {
    if (!sessionId || !countsReady) return
    setBusy(true)
    try {
      const { error } = await (supabase as any).rpc('start_inventory_opening_cutoff', {
        p_session_id: sessionId,
        p_proposed_cutoff_at: new Date(proposedAt).toISOString(),
      })
      if (error) throw error
      toast({ title: 'Opening count activated', description: 'Warehouse inventory operations are now frozen.' })
      setReport(null)
      await load()
    } catch (error: any) {
      toast({ title: 'Could not start cut-off', description: error.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  // Protected cancellation of the entire exercise (not OTP step / Back).
  // Only ever invoked from the confirmation modal's final button.
  const cancelCutoff = async () => {
    if (!activeCutoff || !cancelReason.trim()) return
    if (cancelConfirmText.trim() !== draftLabel) return
    if (!isHqAdmin) return
    if (cancelSubmitRef.current) return
    cancelSubmitRef.current = true
    setBusy(true)
    try {
      const { error } = await (supabase as any).rpc('cancel_inventory_opening_cutoff', {
        p_cutoff_id: activeCutoff.id,
        p_reason: cancelReason.trim(),
      })
      if (error) throw error
      toast({
        title: 'Opening Balance cancelled',
        description: 'The warehouse has been reopened. The cancelled exercise is retained as read-only history.',
      })
      setCancelModalOpen(false)
      setCancelConfirmText('')
      setCancelReason('')
      setDangerZoneOpen(false)
      setReport(null)
      await load()
      await onCancelled?.()
    } catch (error: any) {
      toast({ title: 'Could not cancel Opening Balance', description: error.message, variant: 'destructive' })
    } finally {
      cancelSubmitRef.current = false
      setBusy(false)
    }
  }

  const decide = async (
    orderItemId: string,
    decision: CutoffDecision,
    context?: { orderNumber?: string; variant?: string; warehouse?: string },
  ) => {
    if (!activeCutoff || decisionWriteRef.current) return
    decisionWriteRef.current = true
    setBusy(true)
    try {
      const { error } = await (supabase as any).rpc('set_inventory_cutoff_decision', {
        p_cutoff_id: activeCutoff.id, p_order_item_id: orderItemId, p_decision: decision,
      })
      if (error) throw error
      await preview(activeCutoff.id)
    } catch (error: any) {
      // The server remains authoritative: on a stale/race rejection we keep the
      // rejection, translate it to guidance, and refresh the read-only readiness
      // — we never silently substitute another decision.
      const mapped = mapOpeningBalanceError(error, context)
      toast({ title: mapped.title, description: mapped.message, variant: 'destructive' })
      if (activeCutoff?.id) {
        void runCarryForwardPreflight(d2hOrderItemIds)
        void runH2mIncomingPreflight(h2mOrderItemIds)
      }
    } finally {
      decisionWriteRef.current = false
      setBusy(false)
    }
  }

  /**
   * Apply one decision to a pre-filtered, already-eligible list of order items.
   * The id list is computed by the pure `*BulkTargets` helpers, so an ineligible
   * or blocked line is never included. `decisionWriteRef` gates re-entry
   * synchronously, so rapid double clicks cannot apply the batch twice.
   */
  const applyBulk = useCallback(async (
    ids: string[],
    decision: CutoffDecision,
    context?: { orderNumber?: string; variant?: string; warehouse?: string },
  ) => {
    if (!activeCutoff || decisionWriteRef.current || ids.length === 0) return
    decisionWriteRef.current = true
    setBusy(true)
    try {
      for (const id of ids) {
        const { error } = await (supabase as any).rpc('set_inventory_cutoff_decision', {
          p_cutoff_id: activeCutoff.id, p_order_item_id: id, p_decision: decision,
        })
        if (error) throw error
      }
      await preview(activeCutoff.id)
      toast({ title: 'Decisions applied', description: `${ids.length} eligible line(s) updated.` })
    } catch (error: any) {
      // Authoritative server rejection (e.g. a config went missing between the
      // preflight and Apply): translate it, keep the rejection, refresh the
      // read-only readiness, and never save a different decision on the user's
      // behalf.
      const mapped = mapOpeningBalanceError(error, context)
      toast({ title: mapped.title, description: mapped.message, variant: 'destructive' })
      const orderItemIds = Array.from(
        new Set(
          ((report?.distributor_orders ?? []) as DistributorLine[])
            .filter(l => l.status === 'submitted' && l.order_item_id)
            .map(l => l.order_item_id as string),
        ),
      )
      void runCarryForwardPreflight(orderItemIds)
    } finally {
      decisionWriteRef.current = false
      setBusy(false)
    }
  }, [activeCutoff, supabase, toast, preview, report, runCarryForwardPreflight])

  const requestVerification = async () => {
    if (!activeCutoff || !sessionId) return
    if (otpRequestInFlightRef.current || busy) return

    // Client-side mirror of the server posting-note contract. Variance comes from
    // session items (authoritative) and/or preview inventory variance.
    const previewHasVariance = Array.isArray(report?.inventory)
      && report.inventory.some((row: any) => Number(row.variance || 0) !== 0)
    const varianceRequired = hasCountVariance || previewHasVariance
    if (varianceRequired && !isValidStockCountPostingNote(postingNote)) {
      const message = 'A Posting Note is required when the Stock Count contains variance.'
      setPostingNoteError(message)
      setVerificationError(message)
      postingNoteInputRef.current?.focus()
      postingNoteInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    otpRequestInFlightRef.current = true
    setBusy(true)
    setVerificationError(null)
    setVerificationErrorReference(null)
    setPostingNoteError(null)
    setOtpRequiresRefresh(false)
    setOtp('')
    try {
      // Persist notes onto stock_count_sessions before OTP — the request route /
      // prepare_stock_count_verification read session.notes; they do not accept
      // a note in the request body.
      await persistPostingNote()
      const response = await fetch('/api/inventory/stock-count/verification/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeCutoff.stock_count_session_id }),
      })
      const body = await response.json()
      if (!response.ok) {
        const message = formatStockCountClientError({
          message: body.error || 'Verification request failed',
          guidance: body.guidance,
        })
        setVerificationError(message)
        setVerificationErrorReference(body.reference || null)
        if (body.code === 'posting_note_required') {
          setPostingNoteError(message)
          postingNoteInputRef.current?.focus()
          postingNoteInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        throw new Error(message)
      }
      setRequestId(body.requestId)
      setOtpExpiresAt(body.expiresAt || null)
      toast({ title: 'Verification code sent', description: `Sent to ${body.recipients?.join(', ') || 'authorized recipients'}.` })
    } catch (error: any) {
      const message = error?.message || 'Verification request failed'
      setVerificationError(message)
      toast({ title: 'Verification unavailable', description: message, variant: 'destructive' })
    } finally {
      otpRequestInFlightRef.current = false
      setBusy(false)
    }
  }

  const execute = async () => {
    if (!activeCutoff || !requestId || !/^\d{8}$/.test(otp)) return
    // Re-entrancy guard: a second click before `busy` re-renders must never fire
    // a second post call. The ref flips synchronously, `setBusy` does not.
    if (otpVerifyInFlightRef.current || busy) return
    otpVerifyInFlightRef.current = true
    setBusy(true)
    setVerificationError(null)
    setVerificationErrorReference(null)
    setOtpRequiresRefresh(false)
    try {
      // Re-persist the note so a late edit before Verify still reaches the
      // posted audit trail (session.notes is what posting reads).
      await persistPostingNote()
      const response = await fetch('/api/inventory/stock-count/verification/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, sessionId: activeCutoff.stock_count_session_id, code: otp }),
      })
      const body = await response.json()
      if (!response.ok) {
        const message = formatStockCountClientError({
          message: body.error || 'Cut-off failed',
          guidance: body.guidance,
        })
        setVerificationError(message)
        setVerificationErrorReference(body.reference || null)
        // The whole post is one transaction: an ordinary rejection rolled
        // everything back and left the code usable. Only these codes mean the
        // request itself is spent — stop inviting the operator to re-enter it.
        if (requiresFreshStockCountVerification(body.code)) {
          setOtpRequiresRefresh(true)
          setRequestId('')
          setOtp('')
          setOtpExpiresAt(null)
        }
        // The Posting Note is deliberately NOT cleared here — a failed post must
        // preserve the operator's audit note for the retry.
        throw new Error(message)
      }
      // Success only after the authoritative DB transaction has committed: the
      // route returns the RPC payload only when it neither threw nor carried an
      // error_code, so reaching here means product_inventory, stock_movements,
      // session/cut-off status and the freeze release all committed together.
      toast({ title: 'Opening Balance posted', description: 'Opening inventory is official and the warehouse freeze has been removed.' })
      setRequestId(''); setOtp(''); setOtpExpiresAt(null); setReport(null)
      await load()
      await onPosted?.()
      // One authoritative invalidation for every other inventory reader
      // (View Inventory, summary cards, Movement Reports/History). Fired once,
      // after the commit — never polled.
      broadcastInventoryDataRefresh({
        reason: 'opening_balance_posted',
        warehouseOrganizationId: activeCutoff.warehouse_organization_id ?? null,
        referenceId: activeCutoff.stock_count_session_id ?? null,
      })
    } catch (error: any) {
      const message = error?.message || 'Cut-off failed'
      setVerificationError(message)
      toast({ title: 'Cut-off not posted', description: message, variant: 'destructive' })
    } finally {
      otpVerifyInFlightRef.current = false
      setBusy(false)
    }
  }

  const download = () => {
    if (!report) return
    const blob = new Blob([inventoryCutoffReportCsv(report)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `inventory-opening-cutoff-${report.cutoff_id}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const saveDraft = useCallback(async (advance?: OpeningBalanceStepId) => {
    // Re-entrancy guard: block a rapid second click before the disabled state
    // re-renders, so we never fire a duplicate save request or double-navigate.
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      // Every decision is already persisted server-side the instant it is picked,
      // so "saving" re-pulls the persisted preview to prove the draft reloads to
      // the correct state, then optionally advances the wizard once.
      // Refetch the authoritative preview ONCE and derive the gate from that exact
      // fresh report — the same helper the render memos use — so display and this
      // click can never disagree and no stale ref/closure is read.
      const fresh = activeCutoff?.id ? await preview(activeCutoff.id) : null
      toast({ title: 'Progress saved', description: 'Your decisions are stored on this Opening Balance draft.' })
      if (advance === 'review') {
        const state = fresh ? deriveOpeningBalanceReviewState(fresh, cutoff?.status) : null
        const gate = state ? transactionsGateFor(state.readiness, state.workspace) : null
        // A non-blocking 'Review Required' state (zero blockers, only advisories)
        // must NOT be treated as a blocker — historical-excluded / in-transit
        // advisories are reviewed on the next step; OTP/post accept Ready or
        // Review Required (Blocked only).
        if (!gate || !gate.canContinue) {
          toast({
            title: 'Resolve blockers first',
            description: gate?.message ?? 'Resolve the remaining transaction blockers before Review & Post.',
            variant: 'destructive',
          })
        } else {
          setStep('review')
        }
      } else if (advance) {
        setStep(advance)
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [activeCutoff?.id, preview, toast, cutoff?.status])

  // ---- Derived, memoized workspace views -----------------------------------
  const executable = canExecuteInventoryCutoff(report, isHqAdmin)
    && report?.cutoff_id === activeCutoff?.id

  const workspace = useMemo(
    () => (report ? deriveWorkspaceState({ ...report, status: cutoff?.status }) : null),
    [report, cutoff?.status],
  )
  const physicalSummary = workspace?.physicalQuantity ?? 0

  const d2hGroups = useMemo(
    () => groupDistributorOrders((report?.distributor_orders ?? []) as DistributorLine[]),
    [report],
  )
  const h2mGroups = useMemo(
    () => groupManufacturerOrders((report?.manufacturer_incoming ?? []) as ManufacturerLine[]),
    [report],
  )
  const selectableH2mOrderIds = useMemo(() => new Set(
    h2mGroups
      .filter(group => {
        const status = h2mOrderEligibility(group, h2mEligibility, warehouseLabel)
        return Boolean(group.orderId) && status.checked && status.unresolvedCount > 0 && status.blockedCount === 0
      })
      .map(group => group.orderId),
  ), [h2mEligibility, h2mGroups, warehouseLabel])
  useEffect(() => {
    setSelectedH2m(previous => {
      const next = new Set([...previous].filter(id => selectableH2mOrderIds.has(id)))
      return next.size === previous.size && [...next].every(id => previous.has(id)) ? previous : next
    })
  }, [selectableH2mOrderIds])
  const activityGroups = useMemo(
    () => groupWarehouseActivity(report?.warehouse_activity ?? []),
    [report],
  )
  const transactionsSummary = useMemo(
    () => summarizeWarehouseActivity(activityGroups.mustResolve),
    [activityGroups.mustResolve],
  )

  useEffect(() => {
    if (!activeCutoff?.id || !savedDraftSignature) return
    setReport(null)
    void preview(activeCutoff.id)
  }, [activeCutoff?.id, preview, savedDraftSignature])

  // Returning to this page after completing/cancelling an original transaction
  // must refresh the authoritative unresolved scope — preview stays read-only.
  useEffect(() => {
    if (!activeCutoff?.id || step !== 'transactions') return
    const refresh = () => {
      if (document.visibilityState === 'visible') void preview(activeCutoff.id)
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [activeCutoff?.id, preview, step])

  // Distinct submitted-D2H variant ids — the only variants a Carry Forward
  // preflight needs to resolve. A stable joined key drives the effect below.
  const d2hOrderItemIds = useMemo(() => {
    const ids = new Set<string>()
    for (const group of d2hGroups.actionable) {
      for (const line of group.lines) {
        if (line.status === 'submitted' && line.order_item_id) ids.add(line.order_item_id)
      }
    }
    return Array.from(ids).sort()
  }, [d2hGroups])
  const d2hOrderItemKey = d2hOrderItemIds.join(',')
  const h2mOrderItemIds = useMemo(() => {
    const ids = new Set<string>()
    for (const group of h2mGroups) {
      for (const line of group.lines) {
        if (
          line.order_item_id &&
          ['approved', 'closed'].includes(line.status ?? '') &&
          Number(line.remaining_incoming_quantity || 0) > 0
        ) {
          ids.add(line.order_item_id)
        }
      }
    }
    return Array.from(ids).sort()
  }, [h2mGroups])
  const h2mOrderItemKey = h2mOrderItemIds.join(',')

  // Run the read-only preflight when the workspace loads, when the submitted-D2H
  // variant set changes (a refresh / decision change), and when the user is on
  // the freeze overview or D2H step (so the early warning and per-order status
  // are always current). The `preflightRef` guard makes overlapping runs safe.
  useEffect(() => {
    if (!activeCutoff?.id || d2hOrderItemIds.length === 0) return
    if (step !== 'freeze' && step !== 'd2h') return
    void runCarryForwardPreflight(d2hOrderItemIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCutoff?.id, d2hOrderItemKey, step, savedDraftSignature])

  useEffect(() => {
    if (!activeCutoff?.id) return
    if (step !== 'freeze' && step !== 'h2m') return
    if (h2mOrderItemIds.length === 0) {
      setH2mEligibility({})
      setH2mPreflightError(null)
      return
    }
    const autoCheckKey = [
      activeCutoff.id,
      h2mOrderItemKey,
      savedDraftSignature,
    ].join(':')
    if (h2mAutoPreflightKeyRef.current === autoCheckKey) return
    h2mAutoPreflightKeyRef.current = autoCheckKey
    void runH2mIncomingPreflight(h2mOrderItemIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCutoff?.id, h2mOrderItemKey, step, savedDraftSignature])

  const cfBlockedOrderItemIds = useMemo(
    () => carryForwardBlockedOrderItemIds(cfEligibility),
    [cfEligibility],
  )
  const d2hGate = useMemo(() => d2hContinueGate(d2hGroups.actionable, {
    policyRequired: d2hGroups.actionable.length + d2hGroups.historical.length > 0,
    policyResolved: Boolean(workspace?.d2hPolicy?.policy),
    policy: workspace?.d2hPolicy?.policy ?? null,
  }), [d2hGroups, workspace?.d2hPolicy?.policy])
  const h2mGate = useMemo(
    () => h2mContinueGate(h2mGroups, h2mEligibility, warehouseLabel, {
      policyRequired: h2mGroups.length > 0,
      policyResolved: Boolean(workspace?.h2mPolicy?.policy),
      policy: workspace?.h2mPolicy?.policy ?? null,
    }),
    [h2mGroups, h2mEligibility, warehouseLabel, workspace?.h2mPolicy?.policy],
  )
  // Orders whose Carry Forward is config-blocked and still undecided (Step-1 count).
  const d2hConfigIssueCount = useMemo(
    () => d2hGroups.actionable.filter(g => d2hCarryForwardStatus(g, cfEligibility).blocked).length,
    [d2hGroups, cfEligibility],
  )

  // ---- The single authoritative readiness result ---------------------------
  // Server `report.readiness` is the source of truth. This one derivation drives
  // the readiness badge, the blocker count, the blocker detail list, the
  // "Ready to Post" panel and the final-posting copy — so they can never
  // contradict one another (the previous "All resolved" + "1 blocker(s)" bug).
  // The OTP button additionally requires HQ Admin + active freeze via `executable`.
  const readiness = useMemo(() => {
    if (!report || !workspace) return null
    const d2hPolicyResolved = Boolean(workspace.d2hPolicy?.policy)
    const h2mPolicyResolved = Boolean(workspace.h2mPolicy?.policy)
    return deriveOpeningBalanceReadiness({
      serverReadiness: report.readiness,
      serverBlockers: workspace.summary.blocked.messages,
      serverBlockerDetails: (report as { blocker_details?: unknown }).blocker_details,
      blockedDistributorRefs: [...new Set(workspace.summary.blocked.references)],
      d2hRequired: d2hGroups.actionable.length + d2hGroups.historical.length > 0,
      d2hPolicyResolved,
      d2hUndecidedLines: d2hPolicyResolved ? workspace.d2hRemaining : 0,
      h2mRequired: h2mGroups.length > 0,
      h2mPolicyResolved,
      h2mUndecidedLines: h2mPolicyResolved ? workspace.h2mRemaining : 0,
      transactionsRequired: Boolean(
        workspace.transactionsHistoricalSummary
        && workspace.transactionsHistoricalSummary.eligibleCount > 0,
      ),
      transactionsPolicyResolved: Boolean(workspace.transactionsPolicy?.policy),
    })
  }, [report, workspace, d2hGroups, h2mGroups])

  // Step 4 → Step 5 gate. The Transactions step advances only when the
  // authoritative readiness reports zero transaction-step blockers (allocation
  // reconciliation / individual resolution) AND no transaction decision remains.
  // Keyed off structured readiness — never English blocker text.
  // ONE authoritative Transactions-step gate (dedups orphan allocation blockers,
  // which are counted both in readiness.blockers and remainingByStep.transactions).
  // The same helper is used by the Continue onClick on the freshly-refetched
  // preview, so the summary, footer, disabled state and click never diverge.
  const transactionsGate = useMemo(
    () => transactionsGateFor(readiness, workspace),
    [readiness, workspace],
  )


  // Route a blocker's "Go to …" / "Review Item" / "Refresh Readiness" action to
  // the right step (or a read-only preview refresh). Never mutates anything.
  const resolveBlocker = useCallback((blocker: OpeningBalanceBlocker) => {
    if (blocker.actionLabel === 'Refresh Readiness') {
      if (activeCutoff?.id) void preview(activeCutoff.id)
      return
    }
    // Carry a stable blocker identity into the destination step so it can open
    // the right section, scroll to the affected record and highlight it — never
    // a generic page with nothing indicated. Product text alone is not used.
    setFocusBlocker({ id: blocker.id, step: blocker.step, fromReview: true })
    if (blocker.step === 'transactions') setExpandedTx(prev => new Set(prev).add(blocker.id))
    setStep(blocker.step)
  }, [activeCutoff?.id, preview])

  // Jump to a blocker's home step and scroll/highlight its card. Used from the
  // "View Unresolved Order" list so the click always produces visible behaviour.
  const focusBlockerDetail = useCallback((blocker: OpeningBalanceBlockerDetail) => {
    setBlockerListOpen(false)
    setFilter('action')
    setFocusBlocker({ id: blocker.id, step: blocker.step, fromReview: false })
    setStep(blocker.step)
  }, [])

  // Explicit, HQ-admin-only residual cleanup via the server bridge (auth.uid() =
  // HQ admin). The SECURITY DEFINER RPC enforces every guard and REFUSES if a
  // submitted order still owns the allocation; that refusal is shown to the user
  // rather than failing silently. This route performs no writes of its own and
  // never touches product_inventory from the client. Integer expected_* only.
  const submitAllocationResolve = useCallback(async (
    blocker: OpeningBalanceBlockerDetail,
    action: 'exclude_and_release' | 'mark_manual_investigation',
    reason: string,
  ) => {
    const cutoffId = blocker.identity.cutoffId ?? activeCutoff?.id
    const productVariantId = blocker.identity.variantId
    const stockConfigId = blocker.identity.stockConfigId
    if (!cutoffId || !productVariantId || !stockConfigId) {
      toast({
        title: 'Cannot resolve',
        description: 'This blocker is missing the cut-off, variant or configuration identity. Refresh the report and try again.',
        variant: 'destructive',
      })
      return
    }
    if (!reason.trim()) {
      toast({ title: 'Reason required', description: 'Enter a short reason before confirming.', variant: 'destructive' })
      return
    }
    setResolveBusy(true)
    try {
      const response = await fetch('/api/inventory/opening-balance/allocation-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cutoffId,
          productVariantId,
          stockConfigId,
          action,
          reason: reason.trim(),
          // The live RPC expects INTEGER expected_allocated / expected_selected.
          expectedAllocated: Math.trunc(blocker.identity.allocatedQuantity ?? 0),
          expectedSelected: Math.trunc(blocker.identity.selectedQuantity ?? 0),
          idempotencyKey: crypto.randomUUID(),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const message = String(payload?.error || 'The allocation resolver could not complete.')
        const friendly = message.includes('inventory_cutoff_allocation_active_owner')
          ? 'A submitted order still owns this allocation, so it cannot be released. Cancel or resolve that order first.'
          : message.includes('inventory_cutoff_stale_preview')
            ? 'The report changed since it was loaded. Reloading the latest figures — please retry.'
            : message
        toast({ title: 'Resolver refused', description: friendly, variant: 'destructive' })
        if (message.includes('inventory_cutoff_stale_preview') && activeCutoff?.id) void preview(activeCutoff.id)
        return
      }
      toast({
        title: action === 'exclude_and_release' ? 'Allocation released' : 'Marked for investigation',
        description: action === 'exclude_and_release'
          ? 'The residual allocation was released and audited. Reloading the Opening Balance report.'
          : 'Recorded for manual investigation. This does not clear the blocker.',
      })
      setResolveTarget(null)
      setResolveReason('')
      setBlockerListOpen(false)
      if (activeCutoff?.id) await preview(activeCutoff.id)
    } catch (error: any) {
      toast({
        title: 'Resolver failed',
        description: error?.message || 'Unexpected error calling the allocation resolver.',
        variant: 'destructive',
      })
    } finally {
      setResolveBusy(false)
    }
  }, [activeCutoff?.id, preview, toast])

  // Navigate to the existing stock-configuration workspace, carrying only
  // non-sensitive display context (variant / product code) so the operator lands
  // near the right variant. No warehouse/org/session/variant IDs are hardcoded.
  const openStockConfiguration = useCallback((item?: CarryForwardAffectedItem | H2mAffectedItem) => {
    const params = new URLSearchParams()
    const variantHint = item?.variantCode || item?.variant
    if (variantHint) params.set('variant', variantHint)
    if (item?.productCode) params.set('product', item.productCode)
    const qs = params.toString()
    router.push(`/supply-chain/products${qs ? `?${qs}` : ''}`)
  }, [router])

  const toggleExpanded = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const toggleSelectedH2m = (id: string) =>
    setSelectedH2m(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const filterGroup = useCallback(
    (group: { decisionsRemaining: number; hasBlocker?: boolean }): boolean => {
      if (filter === 'action') return group.decisionsRemaining > 0
      if (filter === 'resolved') return group.decisionsRemaining === 0
      if (filter === 'blocked') return Boolean(group.hasBlocker)
      return true
    },
    [filter],
  )

  // --- Rendering guards for non-active states --------------------------------
  const posted = openingBalancePosted || cutoff?.status === 'posted'
  const cancelled = cutoff?.status === 'cancelled'

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <section className="overflow-hidden rounded-xl border-2 border-orange-300 bg-white shadow-sm" aria-labelledby="inventory-cutoff-title">
      <div className="bg-gradient-to-r from-orange-600 to-amber-500 p-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-100">Opening Balance · guided posting</p>
            <h2 id="inventory-cutoff-title" className="mt-1 text-2xl font-bold">Opening Balance Review, Freeze &amp; Posting</h2>
            <p className="mt-1 max-w-3xl text-sm text-orange-50">A guided, five-step workflow: freeze, resolve distributor and manufacturer orders, review transactions, then post atomically with OTP.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold">
              <ShieldCheck className="h-5 w-5" /> QR: Protected — No Impact
            </div>
            <p className="text-xs text-orange-50">{warehouseLabel} · {categoryLabel}</p>
          </div>
        </div>
      </div>

      {/* Progress indicator — always visible so the freeze/context never scrolls away */}
      {report && !posted && !cancelled && (
        <StepProgress
          current={step}
          onSelect={setStep}
          remaining={workspace?.remainingByStep ?? null}
          freezeActive={Boolean(report.freeze_active)}
        />
      )}

      <div className="space-y-5 p-5">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">
          Preview only — no inventory, order, allocation, or QR data will be changed.
        </div>

        {!sessionId && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Save this Opening Balance draft before activating the warehouse freeze.</div>}

        {sessionId && !cutoff && !openingBalancePosted && (
          <div className="grid gap-4 lg:grid-cols-[1fr_280px_auto] lg:items-end">
            <div>
              <Label>Saved Opening Balance draft</Label>
              <p className="rounded-md border bg-slate-50 px-3 py-2 text-sm font-semibold">{draftLabel}</p>
              <p className="mt-1 text-xs text-slate-500">Warehouse: {warehouseLabel} · Category: {categoryLabel}</p>
              {!countsReady && <p className="mt-1 text-xs font-medium text-amber-700">Enter and save a physical count for every visible eligible configuration before freezing.</p>}
            </div>
            <div><Label>Proposed cut-off date/time</Label><Input type="datetime-local" value={proposedAt} onChange={event => setProposedAt(event.target.value)} /></div>
            <Button onClick={startCutoff} disabled={!countsReady || busy || !isHqAdmin}><Lock className="mr-2 h-4 w-4" />Activate Count &amp; Freeze</Button>
          </div>
        )}

        {posted && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">Official Opening Balance posted</p>
            <p className="mt-1">This warehouse/category scope must use normal Full or Partial / Cycle Counts for later inventory corrections.</p>
          </div>
        )}

        {cancelled && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold text-emerald-900">Opening Balance cancelled. The warehouse has been reopened.</p>
            <p className="mt-1 font-semibold">Cancelled — Read Only</p>
            <p className="mt-1">
              This exercise was cancelled and the warehouse was reopened. Edit, freeze, decision, OTP and posting
              actions are disabled. The cancelled exercise is retained as read-only history — its counts, policies,
              notes and audit trail are preserved.
            </p>
            {activeDraft ? (
              <p className="mt-2 text-xs">
                Active draft: {activeDraft.referenceName}
                {' · '}
                Created {formatOpeningBalanceDraftCreatedAt(activeDraft.createdAt)}
                {' · '}
                Progress {activeDraft.progressLabel}
              </p>
            ) : (
              <p className="mt-2 text-xs">
                No active Opening Balance draft is available for this warehouse and category yet.
              </p>
            )}
            {showCancelledDetail && (
              <dl className="mt-3 grid gap-x-8 gap-y-1 rounded-md border border-amber-200 bg-white p-3 sm:grid-cols-2">
                <SummaryRow label="Opening Balance reference" value={draftLabel} />
                <SummaryRow label="Warehouse" value={warehouseLabel} />
                <SummaryRow label="Product category" value={categoryLabel} />
                <SummaryRow label="Status" value="Cancelled — Read-only History" />
              </dl>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowCancelledDetail(value => !value)}>
                {showCancelledDetail ? 'Hide Cancelled Exercise' : 'View Cancelled Exercise'}
              </Button>
              {(() => {
                const next = cancelledOpeningBalanceNextAction(Boolean(activeDraft?.sessionId))
                if (next.kind === 'return_active' && activeDraft?.sessionId) {
                  return (
                    <Button size="sm" onClick={() => onReturnToActiveDraft?.(activeDraft.sessionId)}>
                      {next.label}
                    </Button>
                  )
                }
                return (
                  <Button size="sm" onClick={() => onCreateNewOpeningBalance?.()}>
                    Create New Opening Balance
                  </Button>
                )
              })()}
            </div>
          </div>
        )}

        {report && !posted && !cancelled && workspace && (
          <>
            {step === 'freeze' && renderFreezeStep()}
            {step === 'd2h' && renderD2hStep()}
            {step === 'h2m' && renderH2mStep()}
            {step === 'transactions' && renderTransactionsStep()}
            {step === 'review' && renderReviewStep()}
          </>
        )}

        {loading && <p className="text-sm text-slate-500">Loading Opening Balance controls…</p>}
      </div>

      {/* Sticky wizard footer — inlined (not a nested component) so the OTP input
          keeps focus across keystroke re-renders. */}
      {report && !posted && !cancelled && workspace && (() => {
        const index = OPENING_BALANCE_STEPS.findIndex(s => s.id === step)
        const isLast = index === OPENING_BALANCE_STEPS.length - 1
        const continueLabel = openingBalanceContinueLabel(step)
        const activeGate = step === 'd2h'
          ? d2hGate
          : step === 'h2m'
            ? h2mGate
            : step === 'transactions'
              ? transactionsGate
              : null
        const gateBlocked = Boolean(activeGate && !activeGate.canContinue)
        return (
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t bg-white/95 px-5 py-3 backdrop-blur">
            <div className="flex items-center gap-2">
              {index > 0 && (
                <Button variant="outline" size="sm" onClick={() => setStep(OPENING_BALANCE_STEPS[index - 1].id)} disabled={busy || saving}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => void saveDraft()} disabled={busy || saving}><Save className="mr-2 h-4 w-4" />Save Draft</Button>
            </div>
            <div className="flex items-center gap-2">
              {(busy || saving) && <Loader2 className="h-4 w-4 animate-spin text-orange-600" />}
              {gateBlocked && activeGate?.message && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-red-700">{activeGate.message}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setBlockerListOpen(true)}
                  >
                    {step === 'h2m' ? 'View First Unresolved Order' : 'View Unresolved Order'}
                  </Button>
                </div>
              )}
              {/* The Review step's OTP request/verify lives in the "Final
                  Verification & Posting" section, not the footer, so the normal
                  completion path is one clear primary action. */}
              {!isLast && (
                <Button size="sm" onClick={() => void saveDraft(OPENING_BALANCE_STEPS[index + 1].id)} disabled={busy || saving || gateBlocked}>{continueLabel}<ArrowRight className="ml-2 h-4 w-4" /></Button>
              )}
            </div>
          </div>
        )
      })()}

      <AlertDialog open={Boolean(confirm)} onOpenChange={open => { if (!open) setConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {(confirm?.onViewAffected || confirm?.onViewBlocked) && (
            <div className="flex flex-wrap gap-2">
              {confirm.onViewAffected && <Button size="sm" variant="outline" onClick={confirm.onViewAffected}>View Affected Items</Button>}
              {confirm.onViewBlocked && <Button size="sm" variant="outline" onClick={confirm.onViewBlocked}>View Blocked Items</Button>}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirm?.destructive ? 'bg-red-700 hover:bg-red-800' : undefined}
              disabled={confirm?.disabled || h2mBulkBusy}
              onClick={async () => { const action = confirm?.onConfirm; setConfirm(null); await action?.() }}
            >
              {h2mBulkBusy ? 'Applying decisions…' : confirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* "View Unresolved Order" — a complete list of every unresolved blocker
          with details + a jump-to. Guarantees the click always does something. */}
      <Dialog open={blockerListOpen} onOpenChange={setBlockerListOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Unresolved blockers</DialogTitle>
            <DialogDescription>
              {readiness && readiness.blockers.length > 0
                ? `Resolve ${readiness.blockers.length} item${readiness.blockers.length === 1 ? '' : 's'} before continuing to Review & Post.`
                : 'No unresolved blockers remain.'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {(readiness?.blockers ?? []).map(b => {
              const id = b.identity
              const allocated = id?.allocatedQuantity
              const selected = id?.selectedQuantity
              const difference = id?.difference ?? ((allocated ?? 0) - (selected ?? 0))
              const canRelease = (b.resolutionActions ?? []).some(a => a.kind === 'exclude_and_release' && a.available)
              const hasSource = Boolean(id?.sourceOrderId || id?.sourceOrderNumber || id?.sourceDocumentRef)
              return (
                <div key={b.id} data-testid="unresolved-blocker-row" className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{b.type}</p>
                      {id?.variantName && (
                        <p className="text-xs text-slate-500">{id.variantName}{id.configLabel ? ` · ${withStockStrengthUnit(id.configLabel)}` : ''}</p>
                      )}
                    </div>
                    <Badge className="bg-slate-100 text-slate-700">Step: {b.step}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">{b.reason}</p>
                  {id && (allocated != null || selected != null) && (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded border border-slate-200 bg-slate-50 p-1.5"><p className="uppercase text-slate-500">Allocated</p><p className="font-bold">{allocated ?? 0}</p></div>
                      <div className="rounded border border-slate-200 bg-slate-50 p-1.5"><p className="uppercase text-slate-500">Selected</p><p className="font-bold">{selected ?? 0}</p></div>
                      <div className="rounded border border-red-200 bg-red-50 p-1.5"><p className="uppercase text-red-600">Difference</p><p className="font-bold text-red-700">{difference}</p></div>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                    {id?.sourceOrderNumber && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{id.sourceOrderNumber}</span>}
                    {id?.allocationStatus && <span className="rounded bg-slate-100 px-1.5 py-0.5">Status: {id.allocationStatus}</span>}
                    {id?.stockConfigId && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">cfg {id.stockConfigId.slice(0, 8)}</span>}
                  </div>
                  {!hasSource && (
                    <p className="mt-2 text-xs font-medium text-amber-700">No active source order is linked to this residual allocation.</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setBlockerListOpen(false); resolveBlocker(b) }}>{b.actionLabel || 'Go to blocker'}</Button>
                    {hasSource && id?.sourceOrderId && (
                      <Button size="sm" variant="ghost" onClick={() => router.push(`/supply-chain/orders?orderId=${encodeURIComponent(id.sourceOrderId!)}`)}>Open source order</Button>
                    )}
                    {canRelease && (
                      <Button
                        size="sm"
                        onClick={() => {
                          const detail = {
                            id: b.id, code: 'allocation_reconciliation', category: 'allocation_reconciliation',
                            step: b.step, reason: b.reason, actionLabel: b.actionLabel,
                            identity: b.identity ?? {}, resolutionActions: b.resolutionActions ?? [], orphan: true,
                          } as OpeningBalanceBlockerDetail
                          setResolveReason('')
                          setResolveTarget({ blocker: detail, action: 'exclude_and_release' })
                        }}
                      >
                        Exclude &amp; Release
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            {(readiness?.blockers ?? []).length === 0 && (
              <p className="text-sm text-slate-500">No unresolved blockers. Refresh the report if this seems wrong.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBlockerListOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Allocation resolver confirmation (explicit reason). Calls the server
          bridge; the RPC enforces every guard and refuses an active-owner
          release, which is shown as a toast rather than failing silently. */}
      <Dialog
        open={Boolean(resolveTarget)}
        onOpenChange={open => { if (!open && !resolveBusy) { setResolveTarget(null); setResolveReason('') } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {resolveTarget?.action === 'exclude_and_release'
                ? 'Exclude transaction & release allocation'
                : 'Mark for manual investigation'}
            </DialogTitle>
            <DialogDescription>
              {resolveTarget?.action === 'exclude_and_release'
                ? 'Releases the residual allocation (quantity_allocated decreases by the verified difference). On-hand is unchanged and the action is audited. The server refuses if a submitted order still owns the allocation.'
                : 'Records an audit note only. It does not release the allocation or clear the blocker.'}
            </DialogDescription>
          </DialogHeader>
          {resolveTarget && (
            <div className="space-y-3">
              <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">
                  {resolveTarget.blocker.identity.variantName ?? 'Allocation'}
                  {resolveTarget.blocker.identity.configLabel ? ` · ${withStockStrengthUnit(resolveTarget.blocker.identity.configLabel)}` : ''}
                </p>
                <p>
                  Allocated {resolveTarget.blocker.identity.allocatedQuantity ?? 0}
                  {' · '}Selected {resolveTarget.blocker.identity.selectedQuantity ?? 0}
                  {' · '}Difference {resolveTarget.blocker.identity.difference
                    ?? ((resolveTarget.blocker.identity.allocatedQuantity ?? 0) - (resolveTarget.blocker.identity.selectedQuantity ?? 0))}
                </p>
              </div>
              <div>
                <Label htmlFor="allocation-resolve-reason">Reason</Label>
                <Textarea
                  id="allocation-resolve-reason"
                  value={resolveReason}
                  onChange={e => setResolveReason(e.target.value)}
                  placeholder="e.g. Residual allocation from cancelled order SO26000085"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={resolveBusy} onClick={() => { setResolveTarget(null); setResolveReason('') }}>Cancel</Button>
            <Button
              size="sm"
              disabled={resolveBusy || !resolveReason.trim()}
              onClick={() => { if (resolveTarget) void submitAllocationResolve(resolveTarget.blocker, resolveTarget.action, resolveReason) }}
            >
              {resolveBusy ? 'Working…' : resolveTarget?.action === 'exclude_and_release' ? 'Release allocation' : 'Record note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Protected cancellation modal for the entire exercise (not OTP / Back). */}
      <AlertDialog
        open={cancelModalOpen}
        onOpenChange={open => {
          if (busy) return
          setCancelModalOpen(open)
          if (!open) setCancelConfirmText('')
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Entire Opening Balance Exercise?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently abandon &apos;{draftLabel}&apos; and reopen the warehouse.
              This is not the same as going back or cancelling OTP verification.
              The cancelled exercise remains read-only history and will not be posted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Reason: <span className="font-medium text-slate-900">{cancelReason.trim() || '—'}</span>
            </p>
            <div>
              <Label htmlFor="cancel-confirm-name" className="text-xs">
                Type the exact cutoff name <span className="font-mono font-semibold">{draftLabel}</span> to confirm
              </Label>
              <Input
                id="cancel-confirm-name"
                value={cancelConfirmText}
                onChange={event => setCancelConfirmText(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }}
                placeholder={draftLabel}
                autoComplete="off"
                className="mt-1"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCancelConfirmText('')}>Keep Opening Balance</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-700 hover:bg-red-800"
              disabled={
                busy
                || !cancelReason.trim()
                || cancelConfirmText.trim() !== draftLabel
                || !isHqAdmin
              }
              onClick={async event => { event.preventDefault(); await cancelCutoff() }}
            >
              {busy ? 'Cancelling…' : 'Confirm Cancel Entire Exercise'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )

  // =========================================================================
  // Step 1 — Freeze & Overview
  // =========================================================================
  function renderFreezeStep() {
    if (!report || !workspace) return null
    const statusBadge = READINESS_BADGE[workspace.status] ?? READINESS_BADGE['Action Required']
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-orange-600" />
            <span className="font-semibold">{report.freeze_active ? 'Warehouse frozen — count active' : 'Warehouse open'}</span>
            <Badge className={statusBadge}>{workspace.status}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void preview()} disabled={!activeCutoff || busy}><Eye className="mr-2 h-4 w-4" />Preview report</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><MoreHorizontal className="mr-2 h-4 w-4" />More actions</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowHistory(v => !v)}><History className="mr-2 h-4 w-4" />View previous reports</DropdownMenuItem>
                <DropdownMenuItem onClick={download}><Download className="mr-2 h-4 w-4" />Download CSV</DropdownMenuItem>
                {activeCutoff && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-700 focus:text-red-700"
                      onClick={() => setStep('review')}
                    >
                      <AlertTriangle className="mr-2 h-4 w-4" />Cancel freeze &amp; reopen (in Review)
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {showHistory && (
          <div className="rounded-lg border p-3 text-sm">
            {reports.length === 0 ? 'No posted cut-off reports.' : reports.map(item => (
              <button key={item.id} className="block w-full border-b p-2 text-left last:border-0" onClick={() => setReport(item.report_payload)}>
                {new Date(item.generated_at).toLocaleString()} · {item.readiness}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard label="Physical Opening Stock" value={num(physicalSummary)} sub={`${workspace.summary.physicalOpeningStock.countedRows} counted · ${workspace.summary.physicalOpeningStock.missingRows} missing`} />
          <SummaryCard
            label="D2H orders — decisions"
            value={String(d2hGroups.actionable.length)}
            sub={`${workspace.d2hRemaining} decision(s) remaining`}
            note={d2hConfigIssueCount > 0
              ? `${d2hConfigIssueCount} order${d2hConfigIssueCount === 1 ? '' : 's'} ${d2hConfigIssueCount === 1 ? 'has' : 'have'} a configuration issue`
              : undefined}
            tone={d2hConfigIssueCount > 0 ? 'danger' : workspace.d2hRemaining > 0 ? 'warn' : 'ok'}
            onClick={() => setStep('d2h')}
          />
          <SummaryCard label="H2M orders — decisions" value={String(h2mGroups.filter(g => h2mOrderEligibility(g, h2mEligibility, warehouseLabel).unresolvedCount > 0).length)} sub={`${h2mGate.unresolvedCount} decision(s) remaining`} tone={h2mGate.unresolvedCount > 0 ? 'warn' : 'ok'} onClick={() => setStep('h2m')} />
          <SummaryCard
            label="Transactions — attention"
            value={String(transactionsSummary.documentCount)}
            sub={transactionsSummary.remainingLabel}
            tone={workspace.transactionsRemaining > 0 ? 'warn' : 'ok'}
            onClick={() => setStep('transactions')}
          />
          <SummaryCard label="Total unresolved blockers" value={String(workspace.totalBlockers)} sub={workspace.totalBlockers === 0 ? 'None — ready to post' : 'Resolve before posting'} tone={workspace.totalBlockers > 0 ? 'danger' : 'ok'} />
          <SummaryCard label="Cut-off date/time" value={new Date(report.proposed_cutoff_at).toLocaleDateString()} sub={new Date(report.proposed_cutoff_at).toLocaleTimeString()} />
        </div>

        {/* The single primary "Continue" action now lives only in the sticky
            wizard footer, so the freeze overview no longer duplicates it here. */}
      </div>
    )
  }

  // =========================================================================
  // Step 2 — D2H policy (Option A / Option B)
  // =========================================================================
  function renderD2hStep() {
    const policy = workspace?.d2hPolicy ?? null
    const historicalSummary = workspace?.d2hHistoricalSummary
    const boundaryAt = report?.cutoff_boundary_at || report?.proposed_cutoff_at
    const allGroups = [...d2hGroups.actionable, ...d2hGroups.historical]
    const showReviewList = policy?.policy === 'review_select' || d2hReviewDraft
    const showExcludeSummary = policy?.policy === 'exclude_all' && !d2hReviewDraft
    const selectableGroups = d2hGroups.actionable.filter(group => {
      const carryForward = d2hCarryForwardStatus(group, cfEligibility)
      return !carryForward.blocked && Boolean(group.orderId)
    })
    const selectableOrderIds = new Set(
      selectableGroups.map(group => group.orderId).filter(Boolean),
    )
    const selectedEligibleQuantity = selectableGroups
      .filter(group => group.orderId && selectedD2h.has(group.orderId))
      .reduce((sum, group) => sum + Number(group.totalQuantity || 0), 0)

    const reviewGroups = d2hGroups.actionable
      .filter(filterGroup)
      .filter(g => matchesSearch([g.orderNumber, g.customer, g.warehouse], search))
      .filter(g => {
        if (!d2hSelectedOnly) return true
        const orderId = g.lines.find(l => l.order_id)?.order_id
        return orderId ? selectedD2h.has(orderId) : false
      })

    return (
      <div className="space-y-4">
        <StepHeader
          title="Resolve Distributor (D2H) Orders"
          subtitle="Choose how existing distributor SO orders are treated against the new inventory baseline. Orders are never deleted."
          remaining={workspace?.d2hRemaining ?? 0}
        />

        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-900">How should existing distributor orders be treated?</p>
          {boundaryAt && (
            <p className="text-xs text-slate-500">
              Cut-off boundary: {new Date(boundaryAt).toLocaleString()} — orders created before this timestamp are in scope.
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              disabled={busy || d2hPolicyBusy}
              onClick={() => {
                // Switching B → A discards any effective UI carry selection.
                setD2hReviewDraft(false)
                setSelectedD2h(new Set())
                setD2hSelectedOnly(false)
                void openD2hPolicyConfirmation('exclude_all', [])
              }}
              className={`rounded-lg border p-4 text-left transition ${
                policy?.policy === 'exclude_all' && !d2hReviewDraft
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 hover:border-slate-400'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{D2H_POLICY_LABELS.exclude_all}</p>
                {policy?.policy === 'exclude_all' && !d2hReviewDraft && (
                  <Badge className="bg-emerald-100 text-emerald-800">Saved</Badge>
                )}
              </div>
              <p className={`mt-2 text-xs ${policy?.policy === 'exclude_all' && !d2hReviewDraft ? 'text-slate-200' : 'text-slate-600'}`}>
                {D2H_POLICY_DESCRIPTIONS.exclude_all}
              </p>
              <p className={`mt-2 text-xs font-medium ${policy?.policy === 'exclude_all' && !d2hReviewDraft ? 'text-slate-100' : 'text-slate-700'}`}>
                Recommended for a fresh Opening Balance baseline.
              </p>
            </button>

            <button
              type="button"
              disabled={busy || d2hPolicyBusy}
              onClick={() => {
                // Enter Option B as UI draft only — list appears; save is explicit.
                setD2hReviewDraft(true)
                if (policy?.policy === 'review_select' && selectedD2h.size === 0) {
                  setSelectedD2h(new Set(policy.selectedOrderIds))
                }
              }}
              className={`rounded-lg border p-4 text-left transition ${
                showReviewList
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-slate-200 hover:border-slate-400'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{D2H_POLICY_LABELS.review_select}</p>
                {policy?.policy === 'review_select' && (
                  <Badge className="bg-orange-100 text-orange-800">Saved</Badge>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-600">{D2H_POLICY_DESCRIPTIONS.review_select}</p>
            </button>
          </div>
        </div>

        {showExcludeSummary && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200">Step 2 resolved</Badge>
              <span className="text-sm font-semibold text-emerald-950">Start Fresh policy saved</span>
            </div>
            <p className="text-sm text-emerald-950">
              {historicalSummary?.notice
                || `${policy.eligibleOrderCount} historical D2H orders will be excluded from the new inventory baseline. Order history and reporting remain unchanged.`}
            </p>
            <ul className="text-sm text-emerald-900 list-disc pl-5 space-y-1">
              <li>No orders will be cancelled or deleted.</li>
              <li>No historical stock will be returned to inventory.</li>
              <li>{num(policy.eligibleItemCount)} items · {num(policy.eligibleQuantity)} ordered units stay historical for audit/reporting.</li>
            </ul>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md border border-emerald-200 bg-white p-3 text-left text-sm font-semibold"
              onClick={() => setShowHistoricalD2h(v => !v)}
            >
              <span>Historical D2H orders for audit/reference ({allGroups.length})</span>
              {showHistoricalD2h ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {showHistoricalD2h && (
              <div className="rounded-md border bg-white p-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allGroups.map(group => (
                      <TableRow key={group.key}>
                        <TableCell>{group.orderNumber}</TableCell>
                        <TableCell>{group.customer}</TableCell>
                        <TableCell>{group.statuses.map(s => <Badge key={s} variant="outline" className="mr-1">{s}</Badge>)}</TableCell>
                        <TableCell className="text-right">{group.lineCount}</TableCell>
                        <TableCell className="text-right">{num(group.totalQuantity)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => toggleExpanded(group.key)}>
                            {expanded.has(group.key) ? 'Hide items' : 'View items'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {allGroups.filter(g => expanded.has(g.key)).map(group => (
                  <div key={`items-${group.key}`} className="mt-2 rounded border p-2">
                    <p className="mb-2 text-xs font-semibold text-slate-700">{group.orderNumber} items (read-only)</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Variant</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead>Classification</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.lines.map(line => (
                          <TableRow key={line.order_item_id}>
                            <TableCell>{line.variant}</TableCell>
                            <TableCell><Badge variant="outline">{line.status}</Badge></TableCell>
                            <TableCell className="text-right">{num(line.quantity)}</TableCell>
                            <TableCell>Historical Excluded</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showReviewList && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Select only the SO orders that should continue under the new inventory. Checked = Carry Into New Inventory; unchecked = Keep as Historical.
            </p>

            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-white/95 p-3 shadow-sm backdrop-blur">
              <Button
                size="sm"
                variant="ghost"
                disabled={d2hPolicyBusy || selectableOrderIds.size === 0}
                onClick={() => setSelectedD2h(new Set(selectableOrderIds))}
              >
                Select All Eligible
              </Button>
              <Button size="sm" variant="ghost" disabled={selectedD2h.size === 0 || d2hPolicyBusy} onClick={() => setSelectedD2h(new Set())}>
                Clear Selection
              </Button>
              <Button
                size="sm"
                variant={d2hSelectedOnly ? 'default' : 'outline'}
                onClick={() => setD2hSelectedOnly(v => !v)}
              >
                Selected only
              </Button>
              <Badge variant="outline">{selectedD2h.size} order(s) selected · {num(selectedEligibleQuantity)} units</Badge>
              <Button
                size="sm"
                className="ml-auto"
                disabled={d2hPolicyBusy}
                onClick={() => void openD2hPolicyConfirmation('review_select', [...selectedD2h])}
              >
                {d2hPolicyBusy ? 'Checking…' : 'Save D2H Decision'}
              </Button>
            </div>

            <WorkspaceControls search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} placeholder="Search order number, distributor, warehouse" />

            {reviewGroups.length === 0 ? (
              <EmptyState message={d2hGroups.actionable.length === 0
                ? 'No pre-cut-off distributor orders in this warehouse/category scope.'
                : 'No orders match the current filter.'} />
            ) : (
              <div className="space-y-3">
                {reviewGroups.map(group => {
                  const carryForward = d2hCarryForwardStatus(group, cfEligibility)
                  const orderId = group.orderId
                  return (
                    <D2hOrderCard
                      key={group.key}
                      group={group}
                      expanded={expanded.has(group.key) || carryForward.blocked}
                      busy={busy || d2hPolicyBusy}
                      carryForward={carryForward}
                      blockedOrderItemIds={cfBlockedOrderItemIds}
                      preflightBusy={preflightBusy}
                      selected={orderId ? selectedD2h.has(orderId) : false}
                      selectable={Boolean(orderId) && !carryForward.blocked}
                      onToggleSelect={() => {
                        if (!orderId || carryForward.blocked) return
                        setSelectedD2h(prev => {
                          const next = new Set(prev)
                          if (next.has(orderId)) next.delete(orderId)
                          else next.add(orderId)
                          return next
                        })
                      }}
                      onToggle={() => toggleExpanded(group.key)}
                      onRefreshRecheck={() => void runCarryForwardPreflight(d2hOrderItemIds)}
                      onOpenStockConfig={openStockConfiguration}
                    />
                  )
                })}
              </div>
            )}

            {d2hGroups.historical.length > 0 && (
              <div className="rounded-lg border">
                <button className="flex w-full items-center justify-between p-3 text-left text-sm font-semibold" onClick={() => setShowHistoricalD2h(v => !v)}>
                  <span>Already historical / non-submitted ({d2hGroups.historical.length})</span>
                  {showHistoricalD2h ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {showHistoricalD2h && (
                  <div className="border-t p-3">
                    <Table>
                      <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Lines</TableHead><TableHead className="text-right">Quantity</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {d2hGroups.historical.map(group => (
                          <TableRow key={group.key}>
                            <TableCell>{group.orderNumber}</TableCell>
                            <TableCell>{group.customer}</TableCell>
                            <TableCell>{group.statuses.map(s => <Badge key={s} variant="outline" className="mr-1">{s}</Badge>)}</TableCell>
                            <TableCell className="text-right">{group.lineCount}</TableCell>
                            <TableCell className="text-right">{num(group.totalQuantity)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // =========================================================================
  // Step 3 — H2M policy (Option A / Option B)
  // =========================================================================
  function renderH2mStep() {
    const policy = workspace?.h2mPolicy ?? null
    const historicalSummary = workspace?.h2mHistoricalSummary
    const boundaryAt = report?.cutoff_boundary_at || report?.proposed_cutoff_at
    const showReviewList = policy?.policy === 'review_select' || h2mReviewDraft
    const showExcludeSummary = policy?.policy === 'exclude_all' && !h2mReviewDraft
    const selectableOrderIds = new Set(
      h2mGroups
        .filter(group => {
          const status = h2mOrderEligibility(group, h2mEligibility, warehouseLabel)
          return status.eligibleCount > 0 || status.unresolvedCount > 0
        })
        .map(group => group.orderId)
        .filter(Boolean),
    )
    const selectedOutstanding = h2mGroups
      .filter(group => selectedH2m.has(group.orderId))
      .reduce((sum, group) => sum + Number(group.remainingIncoming || 0), 0)

    const groups = h2mGroups
      .filter(group => {
        const status = h2mOrderEligibility(group, h2mEligibility, warehouseLabel)
        if (filter === 'action') return status.unresolvedCount > 0
        if (filter === 'resolved') return status.unresolvedCount === 0
        if (filter === 'blocked') return status.blockedCount > 0
        return true
      })
      .filter(g => matchesSearch([g.orderNumber, g.manufacturer], search))
      .filter(g => !h2mSelectedOnly || selectedH2m.has(g.orderId))

    return (
      <div className="space-y-4">
        <StepHeader
          title="Resolve Manufacturer (H2M) Incoming"
          subtitle={`Choose how existing ${categoryLabel} manufacturer orders are treated. Selected expected incoming is tracked separately and never added during Opening Balance posting.`}
          remaining={workspace?.h2mRemaining ?? 0}
        />

        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-900">How should existing manufacturer orders be treated?</p>
          {boundaryAt && (
            <p className="text-xs text-slate-500">
              Cut-off boundary: {new Date(boundaryAt).toLocaleString()} — outstanding pre-boundary H2M quantities are in scope.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              disabled={busy || h2mPolicyBusy}
              onClick={() => {
                setH2mReviewDraft(false)
                setSelectedH2m(new Set())
                setH2mSelectedOnly(false)
                void openH2mPolicyConfirmation('exclude_all', [])
              }}
              className={`rounded-lg border p-4 text-left transition ${
                policy?.policy === 'exclude_all' && !h2mReviewDraft
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 hover:border-slate-400'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{H2M_POLICY_LABELS.exclude_all}</p>
                {policy?.policy === 'exclude_all' && !h2mReviewDraft && (
                  <Badge className="bg-emerald-100 text-emerald-800">Saved</Badge>
                )}
              </div>
              <p className={`mt-2 text-xs ${policy?.policy === 'exclude_all' && !h2mReviewDraft ? 'text-slate-200' : 'text-slate-600'}`}>
                {H2M_POLICY_DESCRIPTIONS.exclude_all}
              </p>
            </button>
            <button
              type="button"
              disabled={busy || h2mPolicyBusy}
              onClick={() => {
                setH2mReviewDraft(true)
                if (policy?.policy === 'review_select' && selectedH2m.size === 0) {
                  setSelectedH2m(new Set(policy.selectedOrderIds))
                }
              }}
              className={`rounded-lg border p-4 text-left transition ${
                showReviewList ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-400'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{H2M_POLICY_LABELS.review_select}</p>
                {policy?.policy === 'review_select' && (
                  <Badge className="bg-orange-100 text-orange-800">Saved</Badge>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-600">{H2M_POLICY_DESCRIPTIONS.review_select}</p>
            </button>
          </div>
        </div>

        {showExcludeSummary && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200">Step 3 resolved</Badge>
              <span className="text-sm font-semibold text-emerald-950">Start Fresh H2M policy saved</span>
            </div>
            <p className="text-sm text-emerald-950">
              {historicalSummary?.notice
                || `${policy.eligibleOrderCount} historical H2M orders will be excluded from expected incoming. Opening Balance posting adds zero H2M quantity.`}
            </p>
            <ul className="text-sm text-emerald-900 list-disc pl-5 space-y-1">
              <li>No H2M orders will be cancelled or deleted.</li>
              <li>No H2M quantity is added during Opening Balance posting.</li>
              <li>
                {num(policy.eligibleOrderCount)} orders · {num(policy.eligibleItemCount)} items ·
                ordered {num(policy.eligibleOrderedQuantity ?? 0)} ·
                received before boundary {num(policy.eligibleReceivedBeforeBoundary ?? 0)} ·
                outstanding {num(policy.eligibleOutstandingQuantity ?? policy.eligibleQuantity)} stay historical for audit.
              </li>
            </ul>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md border border-emerald-200 bg-white p-3 text-left text-sm font-semibold"
              onClick={() => setShowHistoricalH2m(v => !v)}
            >
              <span>Historical H2M orders for audit/reference ({h2mGroups.length})</span>
              {showHistoricalH2m ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {showHistoricalH2m && (
              <div className="rounded-md border bg-white p-3 space-y-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Manufacturer</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {h2mGroups.map(group => (
                      <TableRow key={group.key}>
                        <TableCell>{group.orderNumber}</TableCell>
                        <TableCell>{group.manufacturer}</TableCell>
                        <TableCell className="text-right">{group.lineCount}</TableCell>
                        <TableCell className="text-right">{num(group.orderedQuantity)}</TableCell>
                        <TableCell className="text-right">{num(group.receivedQuantity)}</TableCell>
                        <TableCell className="text-right">{num(group.remainingIncoming)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => toggleExpanded(group.key)}>
                            {expanded.has(group.key) ? 'Hide items' : 'View items'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {h2mGroups.filter(g => expanded.has(g.key)).map(group => (
                  <div key={`h2m-audit-${group.key}`} className="rounded border p-2">
                    <p className="mb-2 text-xs font-semibold text-slate-700">{group.orderNumber} items (read-only)</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Variant</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead>Classification</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.lines.map(line => (
                          <TableRow key={line.order_item_id}>
                            <TableCell>{line.variant}</TableCell>
                            <TableCell className="text-right">{num(line.remaining_incoming_quantity)}</TableCell>
                            <TableCell>Historical Excluded</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showReviewList && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Checked = Expected Incoming After Cut-off; unchecked = Keep as Historical. Opening Balance posting still adds zero H2M quantity.
            </p>
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-white/95 p-3 shadow-sm backdrop-blur">
              <Button
                size="sm"
                variant="ghost"
                disabled={h2mPolicyBusy || h2mPreflightBusy || selectableOrderIds.size === 0}
                onClick={() => setSelectedH2m(new Set(selectableOrderIds))}
              >
                Select All Eligible
              </Button>
              <Button size="sm" variant="ghost" disabled={selectedH2m.size === 0 || h2mPolicyBusy} onClick={() => setSelectedH2m(new Set())}>
                Clear Selection
              </Button>
              <Button
                size="sm"
                variant={h2mSelectedOnly ? 'default' : 'outline'}
                onClick={() => setH2mSelectedOnly(v => !v)}
              >
                Selected only
              </Button>
              <Badge variant="outline">
                {selectedH2m.size} order(s) selected · {num(selectedOutstanding)} outstanding
              </Badge>
              <Button
                size="sm"
                className="ml-auto"
                disabled={h2mPolicyBusy}
                onClick={() => void openH2mPolicyConfirmation('review_select', [...selectedH2m])}
              >
                {h2mPolicyBusy ? 'Checking…' : 'Save H2M Decision'}
              </Button>
            </div>

            <WorkspaceControls search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} placeholder="Search order number or manufacturer" />

            {h2mPreflightError && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
                <p className="font-semibold">H2M Incoming readiness check needs attention</p>
                <p className="mt-1">{h2mPreflightError.message}</p>
                {h2mPreflightError.correlationId && (
                  <p className="mt-1 text-xs text-red-700">
                    Reference: {h2mPreflightError.correlationId}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={h2mPreflightBusy}
                  onClick={() => void runH2mIncomingPreflight(h2mOrderItemIds)}
                >
                  Retry H2M Check
                </Button>
              </div>
            )}

            {groups.length === 0 ? (
              <EmptyState message={h2mGroups.length === 0
                ? `No actionable H2M incoming orders for ${categoryLabel}`
                : 'No orders match the current filter.'} />
            ) : (
              <div className="space-y-3">
                {groups.map(group => (
                  <H2mOrderCard
                    key={group.key}
                    group={group}
                    eligibility={h2mOrderEligibility(group, h2mEligibility, warehouseLabel)}
                    eligibilityMap={h2mEligibility}
                    expanded={expanded.has(group.key)}
                    busy={busy || h2mPolicyBusy}
                    preflightBusy={h2mPreflightBusy}
                    selected={selectedH2m.has(group.orderId)}
                    selectable={selectableOrderIds.has(group.orderId)}
                    onToggle={() => toggleExpanded(group.key)}
                    onToggleSelect={() => toggleSelectedH2m(group.orderId)}
                    onOpenStockConfig={openStockConfiguration}
                    onRefreshRecheck={() => {
                      const ids = group.lines
                        .map(line => line.order_item_id)
                        .filter((id): id is string => Boolean(id))
                      void Promise.all([
                        preview(activeCutoff?.id),
                        runH2mIncomingPreflight(ids),
                      ])
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // =========================================================================
  // Step 4 — Other operational transactions
  // =========================================================================
  function renderTransactionsStep() {
    const boundaryAt = report?.cutoff_boundary_at || report?.proposed_cutoff_at
    const savedPolicy = workspace?.transactionsPolicy ?? null
    const hist = workspace?.transactionsHistoricalSummary ?? null

    // Typed activity rows (Stock Adjustment / Return / Stock Transfer) from the
    // authoritative preview. Each row carries its own eligibility + reason.
    const rows = (report?.warehouse_activity ?? []).filter((r: any) =>
      r && ['stock_adjustment', 'return', 'stock_transfer'].includes(r.movement_type),
    ) as any[]
    const hasTypedEligibility = rows.some((r: any) => typeof r.eligibility === 'string')
    const eligibleRows = rows.filter((r: any) => r.eligibility === 'eligible')
    const blockedRows = rows.filter((r: any) => r.eligibility === 'requires_resolution')
    const eligibleRefs: TransactionRef[] = eligibleRows
      .filter((r: any) => typeof r.reference_id === 'string')
      .map((r: any) => ({ type: r.movement_type as TransactionRef['type'], id: r.reference_id }))

    // Allocation/orphan reconciliation blockers resolve HERE but have no typed
    // transaction row, so the old contract (blocked_count / warehouse_activity)
    // hid them entirely — Step 4 read "All resolved" while Step 5 reported one.
    // Consuming the shared authoritative collection keeps the two steps in lock-step.
    const allocationBlockers = workspace?.allocationBlockers ?? []
    const eligibleCount = savedPolicy?.eligibleCount ?? hist?.eligibleCount ?? eligibleRows.length
    // Requires-individual-resolution total = typed rows + orphan allocation blockers.
    const blockedCount = (hist?.blockedCount ?? blockedRows.length) + allocationBlockers.length
    // A blocker was reported but no visible record matched it — surface that,
    // never a silent "All resolved". Matched when the focused allocation card is
    // present, or any requires-resolution content is visible to act on.
    const focusedHere = focusBlocker?.step === 'transactions' ? focusBlocker : null
    const focusMatched = focusedHere
      ? (allocationBlockers.some(b => b.id === focusedHere.id) || blockedCount > 0)
      : true
    const showReviewList = savedPolicy?.policy === 'review_select' || txReviewDraft

    // Effective carried set derived from the chosen (unsaved) policy + checks.
    const draftPolicy: TransactionsPolicy = showReviewList
      ? 'review_select'
      : (savedPolicy?.policy ?? 'exclude_all')
    const checkedRefs = eligibleRefs.filter(ref => selectedTx.has(`${ref.type}:${ref.id}`))
    const effectiveCarried = deriveEffectiveCarried(draftPolicy, eligibleRefs, checkedRefs)
    const carriedCount = savedPolicy
      ? savedPolicy.carriedCount
      : draftPolicy === 'exclude_all' ? 0 : effectiveCarried.length
    const excludedCount = savedPolicy
      ? savedPolicy.excludedCount
      : Math.max(eligibleCount - carriedCount, 0)

    const txKey = (r: any) => `${r.movement_type}:${r.reference_id}`
    const isCardActive = (p: TransactionsPolicy) =>
      p === 'review_select'
        ? showReviewList
        : savedPolicy?.policy === p && !txReviewDraft

    const filteredRows = rows.filter((r: any) => {
      if (txFilter === 'attention') return r.eligibility === 'requires_resolution'
      if (txFilter === 'all') return true
      return r.movement_type === txFilter
    })

    const externalHref = (r: any): string | null => {
      // Transfers and returns have real detail views; adjustments do not, so they
      // use the inline scoped detail below (never a dead navigation).
      if (r.movement_type === 'stock_transfer') {
        return r.reference_no
          ? `/supply-chain/inventory/transfer?transfer=${encodeURIComponent(r.reference_no)}`
          : r.reference_id
            ? `/supply-chain/inventory/transfer?transferId=${encodeURIComponent(r.reference_id)}`
            : '/supply-chain/inventory/transfer'
      }
      if (r.movement_type === 'return') {
        return r.reference_no
          ? `/supply-chain/returns?return=${encodeURIComponent(r.reference_no)}`
          : r.reference_id
            ? `/supply-chain/returns?returnId=${encodeURIComponent(r.reference_id)}`
            : '/supply-chain/returns'
      }
      return null
    }

    return (
      <div className="space-y-4">
        <StepHeader
          title="Review Existing Transactions"
          subtitle="Choose one policy for the eligible existing Stock Adjustments, Returns and Stock Transfers. Nothing is deleted, cancelled, or re-posted, and Opening Balance stays preview/read-only."
          remaining={workspace?.transactionsRemaining ?? 0}
        />

        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-900">{TRANSACTIONS_POLICY_HEADING}</p>
          {boundaryAt && (
            <p className="text-xs text-slate-500">
              Cut-off boundary: {new Date(boundaryAt).toLocaleString()} — transactions before this timestamp, in this warehouse and category, are in scope.
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            {TRANSACTIONS_POLICY_ORDER.map(p => {
              const active = isCardActive(p)
              return (
                <button
                  key={p}
                  type="button"
                  disabled={busy || txPolicyBusy}
                  onClick={() => {
                    if (p === 'review_select') {
                      setTxReviewDraft(true)
                      if (savedPolicy?.policy === 'review_select' && selectedTx.size === 0) {
                        setSelectedTx(new Set([
                          ...savedPolicy.carriedAdjustmentIds.map(id => `stock_adjustment:${id}`),
                          ...savedPolicy.carriedReturnIds.map(id => `return:${id}`),
                          ...savedPolicy.carriedTransferIds.map(id => `stock_transfer:${id}`),
                        ]))
                      }
                      return
                    }
                    // Switching to Start Fresh / Carry All supersedes any stale
                    // review selection before saving.
                    setTxReviewDraft(false)
                    setSelectedTx(new Set())
                    void openTransactionsPolicyConfirmation(p, [])
                  }}
                  className={`rounded-lg border p-4 text-left transition ${
                    active
                      ? (p === 'review_select' ? 'border-orange-500 bg-orange-50' : 'border-slate-900 bg-slate-900 text-white')
                      : 'border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{TRANSACTIONS_POLICY_LABELS[p]}</p>
                    {savedPolicy?.policy === p && !(p !== 'review_select' && txReviewDraft) && (
                      <Badge className="bg-emerald-100 text-emerald-800">Saved</Badge>
                    )}
                  </div>
                  <p className={`mt-2 text-xs ${active && p !== 'review_select' ? 'text-slate-200' : 'text-slate-600'}`}>
                    {TRANSACTIONS_POLICY_DESCRIPTIONS[p]}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Summary tiles — every policy shows a zero Opening Balance inventory impact. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <SummaryCard label="Eligible transactions" value={num(eligibleCount)} />
          <SummaryCard label="Carried forward" value={num(carriedCount)} />
          <SummaryCard label="Historical excluded" value={num(excludedCount)} />
          <SummaryCard label="Requires individual resolution" value={num(blockedCount)} tone={blockedCount > 0 ? 'danger' : undefined} />
          <SummaryCard label="Inventory impact during Opening Balance" value="0" tone="ok" />
        </div>

        {!hasTypedEligibility && rows.length === 0 && eligibleCount === 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            No eligible existing transactions were found for this warehouse and category.
          </div>
        )}

        {/* Guided arrival banner — the operator was sent here to resolve a blocker. */}
        {focusedHere?.fromReview && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
            <span className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" /> You were brought here to resolve the blocker preventing Opening Balance posting.
            </span>
            <Button size="sm" variant="outline" onClick={() => { setFocusBlocker(null); setStep('review') }}>
              Return to Review &amp; Post
            </Button>
          </div>
        )}

        {/* Could not match the reported blocker to a visible record — never silently "All resolved". */}
        {focusedHere && !focusMatched && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">The blocker could not be matched to a visible transaction.</p>
            <p className="mt-1">Refresh the Opening Balance report to reload the latest blockers, or open technical details from Review &amp; Post.</p>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={() => void preview()} disabled={!activeCutoff || busy}>
                {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Refresh Opening Balance report
              </Button>
            </div>
          </div>
        )}

        {/* Items Requiring Individual Resolution — typed rows PLUS orphan allocations. */}
        {(blockedRows.length > 0 || allocationBlockers.length > 0) && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-800">
              <AlertTriangle className="h-4 w-4" /> Items Requiring Individual Resolution ({blockedCount})
            </p>
            <div className="space-y-2">
              {allocationBlockers.map(blocker => (
                <AllocationBlockerCard
                  key={blocker.id}
                  blocker={blocker}
                  highlighted={focusedHere?.id === blocker.id}
                  onOpenSource={href => router.push(href)}
                  onResolve={(b, action) => { setResolveReason(''); setResolveTarget({ blocker: b, action }) }}
                />
              ))}
              {blockedRows.map((r: any) => (
                <TransactionRow
                  key={txKey(r)}
                  row={r}
                  href={externalHref(r)}
                  expanded={expandedTx.has(txKey(r))}
                  onToggle={() => setExpandedTx(prev => {
                    const next = new Set(prev)
                    next.has(txKey(r)) ? next.delete(txKey(r)) : next.add(txKey(r))
                    return next
                  })}
                  onOpen={href => router.push(href)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Review list + checkboxes — only when Review is the active policy. */}
        {showReviewList && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">Review transactions to carry forward</p>
              <p className="text-xs text-slate-500">{TRANSACTIONS_REVIEW_CHECKBOX_HINT}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {TRANSACTIONS_FILTERS.map(f => (
                <Button
                  key={f.id}
                  size="sm"
                  variant={txFilter === f.id ? 'default' : 'outline'}
                  onClick={() => setTxFilter(f.id)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={txPolicyBusy || eligibleRefs.length === 0}
                onClick={() => setSelectedTx(new Set(eligibleRefs.map(r => `${r.type}:${r.id}`)))}
              >
                Select all eligible
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={txPolicyBusy || selectedTx.size === 0}
                onClick={() => setSelectedTx(new Set())}
              >
                Clear
              </Button>
              <Badge variant="outline">{checkedRefs.length} carried · {Math.max(eligibleCount - checkedRefs.length, 0)} historical excluded</Badge>
              <Button
                size="sm"
                disabled={txPolicyBusy}
                onClick={() => void openTransactionsPolicyConfirmation('review_select', checkedRefs)}
              >
                {txPolicyBusy ? 'Checking…' : 'Save Transactions Policy'}
              </Button>
            </div>
            {filteredRows.length === 0
              ? <EmptyState message="No transactions match this filter." />
              : (
                <div className="space-y-2">
                  {filteredRows.map((r: any) => {
                    const eligible = r.eligibility === 'eligible'
                    return (
                      <TransactionRow
                        key={txKey(r)}
                        row={r}
                        href={externalHref(r)}
                        checkbox={eligible ? {
                          checked: selectedTx.has(txKey(r)),
                          onChange: () => setSelectedTx(prev => {
                            const next = new Set(prev)
                            next.has(txKey(r)) ? next.delete(txKey(r)) : next.add(txKey(r))
                            return next
                          }),
                        } : undefined}
                        expanded={expandedTx.has(txKey(r))}
                        onToggle={() => setExpandedTx(prev => {
                          const next = new Set(prev)
                          next.has(txKey(r)) ? next.delete(txKey(r)) : next.add(txKey(r))
                          return next
                        })}
                        onOpen={href => router.push(href)}
                      />
                    )
                  })}
                </div>
              )}
          </div>
        )}

        {savedPolicy && (
          <CollapsibleSection
            title={`Historical Transactions Excluded from Baseline (${savedPolicy.excludedCount})`}
            open={showExcludedTx}
            onToggle={() => setShowExcludedTx(v => !v)}
          >
            <div className="space-y-2 text-sm text-slate-700">
              <p>{hist?.notice || `${savedPolicy.excludedCount} eligible transactions are excluded from the new inventory baseline.`}</p>
              <p className="text-xs text-slate-500">No transaction cancelled or deleted. No processed quantity replayed. Records preserved for audit.</p>
            </div>
          </CollapsibleSection>
        )}

        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void preview()}
            disabled={!activeCutoff || busy}
          >
            {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            Refresh transactions
          </Button>
        </div>
      </div>
    )
  }

  // =========================================================================
  // Step 5 — Final review & post
  // =========================================================================
  function renderReviewStep() {
    if (!report || !workspace || !readiness) return null
    const s = workspace.summary
    // Human-readable context only — raw session/warehouse/org UUIDs are never shown.
    const orgLabel = userProfile?.organizations?.org_name?.trim() || 'Organization unavailable'
    const boundaryRaw = report.cutoff_boundary_at || report.proposed_cutoff_at
    const boundaryLabel = boundaryRaw ? new Date(boundaryRaw).toLocaleString() : '—'
    const d2hPolicyLabel = workspace.d2hPolicy
      ? (workspace.d2hPolicy.policy === 'exclude_all' ? 'Start Fresh' : 'Review & Select')
      : 'Not saved'
    const h2mPolicyLabel = workspace.h2mPolicy
      ? (workspace.h2mPolicy.policy === 'exclude_all' ? 'Start Fresh' : 'Review & Select')
      : 'Not saved'
    const txPolicyLabel = workspace.transactionsPolicy
      ? TRANSACTIONS_POLICY_LABELS[workspace.transactionsPolicy.policy]
      : 'Not saved'
    // OTP may only be requested when the SERVER says Ready (via `executable`) and
    // the caller is an HQ Admin. Never gated on client-displayed counts.
    const canRequestOtp = executable && isHqAdmin
    const badgeClass = readiness.ready
      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
      : readiness.level === 'blocked'
        ? 'bg-red-100 text-red-800 border border-red-200'
        : 'bg-amber-100 text-amber-800 border border-amber-200'

    return (
      <div className="space-y-5">
        {/* ---- One clear PRIMARY posting section --------------------------- */}
        <section aria-labelledby="final-verification-heading" className="rounded-lg border-2 border-orange-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id="final-verification-heading" className="text-lg font-semibold">Final Verification &amp; Posting</h3>
              <p className="max-w-3xl text-sm text-slate-600">Review the Opening Balance summary, resolve any genuine blockers, then request an OTP to post atomically.</p>
            </div>
            <Badge className={badgeClass}>{readiness.statusLabel}</Badge>
          </div>

          <dl className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <SummaryRow label="Opening Balance reference" value={draftLabel} />
            <SummaryRow label="Warehouse" value={warehouseLabel} />
            <SummaryRow label="Organization" value={orgLabel} />
            <SummaryRow label="Product category" value={categoryLabel} />
            <SummaryRow label="Effective boundary" value={boundaryLabel} />
            <SummaryRow label="Physical opening quantity" value={`${num(s.physicalOpeningStock.totalQuantity)} units`} />
            <SummaryRow label="D2H policy" value={d2hPolicyLabel} />
            <SummaryRow label="H2M policy" value={h2mPolicyLabel} />
            <SummaryRow label="Transactions policy" value={txPolicyLabel} />
            <SummaryRow label="Carried-forward (D2H)" value={`${s.distributorCarryForward.orderCount} orders`} />
            <SummaryRow label="Historical-excluded" value={`${s.excludedDoNotCarryForward.orderCount} orders`} />
            <SummaryRow label="Genuine blockers" value={`${readiness.blockerCount}`} tone={readiness.blockerCount > 0 ? 'danger' : 'ok'} />
            <SummaryRow label="Pending-transaction inventory impact" value="Zero" />
            <SummaryRow label="Readiness" value={readiness.statusLabel} />
          </dl>

          {/* Posting Note — required by prepare_stock_count_verification when any
              counted row has a non-zero adjustment. Persisted to session.notes
              before OTP request / verify; never cleared by preview refresh. */}
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <Label htmlFor="opening-balance-posting-note" className="text-sm font-semibold text-slate-900">
              Posting Note{hasCountVariance ? <span className="ml-1 text-red-600">*</span> : null}
            </Label>
            <p className="mt-1 text-xs text-slate-600">
              Audit note for this Opening Balance and any physical-versus-system variance.
              {hasCountVariance
                ? ' Required because this count contains variance.'
                : ' Optional when there is no variance.'}
            </p>
            <Textarea
              id="opening-balance-posting-note"
              ref={postingNoteInputRef}
              value={postingNote}
              onChange={event => {
                postingNoteDirtyRef.current = true
                setPostingNote(event.target.value)
                if (postingNoteError) setPostingNoteError(null)
                if (verificationError) setVerificationError(null)
              }}
              placeholder={`Opening balance based on verified physical stock count as of ${new Date().toLocaleDateString()}.\nHistorical system variance is excluded under the Start Fresh policy.`}
              className="mt-2 min-h-[96px] bg-white"
              aria-invalid={Boolean(postingNoteError)}
              aria-describedby={postingNoteError ? 'opening-balance-posting-note-error' : undefined}
            />
            {postingNoteError && (
              <p id="opening-balance-posting-note-error" className="mt-1 text-sm font-medium text-red-700" role="alert">
                {postingNoteError}
              </p>
            )}
          </div>

          {/* Zero blockers (server 'Ready' or 'Review Required') → OTP request/verify,
              with any advisory review items listed. Real blockers → blocker list.
              Never claim "Ready to Post" while a verification error is displayed. */}
          {readiness.blockerCount === 0 ? (
            <div className={`mt-4 rounded-lg border-2 p-4 ${
              verificationError
                ? 'border-red-300 bg-red-50'
                : readiness.ready
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-amber-200 bg-amber-50'
            }`}>
              <p className={`font-semibold ${
                verificationError ? 'text-red-900' : readiness.ready ? 'text-emerald-900' : 'text-amber-950'
              }`}>
                {verificationError
                  ? 'Verification unavailable'
                  : readiness.ready
                    ? 'Ready to Post'
                    : 'No blockers — OTP may be requested'}
              </p>
              <p className={`mt-1 text-sm ${
                verificationError ? 'text-red-800' : readiness.ready ? 'text-emerald-800' : 'text-amber-900'
              }`}>
                {verificationError
                  ? 'Inventory was not changed. The details and what to do next are shown below.'
                  : readiness.ready
                    ? 'No blockers remain. Posting adds zero inventory from pending transactions and is re-validated atomically after OTP verification.'
                    : `Server readiness is “${readiness.statusLabel}”. Advisory review items do not block posting; Request OTP uses the same counted session snapshot as this preview.`}
              </p>
              {(() => {
                const reviewItems = Array.isArray((report as { review_items?: unknown[] }).review_items)
                  ? ((report as { review_items?: string[] }).review_items ?? [])
                  : []
                if (reviewItems.length === 0) return null
                return (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm font-medium text-amber-900">Advisories — review before posting (these do not block posting):</p>
                    <ul className="mt-2 space-y-1">
                      {reviewItems.map((item, index) => (
                        <li key={`advisory-${index}`} className="text-sm text-amber-900">• {String(item)}</li>
                      ))}
                    </ul>
                  </div>
                )
              })()}
              {!requestId ? (
                <div className="mt-3 space-y-2">
                  {/* Any failure before a code exists — a rejected OTP request, or
                      a post whose request turned out to be spent (used / expired /
                      snapshot changed) — is reported here. In the spent case the
                      OTP input is withdrawn entirely, so a code the server will
                      reject can never be re-submitted. */}
                  {verificationError && (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">
                      {otpRequiresRefresh && <p className="font-semibold">A new verification code is required</p>}
                      <p className={otpRequiresRefresh ? 'mt-1 font-medium' : 'font-medium'}>{verificationError}</p>
                      {verificationErrorReference && (
                        <p className="mt-1 font-mono text-xs text-red-700">Reference: {verificationErrorReference}</p>
                      )}
                      {otpRequiresRefresh && (
                        <p className="mt-1">Your Posting Note has been kept. Request a new code to try again.</p>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={requestVerification} disabled={!canRequestOtp || busy}>
                      {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                      {otpRequiresRefresh ? 'Request a new OTP' : 'Request OTP'}
                    </Button>
                    {!isHqAdmin && <span className="text-xs text-slate-700">Only an HQ Admin may request the OTP and post.</span>}
                  </div>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {/* Never reassure the operator that a code is usable while the
                      last attempt is showing an error. */}
                  {!verificationError && (
                    <p className="text-sm font-medium text-emerald-900">
                      A verification code was sent. Enter it below to post the Opening Balance.
                      {otpExpiresAt && (
                        <span className="ml-1 font-normal text-emerald-800">Code expires {new Date(otpExpiresAt).toLocaleTimeString()}.</span>
                      )}
                    </p>
                  )}
                  {verificationError && (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                      <p className="font-medium">{verificationError}</p>
                      {verificationErrorReference && (
                        <p className="mt-1 font-mono text-xs text-red-700">Reference: {verificationErrorReference}</p>
                      )}
                      <p className="mt-1 text-red-900">
                        Inventory was not changed and your Posting Note has been kept.
                        {otpExpiresAt && ` This code remains valid until ${new Date(otpExpiresAt).toLocaleTimeString()}; use “Resend code” if it has expired.`}
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <Label className="text-xs">8-digit code</Label>
                      <Input
                        value={otp}
                        onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 8))}
                        className="h-9 w-40 font-mono tracking-widest"
                        inputMode="numeric"
                        aria-label="Opening Balance OTP code"
                      />
                    </div>
                    <Button size="sm" className="bg-red-700 hover:bg-red-800" onClick={execute} disabled={!executable || otp.length !== 8 || busy}>
                      Verify OTP &amp; Post Opening Balance
                    </Button>
                    <Button size="sm" variant="outline" onClick={requestVerification} disabled={!canRequestOtp || busy}>
                      Resend code
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border-2 border-amber-200 bg-amber-50 p-4">
              <p className="font-semibold text-amber-950">{readiness.statusLabel} — resolve the {readiness.blockerCount} blocker(s) below</p>
              <p className="mt-1 text-sm text-amber-900">The OTP request stays disabled until the server reports zero blockers.</p>
              <ul className="mt-3 space-y-2">
                {readiness.blockers.map((blocker, index) => (
                  <li key={`${blocker.type}-${blocker.reference ?? index}`} className="rounded-md border border-amber-200 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">
                          {blocker.type}
                          {blocker.reference && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{blocker.reference}</span>}
                        </p>
                        <p className="text-xs text-slate-500">Step: {OPENING_BALANCE_STEPS.find(step => step.id === blocker.step)?.short ?? blocker.step}</p>
                        <p className="mt-1 text-sm text-amber-900">{blocker.reason}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => resolveBlocker(blocker)}>{blocker.actionLabel}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ---- Bucket breakdown (secondary, informational) ---------------- */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ReviewCard label="Physical Opening Stock" primary={`${num(s.physicalOpeningStock.totalQuantity)} units`} secondary={`${s.physicalOpeningStock.countedRows} configs counted`} onClick={() => setStep('freeze')} />
          <ReviewCard label="H2M Incoming After Cut-off" primary={`${s.manufacturerIncomingAfterCutoff.orderCount} orders`} secondary={`${num(s.manufacturerIncomingAfterCutoff.totalQuantity)} units · not posted now`} onClick={() => setStep('h2m')} />
          <ReviewCard
            label="H2M Policy"
            primary={h2mPolicyLabel}
            secondary={workspace.h2mPolicy
              ? `${workspace.h2mPolicy.excludedOrderCount || workspace.h2mPolicy.eligibleOrderCount} excluded · ${workspace.h2mPolicy.selectedOrderCount} expected incoming`
              : 'Choose Option A or B in Step 3'}
            onClick={() => setStep('h2m')}
          />
          <ReviewCard
            label="D2H Policy"
            primary={d2hPolicyLabel}
            secondary={workspace.d2hPolicy
              ? `${workspace.d2hPolicy.excludedOrderCount || workspace.d2hPolicy.eligibleOrderCount} excluded · ${workspace.d2hPolicy.selectedOrderCount} carried`
              : 'Choose Option A or B in Step 2'}
            onClick={() => setStep('d2h')}
          />
          <ReviewCard label="D2H Carried Into New Inventory" primary={`${s.distributorCarryForward.orderCount} orders`} secondary={`${num(s.distributorCarryForward.totalQuantity)} units`} onClick={() => setStep('d2h')} />
          <ReviewCard label="D2H Historical Excluded" primary={`${s.excludedDoNotCarryForward.orderCount} orders`} secondary={`${num(s.excludedDoNotCarryForward.totalQuantity)} units · no baseline impact`} onClick={() => setStep('d2h')} />
          <ReviewCard label="Stock in Transit" primary={`${s.stockInTransit.orderCount} records`} secondary="Protected — excluded from opening stock" onClick={() => setStep('transactions')} />
          <ReviewCard
            label="Other Operational Transactions"
            primary={transactionsSummary.remainingLabel === 'All resolved' ? 'None to resolve' : transactionsSummary.remainingLabel}
            secondary={`${activityGroups.safe.length} safe · ${activityGroups.history.length} history`}
            onClick={() => setStep('transactions')}
          />
          <ReviewCard label="Unresolved / Blocked" primary={`${readiness.blockerCount} blocker(s)`} secondary={readiness.blockerCount === 0 ? 'None — ready to post' : 'Resolve before posting'} tone={readiness.blockerCount > 0 ? 'danger' : 'ok'} onClick={() => { const first = readiness.blockers[0]; if (first) resolveBlocker(first) }} />
        </div>

        {/* ---- DANGER ZONE: collapsed by default; never part of normal post flow */}
        {activeCutoff && (
          <section aria-labelledby="danger-zone-heading" className="rounded-lg border border-slate-300 bg-slate-50">
            <button
              type="button"
              id="danger-zone-heading"
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              aria-expanded={dangerZoneOpen}
              onClick={() => setDangerZoneOpen(open => !open)}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <AlertTriangle className="h-4 w-4 text-red-700" />
                Danger Zone / More Actions
              </span>
              {dangerZoneOpen ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
            </button>
            {dangerZoneOpen && (
              <div className="space-y-3 border-t border-slate-200 bg-red-50 px-4 py-4">
                <div>
                  <h3 className="text-base font-semibold text-red-800">Cancel Entire Opening Balance Exercise</h3>
                  <p className="mt-1 max-w-3xl text-sm text-red-800">
                    This abandons &apos;{draftLabel}&apos; entirely, reopens the warehouse, and keeps the exercise as read-only history.
                    Use the sticky Back button if you are only not ready to post yet — Back does not cancel the exercise.
                  </p>
                  {requestId && (
                    <p className="mt-2 max-w-3xl text-xs font-medium text-red-800">
                      Verification started — Cancel Entire Opening Balance Exercise is required to stop this exercise. Hard discard is no longer available.
                    </p>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                  <div>
                    <Label htmlFor="cancellation-reason">Cancellation Reason</Label>
                    <Input
                      id="cancellation-reason"
                      value={cancelReason}
                      onChange={event => setCancelReason(event.target.value)}
                      onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }}
                      placeholder="Why is this Opening Balance being abandoned?"
                    />
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => { setCancelConfirmText(''); setCancelModalOpen(true) }}
                    disabled={busy || !cancelReason.trim() || !isHqAdmin}
                  >
                    Cancel Entire Opening Balance Exercise
                  </Button>
                </div>
                {!isHqAdmin && <p className="text-xs text-red-700">Only an HQ Admin may cancel an Opening Balance exercise.</p>}
              </div>
            )}
          </section>
        )}
      </div>
    )
  }

  function decisionLabel(decision: CutoffDecision): string {
    return decision === 'carry_forward' ? 'Carry Into New Inventory'
      : decision === 'cancel_release' ? 'Cancel & Release'
      : decision === 'do_not_carry_forward' ? 'Keep as Historical'
      : decision === 'carry_forward_incoming' ? 'Incoming After Cut-off'
      : 'History Only'
  }

}

// ===========================================================================
// Presentational subcomponents (pure, memo-friendly, no data fetching)
// ===========================================================================

function StepProgress({ current, onSelect, remaining, freezeActive }: {
  current: OpeningBalanceStepId
  onSelect: (id: OpeningBalanceStepId) => void
  remaining: Record<OpeningBalanceStepId, number> | null
  freezeActive: boolean
}) {
  const currentIndex = OPENING_BALANCE_STEPS.findIndex(s => s.id === current)
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b bg-slate-50 px-4 py-3" aria-label="Opening Balance steps">
      {OPENING_BALANCE_STEPS.map((s, index) => {
        const isCurrent = s.id === current
        const isPast = index < currentIndex
        const pending = remaining?.[s.id] ?? 0
        const complete = s.id === 'freeze' ? freezeActive : pending === 0
        return (
          <div key={s.id} className="flex items-center">
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                isCurrent ? 'bg-orange-600 text-white'
                  : isPast || complete ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${isCurrent ? 'bg-white/25' : complete ? 'bg-emerald-200 text-emerald-900' : 'bg-slate-200 text-slate-700'}`}>
                {complete && !isCurrent ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <span>{s.short}</span>
              {pending > 0 && s.id !== 'freeze' && s.id !== 'review' && (
                <span className="rounded-full bg-amber-500 px-1.5 text-xs font-bold text-white">{pending}</span>
              )}
            </button>
            {index < OPENING_BALANCE_STEPS.length - 1 && <ChevronRight className="mx-0.5 h-4 w-4 text-slate-400" />}
          </div>
        )
      })}
    </nav>
  )
}

function StepHeader({ title, subtitle, remaining, remainingLabel }: {
  title: string
  subtitle: string
  remaining: number
  remainingLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="max-w-3xl text-sm text-slate-600">{subtitle}</p>
      </div>
      <Badge className={remaining > 0 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}>
        {remaining > 0
          ? (remainingLabel || `${remaining} decision(s) remaining`)
          : 'All resolved'}
      </Badge>
    </div>
  )
}

function WorkspaceControls({ search, onSearch, filter, onFilter, placeholder }: {
  search: string
  onSearch: (value: string) => void
  filter: WorkspaceFilter
  onFilter: (value: WorkspaceFilter) => void
  placeholder: string
}) {
  const filters: { id: WorkspaceFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'action', label: 'Action Required' },
    { id: 'resolved', label: 'Resolved' },
    { id: 'blocked', label: 'Blocked' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[220px]">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input value={search} onChange={event => onSearch(event.target.value)} placeholder={placeholder} className="pl-8" />
      </div>
      <div className="flex flex-wrap gap-1">
        {filters.map(f => (
          <Button key={f.id} size="sm" variant={filter === f.id ? 'default' : 'outline'} onClick={() => onFilter(f.id)}>{f.label}</Button>
        ))}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, sub, note, tone, onClick }: {
  label: string; value: string; sub?: string; note?: string; tone?: 'ok' | 'warn' | 'danger'; onClick?: () => void
}) {
  const toneClass = tone === 'danger' ? 'border-red-200 bg-red-50' : tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
  const Wrapper: any = onClick ? 'button' : 'div'
  return (
    <Wrapper onClick={onClick} className={`rounded-lg border p-3 text-left ${toneClass} ${onClick ? 'transition hover:shadow-sm' : ''}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
      {note && (
        <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-red-700">
          <AlertTriangle className="h-3 w-3 shrink-0" />{note}
        </p>
      )}
    </Wrapper>
  )
}

/**
 * A guided-resolution card for an allocation-ownership reconciliation blocker.
 * Presentation only — it renders the authoritative reason, the reconciliation
 * arithmetic and the server-gated resolution actions. Mutating actions stay
 * disabled unless the server has validated them; nothing here changes inventory,
 * allocations, orders or QR data.
 */
function AllocationBlockerCard({ blocker, highlighted, onOpenSource, onResolve }: {
  blocker: OpeningBalanceBlockerDetail
  highlighted: boolean
  onOpenSource: (href: string) => void
  onResolve: (blocker: OpeningBalanceBlockerDetail, action: 'exclude_and_release' | 'mark_manual_investigation') => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const { identity } = blocker

  // Scroll the highlighted (guided-to) card into view once, when it mounts/updates.
  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlighted])

  const sourceHref = identity.sourceOrderId
    ? `/supply-chain/orders?orderId=${encodeURIComponent(identity.sourceOrderId)}`
    : identity.sourceOrderNumber
      ? `/supply-chain/orders?order=${encodeURIComponent(identity.sourceOrderNumber)}`
      : null

  const allocated = identity.allocatedQuantity ?? 0
  const selected = identity.selectedQuantity ?? 0
  const difference = identity.difference ?? (allocated - selected)

  return (
    <div
      ref={ref}
      data-blocker-id={blocker.id}
      data-testid="allocation-blocker-card"
      className={`rounded-lg border bg-white p-3 transition ${highlighted ? 'border-red-500 ring-2 ring-red-300' : 'border-red-200'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {blockerShortName(identity.variantName) !== (identity.variantName ?? '')
              ? identity.variantName
              : (identity.variantName || 'Allocation')}
          </p>
          <p className="text-xs text-slate-500">
            Configuration: {withStockStrengthUnit(identity.configLabel) || 'Unclassified (Pending Stock Take)'}
          </p>
        </div>
        <Badge className="bg-red-100 text-red-800">Requires Resolution</Badge>
      </div>

      {/* Reconciliation arithmetic. */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Inventory allocated</p>
          <p className="text-base font-bold text-slate-900">{allocated}</p>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Selected / carried</p>
          <p className="text-base font-bold text-slate-900">{selected}</p>
        </div>
        <div className="rounded border border-red-200 bg-red-50 p-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600">Difference</p>
          <p className="text-base font-bold text-red-700">{difference}</p>
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-700">{blocker.reason}</p>
      <p className="mt-1 text-xs text-slate-500">
        The system has {allocated} active inventory allocation{allocated === 1 ? '' : 's'}, but the selected carried-forward
        orders represent {selected} unit{selected === 1 ? '' : 's'} — no selected transaction currently owns this allocation.
      </p>

      {/* Source / status facts, shown only when the server supplied them. */}
      {(identity.sourceOrderNumber || identity.allocationStatus || identity.beforeCutoff != null) && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
          {identity.sourceOrderNumber && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{identity.sourceOrderNumber}</span>
          )}
          {identity.allocationStatus && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5">Allocation: {identity.allocationStatus}</span>
          )}
          {identity.beforeCutoff != null && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5">
              {identity.beforeCutoff ? 'Before cut-off boundary' : 'After cut-off boundary'}
            </span>
          )}
        </div>
      )}

      {/* No linked source order — never leave this ambiguous. */}
      {!identity.sourceOrderId && !identity.sourceOrderNumber && !identity.sourceDocumentRef && (
        <p className="mt-2 text-xs font-medium text-amber-700">
          No active source order is linked to this residual allocation.
        </p>
      )}

      {/* Server-gated resolution actions — mutating ones stay disabled until validated. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {blocker.resolutionActions.map(action => {
          const isOpenSource = action.kind === 'open_source_document'
          const enabled = action.available && (!isOpenSource || Boolean(sourceHref))
          return (
            <div key={action.kind} className="flex flex-col">
              <Button
                size="sm"
                variant={action.mutating ? 'default' : 'outline'}
                disabled={!enabled}
                onClick={() => {
                  if (isOpenSource && sourceHref) { onOpenSource(sourceHref); return }
                  if (action.kind === 'exclude_and_release') { onResolve(blocker, 'exclude_and_release'); return }
                  if (action.kind === 'mark_manual_investigation') { onResolve(blocker, 'mark_manual_investigation'); return }
                }}
              >
                {action.label}
              </Button>
              {!enabled && action.hint && (
                <span className="mt-0.5 max-w-[16rem] text-[11px] text-slate-400">{action.hint}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReviewCard({ label, primary, secondary, tone, onClick }: {
  label: string; primary: string; secondary: string; tone?: 'ok' | 'danger'; onClick: () => void
}) {
  return (
    <button onClick={onClick} className={`rounded-lg border p-3 text-left transition hover:shadow-sm ${tone === 'danger' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold">{primary}</p>
      <p className="text-xs text-slate-500">{secondary}</p>
    </button>
  )
}

function SummaryRow({ label, value, tone }: {
  label: string; value: string; tone?: 'ok' | 'danger'
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2 last:border-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-sm font-semibold ${tone === 'danger' ? 'text-red-700' : 'text-slate-900'}`}>{value}</dd>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">{message}</div>
}

function CollapsibleSection({ title, open, onToggle, children }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border">
      <button className="flex w-full items-center justify-between p-3 text-left text-sm font-semibold" onClick={onToggle}>
        <span>{title}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && <div className="border-t p-3">{children}</div>}
    </div>
  )
}

/**
 * One eligible/blocked existing transaction (Stock Adjustment / Return /
 * Stock Transfer) with an inline, working scoped detail. The checkbox is the
 * only row-level decision. Adjustments have no standalone detail route, so their
 * "detail" is this inline expansion — never a dead navigation.
 */
function TransactionRow({
  row,
  href,
  checkbox,
  expanded,
  onToggle,
  onOpen,
}: {
  row: any
  href: string | null
  checkbox?: { checked: boolean; onChange: () => void }
  expanded: boolean
  onToggle: () => void
  onOpen: (href: string) => void
}) {
  const type = row.movement_type as string
  const typeLabel = type === 'stock_adjustment' ? 'Stock Adjustment'
    : type === 'return' ? 'Return' : 'Stock Transfer'
  const reference = (row.reference_no && String(row.reference_no).trim())
    || (row.occurred_at ? `${typeLabel} · ${new Date(row.occurred_at).toLocaleDateString()}` : typeLabel)
  const blocked = row.eligibility === 'requires_resolution'
  const items: any[] = Array.isArray(row.items) ? row.items : []
  return (
    <div className={`rounded-lg border ${blocked ? 'border-red-200' : 'border-slate-200'} bg-white`}>
      <div className="flex flex-wrap items-center gap-2 p-3">
        {checkbox && (
          <Checkbox
            checked={checkbox.checked}
            onCheckedChange={() => checkbox.onChange()}
            aria-label={`Carry forward ${reference}`}
          />
        )}
        <button type="button" onClick={onToggle} className="text-slate-500">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{typeLabel}</Badge>
            <span className="text-sm font-semibold text-slate-900">{reference}</span>
            <Badge variant="outline">{row.status}</Badge>
            {row.classification && (
              <Badge className={row.classification === 'Carry Forward' ? 'bg-emerald-100 text-emerald-800'
                : row.classification === 'Requires Individual Resolution' ? 'bg-red-100 text-red-800'
                : 'bg-slate-100 text-slate-700'}>
                {row.classification}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {row.occurred_at ? new Date(row.occurred_at).toLocaleString() : '—'}
            {typeof row.line_count === 'number' ? ` · ${row.line_count} item(s)` : ''}
            {typeof row.quantity === 'number' ? ` · qty ${Number(row.quantity).toLocaleString()}` : ''}
          </p>
        </div>
        {href && (
          <Button size="sm" variant="outline" onClick={() => onOpen(href)}>
            View Transaction
          </Button>
        )}
      </div>
      {expanded && (
        <div className="border-t p-3 text-xs text-slate-600 space-y-1">
          <p><span className="font-semibold text-slate-700">Latest completed stage:</span> {row.latest_stage || '—'}</p>
          <p><span className="font-semibold text-slate-700">Remaining action:</span> {row.remaining_action || '—'}</p>
          <p><span className="font-semibold text-slate-700">Expected future inventory event:</span> {row.expected_event || '—'}</p>
          {blocked && row.blocker_reason && (
            <p className="text-red-700"><span className="font-semibold">Blocker:</span> {row.blocker_reason}</p>
          )}
          {items.length > 0 && (
            <div className="mt-1">
              <p className="font-semibold text-slate-700">Lines</p>
              {items.map((it, i) => (
                <p key={it.item_id || i} className="text-slate-600">
                  {(it.variant_name || 'Variant').trim()} · {withStockStrengthUnit(it.stock_configuration) || 'Unclassified'} · qty {Number(it.quantity || 0).toLocaleString()}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function D2hOrderCard({
  group,
  expanded,
  busy,
  carryForward,
  blockedOrderItemIds,
  preflightBusy,
  selected = false,
  selectable = false,
  onToggleSelect,
  onToggle,
  onRefreshRecheck,
  onOpenStockConfig,
}: {
  group: DistributorOrderGroup
  expanded: boolean
  busy: boolean
  carryForward: D2hCarryForwardStatus
  blockedOrderItemIds: Set<string>
  preflightBusy: boolean
  selected?: boolean
  selectable?: boolean
  onToggleSelect?: () => void
  onToggle: () => void
  onRefreshRecheck: () => void
  onOpenStockConfig: (item?: CarryForwardAffectedItem) => void
}) {
  const blocked = carryForward.blocked
  const fulfillmentEvidence = group.lines.some(line => line.has_order_fulfillment)
  const allocationEvidence = group.lines.some(line => line.has_active_allocation)
  return (
    <div className={`rounded-lg border ${blocked ? 'border-red-300' : group.hasBlocker ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2">
          {onToggleSelect && (
            <Checkbox
              checked={selected}
              disabled={!selectable || busy || blocked}
              onCheckedChange={() => onToggleSelect()}
              aria-label={`Select ${group.orderNumber}`}
            />
          )}
          <button className="flex items-center gap-2 text-left" onClick={onToggle}>
            {expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
            <div>
              <p className="font-semibold">{group.orderNumber}</p>
              <p className="text-xs text-slate-500">{group.customer} · {group.warehouse}</p>
              {(allocationEvidence || fulfillmentEvidence) && (
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {allocationEvidence ? 'Active allocation' : 'No active allocation'}
                  {' · '}
                  {fulfillmentEvidence ? 'Has order_fulfillment (cannot double-deduct)' : 'No fulfillment movement'}
                </p>
              )}
            </div>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {group.statuses.map(s => <Badge key={s} variant="outline">{s}</Badge>)}
          <span>{group.lineCount} items · {num(group.totalQuantity)} units</span>
          {blocked
            ? <Badge className="bg-red-100 text-red-800 border border-red-200">{carryForward.blockedLabel}</Badge>
            : selected
              ? <Badge className="bg-orange-100 text-orange-800 border border-orange-200">Selected to carry</Badge>
              : <Badge className="bg-slate-100 text-slate-700 border border-slate-200">Keep as Historical</Badge>}
          <Button size="sm" variant="ghost" onClick={onToggle}>{expanded ? 'Hide items' : 'View items'}</Button>
        </div>
      </div>

      {blocked && (
        <div className="border-t border-red-200 bg-red-50/70 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />Carry Forward unavailable
          </p>
          <p className="mt-1 text-sm text-red-900">{CARRY_FORWARD_BLOCKED_EXPLANATION}</p>
          <div className="mt-2 space-y-2">
            {carryForward.affected.map(item => (
              <div key={item.variantId} className="rounded-md border border-red-200 bg-white p-2 text-xs">
                <p className="font-semibold text-slate-800">
                  {item.variant}
                  {item.variantCode ? <span className="ml-1 font-normal text-slate-500">· {item.variantCode}</span> : null}
                  {item.productCode ? <span className="ml-1 font-normal text-slate-400">({item.productCode})</span> : null}
                </p>
                <p className="text-slate-600">{num(item.quantity)} units · {item.warehouse}</p>
                <p className="mt-1 font-medium text-red-800">{item.reason}</p>
                <p className="mt-1 text-slate-700">{item.correctiveAction}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenStockConfig(carryForward.affected[0])}>
              <Settings className="mr-2 h-3.5 w-3.5" />Open Stock Configuration
            </Button>
            <Button size="sm" variant="outline" onClick={onRefreshRecheck} disabled={preflightBusy}>
              {preflightBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}Refresh &amp; Recheck
            </Button>
            <Button size="sm" variant="ghost" onClick={onToggle}>View Affected Items</Button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t p-3">
          <Table>
            <TableHeader><TableRow><TableHead>Variant</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead>Selection effect</TableHead></TableRow></TableHeader>
            <TableBody>
              {group.lines.map(line => {
                const lineCarryForwardBlocked = Boolean(
                  line.order_item_id && blockedOrderItemIds.has(line.order_item_id),
                )
                return (
                  <TableRow key={line.order_item_id}>
                    <TableCell>{line.variant}</TableCell>
                    <TableCell><Badge variant="outline">{line.status}</Badge></TableCell>
                    <TableCell className="text-right">{num(line.quantity)}</TableCell>
                    <TableCell>
                      {line.status === 'submitted'
                        ? (selected && !lineCarryForwardBlocked
                          ? 'Carry Into New Inventory'
                          : 'Keep as Historical')
                        : 'Historical / non-actionable'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function H2mOrderCard({
  group,
  eligibility,
  eligibilityMap,
  expanded,
  busy,
  preflightBusy,
  selected,
  selectable,
  onToggle,
  onToggleSelect,
  onOpenStockConfig,
  onRefreshRecheck,
}: {
  group: ManufacturerOrderGroup
  eligibility: H2mOrderEligibility
  eligibilityMap: H2mIncomingEligibilityMap
  expanded: boolean
  busy: boolean
  preflightBusy: boolean
  selected: boolean
  selectable: boolean
  onToggle: () => void
  onToggleSelect: () => void
  onOpenStockConfig: (item?: H2mAffectedItem) => void
  onRefreshRecheck: () => void
}) {
  const blocked = eligibility.blockedCount > 0
  return (
    <div className={`rounded-lg border ${blocked ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selected}
            disabled={!selectable || busy || preflightBusy}
            onCheckedChange={onToggleSelect}
            aria-label={`Select actionable order ${group.orderNumber}`}
          />
          <button className="flex items-center gap-2 text-left" onClick={onToggle}>
            {expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
            <div>
              <p className="font-semibold">{group.orderNumber}</p>
              <p className="text-xs text-slate-500">{group.manufacturer}</p>
            </div>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {group.statuses.map(s => <Badge key={s} variant="outline">{s}</Badge>)}
          <span>{group.lineCount} items · ordered {num(group.orderedQuantity)} · received {num(group.receivedQuantity)} · remaining {num(group.remainingIncoming)}</span>
          {blocked && <Badge className="bg-amber-100 text-amber-800 border border-amber-200">{eligibility.blockedCount} config issue(s)</Badge>}
          {selected
            ? <Badge className="bg-orange-100 text-orange-800 border border-orange-200">Expected Incoming After Cut-off</Badge>
            : <Badge className="bg-slate-100 text-slate-700 border border-slate-200">Keep as Historical</Badge>}
          <Button size="sm" variant="ghost" onClick={onToggle}>{expanded ? 'Hide items' : 'View items'}</Button>
        </div>
      </div>
      {blocked && (
        <div className="border-t border-amber-200 bg-amber-50/70 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-950">
            <AlertTriangle className="h-4 w-4" />
            Expected Incoming unavailable for {eligibility.blockedCount} item(s)
          </p>
          <div className="mt-2 space-y-2">
            {eligibility.affected.map(item => (
              <div key={item.orderItemId} className="rounded-md border border-amber-200 bg-white p-2 text-xs">
                <p className="font-semibold text-slate-800">{item.variant}</p>
                <p className="text-slate-600">{num(item.quantity)} incoming · {item.warehouse}</p>
                <p className="mt-1 font-medium text-amber-900">{item.reason}</p>
                <p className="mt-1 text-slate-700">{item.correctiveAction}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenStockConfig(eligibility.affected[0])}>
              <Settings className="mr-2 h-3.5 w-3.5" />Open Stock Configuration
            </Button>
            <Button size="sm" variant="outline" disabled={preflightBusy} onClick={onRefreshRecheck}>
              {preflightBusy
                ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
              Refresh &amp; Recheck
            </Button>
          </div>
        </div>
      )}
      {expanded && (
        <div className="border-t p-3">
          <Table>
            <TableHeader><TableRow><TableHead>Variant</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead>Selected configuration</TableHead><TableHead>Selection effect</TableHead></TableRow></TableHeader>
            <TableBody>
              {group.lines.map(line => {
                const result = line.order_item_id ? eligibilityMap[line.order_item_id] : undefined
                const configurationLabel = result?.configLabel || line.stock_configuration
                return (
                  <TableRow key={line.order_item_id}>
                    <TableCell>{line.variant}</TableCell>
                    <TableCell className="text-right">{num(line.remaining_incoming_quantity)}</TableCell>
                    <TableCell>
                      {configurationLabel
                        ? configurationLabel
                        : result
                          ? <span className="text-red-700">Unavailable — {result.reasonCode.replace(/^inventory_cutoff_/, '').replaceAll('_', ' ')}</span>
                          : <span className="text-amber-700">Checking current configuration…</span>}
                    </TableCell>
                    <TableCell>
                      {selected && result?.incomingAvailable
                        ? 'Expected Incoming After Cut-off'
                        : 'Keep as Historical'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function activityDocumentKey(row: any, index: number): string {
  const technicalId = warehouseActivityTechnicalId(row)
  if (technicalId) return `activity:${technicalId}`
  const businessRef = (row.reference_no || '').trim()
  if (businessRef) return `activity-ref:${businessRef}:${row.movement_type || ''}`
  return `activity-row:${index}:${row.movement_type || ''}:${row.occurred_at || ''}`
}

function ActivityDocumentList({
  rows,
  highlight,
  expanded,
  onToggle,
  onOpen,
}: {
  rows: any[]
  highlight?: boolean
  expanded: Set<string>
  onToggle: (key: string) => void
  onOpen: (href: string) => void
}) {
  return (
    <div className={`space-y-2 ${highlight ? '' : ''}`}>
      {rows.map((row, index) => {
        const key = activityDocumentKey(row, index)
        const technicalId = warehouseActivityTechnicalId(row)
        const referenceLabel = formatWarehouseActivityReference(row)
        const items = warehouseActivityItems(row)
        const lineCount = warehouseActivityLineCount(row)
        const variantCount = warehouseActivityVariantCount(row)
        const quantity = warehouseActivityQuantity(row)
        const openHref = warehouseActivityOpenHref(row)
        const isOpen = expanded.has(key)
        return (
          <div
            key={key}
            className={`rounded-lg border bg-white ${highlight ? 'border-red-200' : 'border-slate-200'}`}
            data-activity-document={key}
            data-technical-id={technicalId || undefined}
          >
            <div className="flex flex-wrap items-start gap-3 p-3">
              <button
                type="button"
                className="mt-0.5 text-slate-500"
                aria-expanded={isOpen}
                onClick={() => onToggle(key)}
              >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-slate-900">{formatWarehouseActivityType(row.movement_type)}</p>
                  <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-200">
                    {formatActivityRequiredAction(row)}
                  </Badge>
                </div>
                <p
                  className="text-sm text-slate-700"
                  title={technicalId ? `Technical id: ${technicalId}` : undefined}
                >
                  {referenceLabel}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>Status: {row.status || 'posted'}</span>
                  <span>{variantCount} {variantCount === 1 ? 'variant' : 'variants'}</span>
                  <span>{lineCount} {lineCount === 1 ? 'item' : 'items'}</span>
                  <span>Qty {num(quantity)}</span>
                  <span>{row.occurred_at ? new Date(row.occurred_at).toLocaleString() : '—'}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => onToggle(key)}>
                  {isOpen ? 'Hide items' : 'View items'}
                </Button>
                {openHref && (
                  <Button size="sm" variant="outline" onClick={() => onOpen(openHref)}>
                    {warehouseActivityOpenLabel(row)}
                  </Button>
                )}
              </div>
            </div>
            {isOpen && (
              <div className="border-t border-slate-100 px-3 py-2">
                {items.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No variant-level detail is available for this document. Open the original transaction to inspect lines.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Variant</TableHead>
                          <TableHead>Configuration</TableHead>
                          <TableHead>Warehouse</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item, itemIndex) => (
                          <TableRow key={`${item.item_id || item.variant_id || 'item'}-${itemIndex}`}>
                            <TableCell>{formatActivityVariantLabel(item)}</TableCell>
                            <TableCell>{formatActivityStockConfiguration(item)}</TableCell>
                            <TableCell>{item.warehouse || row.warehouse || '—'}</TableCell>
                            <TableCell>{item.status || row.status || '—'}</TableCell>
                            <TableCell className="text-right">{num(item.quantity)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
