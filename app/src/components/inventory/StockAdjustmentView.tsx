'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/use-toast'
import { getStorageUrl } from '@/lib/utils'
import { normalizeBaseCost, stockCountImpact, sumStockCountImpacts } from '@/lib/inventory/stock-count-costing'
import {
  CLASSIFICATION_LEGACY_CONFIG_CODE as LEGACY_CONFIG_CODE,
  CLASSIFICATION_TARGET_CONFIG_CODES as TARGET_CONFIG_CODES,
  buildInitialClassificationGroups,
  computeClassificationEntry,
  getClassificationCardDisplay,
  summarizeClassificationRound,
} from '@/lib/inventory/stock-count-classification'
import { stockCountRowsSignature } from '@/lib/inventory/stock-count-snapshot'
import {
  buildStockCountWorksheet,
  parseStockCountWorksheet,
  buildClassificationWorksheet,
  parseClassificationWorksheet,
} from '@/lib/inventory/stock-count-excel'
import {
  STOCK_COUNT_POST_PERMISSION,
  isValidStockCountPostingNote,
  normalizeStockCountPostingNote,
  stockCountPermissionGate,
  stockCountVerificationError,
} from '@/lib/inventory/stock-count-verification-errors'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns3,
  Download,
  FileSpreadsheet,
  Loader2,
  MessageSquare,
  Package,
  RotateCcw,
  Save,
  Search,
  Upload,
  Warehouse,
} from 'lucide-react'

type CountType = 'full_count' | 'cycle_count' | 'spot_check' | 'initial_configuration_classification'
type SessionStatus = 'draft' | 'posted' | 'archived'

interface WarehouseLocation {
  id: string
  org_code: string
  org_name: string
}

interface CountRow {
  inventoryId: string | null
  stockConfigId: string
  configCode: string
  stockSku: string
  configLabel: string
  volumeMl: number | null
  packagingVersion: string | null
  configStatus: string
  variantId: string
  productName: string
  productCode: string
  groupId: string
  groupName: string
  groupDescription: string | null
  brandLogoUrl: string | null
  variantName: string
  variantCode: string
  manufacturerSku: string | null
  manualSku: string | null
  imageUrl: string | null
  systemQuantity: number
  physicalCount: string
  note: string
  unitCost: number | null
  warehouseLocation: string | null
}

interface DraftSession {
  id: string
  reference_name: string | null
  count_date: string
  count_type: CountType
  status: SessionStatus
  updated_at: string | null
}

interface ImportSummary {
  updated: number
  unchanged: number
  failed: number
  rows: Array<{ row: number; sku: string; status: 'Updated' | 'Unchanged' | 'Failed'; message: string }>
}

interface ReviewBreakdownLine {
  key: string
  label: string
  system: number
  physical: number | null
}

interface CountBreakdownGroup {
  kind: 'count'
  variantId: string
  heading: string
  lines: ReviewBreakdownLine[]
}

interface ClassificationBreakdownGroup {
  kind: 'classification'
  variantId: string
  heading: string
  legacy: { label: string; system: number }
  lines: ReviewBreakdownLine[]
  targetTotal: number
  variance: number
  complete: boolean
}

type ReviewBreakdownGroup = CountBreakdownGroup | ClassificationBreakdownGroup

interface VerificationState {
  requestId: string
  sessionId: string
  recipients: string[]
  expiresAt: string
  resendAvailableAt: string
}

interface PreflightState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  code?: string
  message?: string
  guidance?: string
  recipientCount?: number
}

interface StockAdjustmentViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

const ALL_GROUP_ID = 'all'
const UNGROUPED_GROUP_ID = 'ungrouped'
// Kept as one policy constant so this can move to organization settings later.
const HIGH_IMPACT_VALUE_THRESHOLD = 10_000
const todayIso = () => new Date().toISOString().slice(0, 10)
const countTypeOptions: Array<{ value: CountType; label: string }> = [
  { value: 'full_count', label: 'Full Count' },
  { value: 'cycle_count', label: 'Cycle Count' },
  { value: 'spot_check', label: 'Spot Check' },
  { value: 'initial_configuration_classification', label: 'Initial Configuration Classification' },
]
// Signature of a Stock Count draft with nothing counted yet. A fresh or reset
// session starts here so it is never falsely flagged as having unsaved changes.
const EMPTY_SIGNATURE = stockCountRowsSignature([])
const UNSAVED_CHANGES_MESSAGE = 'Imported or edited counts have not been saved yet. Save the draft, then reopen Review & Post.'
const formatNumber = (value: number) => value.toLocaleString('en-MY')
const formatMoney = (value: number) => `RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const parseCount = (value: string) => (value.trim() === '' ? null : Number(value))
const skuForRow = (row: CountRow) => row.stockSku
const varianceForRow = (row: CountRow) => {
  const physical = parseCount(row.physicalCount)
  return physical === null ? null : physical - row.systemQuantity
}
const adjustmentValueForRow = (row: CountRow) => {
  const variance = varianceForRow(row)
  return variance === null ? null : stockCountImpact(variance, row.unitCost)
}

export default function StockAdjustmentView({ userProfile, onViewChange }: StockAdjustmentViewProps) {
  const { isReady, supabase } = useSupabaseAuth()
  const { hasPermission, loading: permissionLoading } = usePermissions(
    userProfile?.roles?.role_level,
    userProfile?.role_code,
    userProfile?.department_id,
  )
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const postingNoteRecheckTimerRef = useRef<number | null>(null)
  const postingNoteRecheckPendingRef = useRef(false)

  const [warehouseLocations, setWarehouseLocations] = useState<WarehouseLocation[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [countDate, setCountDate] = useState(todayIso())
  const [countType, setCountType] = useState<CountType>('full_count')
  const [referenceName, setReferenceName] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<CountRow[]>([])
  const [drafts, setDrafts] = useState<DraftSession[]>([])
  const [staleDraftIds, setStaleDraftIds] = useState<Set<string>>(new Set())
  const [archivingDraftId, setArchivingDraftId] = useState<string | null>(null)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentStatus, setCurrentStatus] = useState<SessionStatus>('draft')
  const [selectedGroupId, setSelectedGroupId] = useState(ALL_GROUP_ID)
  const [searchTerm, setSearchTerm] = useState('')
  const [showVarianceOnly, setShowVarianceOnly] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [groupExpanded, setGroupExpanded] = useState(true)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  // Signature of the row state last persisted to stock_count_session_items. The
  // draft is "dirty" whenever the on-screen counts differ from this — the exact
  // condition that let a stale import post in the incident.
  const [lastSavedSignature, setLastSavedSignature] = useState(EMPTY_SIGNATURE)
  // Set by importExcel so the effect below persists the imported counts once
  // React has committed them (setRows is async; we cannot save in the same tick).
  const [pendingAutoSave, setPendingAutoSave] = useState(false)
  // The row signature bound to the currently issued verification code. Any
  // change after the code was requested makes the code stale (requirement E/F).
  const [verifiedSignature, setVerifiedSignature] = useState<string | null>(null)
  const [confirmPostOpen, setConfirmPostOpen] = useState(false)
  const [verification, setVerification] = useState<VerificationState | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [preflight, setPreflight] = useState<PreflightState>({ status: 'idle' })
  const [verificationNow, setVerificationNow] = useState(Date.now())
  const [visibleColumns, setVisibleColumns] = useState({ unitCost: true, adjustmentValue: true, note: true })
  const hasPostStockCountPermission = !permissionLoading && hasPermission(STOCK_COUNT_POST_PERMISSION)
  const permissionGate = stockCountPermissionGate(permissionLoading, hasPostStockCountPermission)

  useEffect(() => {
    if (!verification) return
    const timer = window.setInterval(() => setVerificationNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [verification])

  useEffect(() => {
    if (isReady) loadWarehouseLocations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  useEffect(() => {
    if (!selectedWarehouse) {
      setRows([])
      setDrafts([])
      return
    }
    loadCountRows(selectedWarehouse)
    loadDrafts(selectedWarehouse)
    setSelectedGroupId(ALL_GROUP_ID)
    setSearchTerm('')
    setCurrentSessionId(null)
    setCurrentStatus('draft')
    setLastSavedSignature(EMPTY_SIGNATURE)
    setVerification(null)
    setVerifiedSignature(null)
    setImportSummary(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWarehouse])

  const loadWarehouseLocations = async () => {
    const { data, error } = await supabase
      .from('organizations')
      .select('id, org_code, org_name')
      .in('org_type_code', ['HQ', 'WH'])
      .eq('is_active', true)
      .order('org_name')

    if (error) {
      toast({ title: 'Warehouse load failed', description: error.message, variant: 'destructive' })
      return
    }

    const locations = data || []
    setWarehouseLocations(locations)
    const preferred = locations.find(loc => loc.org_code === 'HQ' || loc.org_name.toLowerCase().includes('warehouse')) || locations[0]
    if (preferred) setSelectedWarehouse(preferred.id)
  }

  const loadDrafts = async (warehouseId: string) => {
    const { data, error } = await supabase
      .from('stock_count_sessions' as any)
      .select('id, reference_name, count_date, count_type, status, updated_at')
      .eq('warehouse_organization_id', warehouseId)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(12)

    if (error) {
      if (error.code !== '42P01') toast({ title: 'Draft load failed', description: error.message, variant: 'destructive' })
      return
    }
    setDrafts((data || []) as unknown as DraftSession[])
  }

  const loadCountRows = async (warehouseId: string) => {
    try {
      setLoadingRows(true)
      // Wildcard variant fields keep Stock Count usable before the optional Product
      // Code migration and expose product_code automatically after it is applied.
      const { data, error } = await (supabase as any)
        .from('product_inventory')
        .select(`
          id,
          variant_id,
          stock_config_id,
          organization_id,
          quantity_on_hand,
          warehouse_location,
          inventory_stock_configurations!product_inventory_stock_config_fk (
            id, config_code, config_label, stock_sku, volume_ml, packaging, status
          ),
          product_variants!inner (
            *,
            products!inner (
              id,
              product_name,
              is_active,
              group_id,
              brand_id,
              product_groups (id, group_name, group_description),
              brands (id, brand_name, logo_url)
            )
          )
        `)
        .eq('organization_id', warehouseId)
        .eq('is_active', true)
        .eq('product_variants.is_active', true)
        .eq('product_variants.products.is_active', true)

      if (error) throw error

      // variantId -> display metadata shared by every configuration of that
      // variant (product/group/brand/base cost). Kept separate from per-row
      // fields (system quantity, warehouse location) which differ per
      // configuration and must never leak across configs of the same variant.
      interface VariantMeta {
        productName: string
        productCode: string
        groupId: string
        groupName: string
        groupDescription: string | null
        brandLogoUrl: string | null
        variantName: string
        variantCode: string
        manufacturerSku: string | null
        manualSku: string | null
        imageUrl: string | null
        unitCost: number | null
      }
      const variantMetaById = new Map<string, VariantMeta>()
      const rowsByConfigId = new Map<string, CountRow>()

      for (const item of (data || []) as any[]) {
        const config = Array.isArray(item.inventory_stock_configurations)
          ? item.inventory_stock_configurations[0]
          : item.inventory_stock_configurations
        if (!item.stock_config_id || !config) {
          throw new Error(`Inventory row ${item.id} has no Stock Configuration ID. Stock Count cannot safely guess its configuration.`)
        }
        const variant = Array.isArray(item.product_variants) ? item.product_variants[0] : item.product_variants
        const product = Array.isArray(variant?.products) ? variant.products[0] : variant?.products
        const group = Array.isArray(product?.product_groups) ? product.product_groups[0] : product?.product_groups
        const brand = Array.isArray(product?.brands) ? product.brands[0] : product?.brands
        const groupId = group?.id || brand?.id || UNGROUPED_GROUP_ID
        const groupName = group?.group_name || brand?.brand_name || 'Ungrouped'

        if (!variantMetaById.has(item.variant_id)) {
          variantMetaById.set(item.variant_id, {
            productName: product?.product_name || 'Unnamed product',
            productCode: variant?.product_code || '',
            groupId,
            groupName,
            groupDescription: group?.group_description || null,
            brandLogoUrl: brand?.logo_url || null,
            variantName: variant?.variant_name || 'Unnamed variant',
            variantCode: variant?.variant_code || '',
            manufacturerSku: variant?.manufacturer_sku || null,
            manualSku: variant?.manual_sku || null,
            imageUrl: variant?.image_url || null,
            unitCost: normalizeBaseCost(variant?.base_cost),
          })
        }
        const meta = variantMetaById.get(item.variant_id)!

        rowsByConfigId.set(item.stock_config_id, {
          inventoryId: item.id,
          stockConfigId: item.stock_config_id,
          configCode: config.config_code,
          stockSku: config.stock_sku,
          configLabel: config.config_label,
          volumeMl: config.volume_ml,
          packagingVersion: config.packaging,
          configStatus: config.status,
          variantId: item.variant_id,
          ...meta,
          systemQuantity: Number(item.quantity_on_hand || 0),
          physicalCount: '',
          note: '',
          warehouseLocation: item.warehouse_location || null,
        })
      }

      // Synthesize zero-balance rows for active/phase-out catalog
      // configurations that have never had a movement at this warehouse
      // (e.g. 20NB/50NB/50OB right after Enable Stock Configurations, before
      // anything has ever moved into them). Without this, Stock Count can
      // never show a configuration a physical count needs to be entered into.
      const variantIds = Array.from(variantMetaById.keys())
      if (variantIds.length > 0) {
        const { data: catalogConfigs, error: catalogError } = await (supabase as any)
          .from('inventory_stock_configurations')
          .select('id, variant_id, config_code, config_label, stock_sku, volume_ml, packaging, status')
          .in('variant_id', variantIds)
          .in('status', ['active', 'phase_out'])
        if (catalogError) throw catalogError

        for (const config of (catalogConfigs || []) as any[]) {
          if (rowsByConfigId.has(config.id)) continue
          const meta = variantMetaById.get(config.variant_id)
          if (!meta) continue
          rowsByConfigId.set(config.id, {
            inventoryId: null,
            stockConfigId: config.id,
            configCode: config.config_code,
            stockSku: config.stock_sku,
            configLabel: config.config_label,
            volumeMl: config.volume_ml,
            packagingVersion: config.packaging,
            configStatus: config.status,
            variantId: config.variant_id,
            ...meta,
            systemQuantity: 0,
            physicalCount: '',
            note: '',
            warehouseLocation: null,
          })
        }
      }

      const nextRows = Array.from(rowsByConfigId.values())
        .sort((a, b) => `${a.groupName} ${a.productName} ${a.variantName} ${a.configLabel}`.localeCompare(`${b.groupName} ${b.productName} ${b.variantName} ${b.configLabel}`))

      setRows(nextRows)
    } catch (error: any) {
      toast({ title: 'Inventory load failed', description: error.message, variant: 'destructive' })
    } finally {
      setLoadingRows(false)
    }
  }

  const visibleRows = useMemo(
    () => rows.filter(row => {
      const hasActivity = row.systemQuantity !== 0 || parseCount(row.physicalCount) !== null || Boolean(row.note.trim())
      // Legacy/Unclassified disappears from normal operational counts the
      // moment its balance is fully classified — regardless of the "Show
      // inactive" toggle, since it is never a configuration worth counting
      // again once cleared.
      if (row.configCode === LEGACY_CONFIG_CODE && !hasActivity) return false
      // Active/phase-out configurations always show (even zero-balance) so a
      // just-enabled target configuration is countable before anything has
      // ever moved into it. Only truly inactive/retired zero-balance
      // configurations are hidden by default.
      if (row.configStatus === 'inactive' && !hasActivity) return showInactive
      return true
    }),
    [rows, showInactive],
  )

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; logoUrl: string | null; description: string | null }>()
    visibleRows.forEach(row => {
      const existing = map.get(row.groupId)
      if (existing) existing.count += 1
      else map.set(row.groupId, { id: row.groupId, name: row.groupName, count: 1, logoUrl: row.brandLogoUrl || row.imageUrl, description: row.groupDescription })
    })
    return [{ id: ALL_GROUP_ID, name: 'All', count: visibleRows.length, logoUrl: null, description: null }, ...Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))]
  }, [visibleRows])

  const selectedGroup = groups.find(group => group.id === selectedGroupId) || groups[0]
  const selectedGroupRows = useMemo(() => {
    const scoped = selectedGroupId === ALL_GROUP_ID ? visibleRows : visibleRows.filter(row => row.groupId === selectedGroupId)
    const query = searchTerm.trim().toLowerCase()
    return scoped.filter(row => {
      const variance = varianceForRow(row)
      if (showVarianceOnly && (!variance || variance === 0)) return false
      if (!query) return true
      return [row.productName, row.variantName, row.variantCode, row.stockSku, row.configLabel, row.manufacturerSku, row.manualSku].filter(Boolean).some(value => String(value).toLowerCase().includes(query))
    })
  }, [visibleRows, searchTerm, selectedGroupId, showVarianceOnly])

  const pageSummary = useMemo(() => {
    const counted = visibleRows.filter(row => parseCount(row.physicalCount) !== null)
    const variances = counted.map(row => varianceForRow(row) || 0)
    return {
      totalItems: visibleRows.length,
      counted: counted.length,
      notCounted: visibleRows.length - counted.length,
      varianceItems: variances.filter(value => value !== 0).length,
      netAdjustment: variances.reduce((sum, value) => sum + value, 0),
      estimatedValue: sumStockCountImpacts(visibleRows.flatMap(row => {
        const variance = varianceForRow(row)
        return variance === null ? [] : [{ quantityChange: variance, baseCost: row.unitCost }]
      })),
    }
  }, [visibleRows])

  const groupSummary = useMemo(() => {
    const scoped = selectedGroupId === ALL_GROUP_ID ? visibleRows : visibleRows.filter(row => row.groupId === selectedGroupId)
    return {
      variants: scoped.length,
      systemTotal: scoped.reduce((sum, row) => sum + row.systemQuantity, 0),
      countedTotal: scoped.reduce((sum, row) => sum + (parseCount(row.physicalCount) ?? 0), 0),
      varianceTotal: scoped.reduce((sum, row) => sum + (varianceForRow(row) || 0), 0),
    }
  }, [visibleRows, selectedGroupId])

  const isClassificationMode = countType === 'initial_configuration_classification'

  // Derived purely from already-loaded rows — no extra fetch. A variant is
  // in scope for classification only while it still has a real balance on
  // its Legacy/Unclassified configuration at this warehouse.
  const classificationGroups = useMemo(
    () => buildInitialClassificationGroups(rows),
    [rows],
  )

  const classificationSummary = useMemo(() => {
    const perGroup = classificationGroups.map(group => {
      const entry = computeClassificationEntry(group.legacyRow.systemQuantity, group.targetRows)
      return {
        group,
        ...entry,
        cardDisplay: getClassificationCardDisplay(entry),
      }
    })
    // Only *selected* flavours (≥1 target counted) belong to this round. Blank
    // flavours are deferred and must never contribute their Legacy balance to
    // the summary — that double-charging was the -3,160 in the incident. The
    // numeric totals come from the shared, unit-tested summarizeClassificationRound.
    const selected = perGroup.filter(entry => entry.selected)
    const completeSelected = selected.filter(entry => entry.complete)
    const partialSelected = selected.filter(entry => !entry.complete)
    const totals = summarizeClassificationRound(classificationGroups.map(group => ({
      legacySystemQuantity: group.legacyRow.systemQuantity,
      unitCost: group.legacyRow.unitCost,
      targets: group.targetRows.map(row => ({ configCode: row.configCode, physicalCount: row.physicalCount })),
    })))
    return { perGroup, selected, completeSelected, partialSelected, ...totals }
  }, [classificationGroups])

  // Selected flavours whose targets are not all filled in — these block posting.
  const classificationPartialSelected = classificationSummary.partialSelected

  // The exact set of rows saveDraft persists to stock_count_session_items. Both
  // the save path and the client signature derive from this one memo so the
  // signature can never drift from what is actually written. In classification
  // mode ONLY selected flavours are persisted, so an unselected flavour's Legacy
  // balance is never written, validated, or posted (it stays for a later round).
  const draftRows = useMemo<CountRow[]>(() => (
    isClassificationMode
      ? classificationGroups
        .filter(group => group.targetRows.some(row => parseCount(row.physicalCount) !== null))
        .flatMap(group => [
          { ...group.legacyRow, physicalCount: '0' },
          ...group.targetRows.filter(row => parseCount(row.physicalCount) !== null || row.note.trim()),
        ])
      : visibleRows.filter(row => parseCount(row.physicalCount) !== null || row.note.trim())
  ), [isClassificationMode, classificationGroups, visibleRows])

  const currentSignature = useMemo(() => stockCountRowsSignature(draftRows.map(row => ({
    stockConfigId: row.stockConfigId,
    variantId: row.variantId,
    physicalCount: parseCount(row.physicalCount),
    note: row.note,
  }))), [draftRows])

  // Variants that still carry a Legacy/Unclassified balance at this warehouse.
  // Their 20NB/50NB/50OB configurations must be filled through Initial
  // Configuration Classification (which draws the legacy balance down), never
  // counted independently in a Full/Cycle/Spot count — that would add phantom
  // units on top of the untouched legacy balance (the incident's +150).
  const unclassifiedVariantIds = useMemo(
    () => new Set(rows.filter(row => row.configCode === LEGACY_CONFIG_CODE && row.systemQuantity > 0).map(row => row.variantId)),
    [rows],
  )
  const classificationMisuseRows = useMemo(() => {
    if (isClassificationMode) return [] as CountRow[]
    return draftRows.filter(row =>
      parseCount(row.physicalCount) !== null
      && (TARGET_CONFIG_CODES as readonly string[]).includes(row.configCode)
      && unclassifiedVariantIds.has(row.variantId))
  }, [isClassificationMode, draftRows, unclassifiedVariantIds])
  const hasClassificationMisuse = classificationMisuseRows.length > 0

  // On-screen counts differ from the saved draft. Review & Post must never run
  // against a dirty draft, and an issued code is void once the counts change.
  const hasUnsavedChanges = currentSignature !== lastSavedSignature
  const verificationStale = Boolean(verification) && verifiedSignature !== null && verifiedSignature !== currentSignature

  const canSave = Boolean(selectedWarehouse && countDate && currentStatus !== 'posted'
    && (isClassificationMode ? classificationGroups.length > 0 : visibleRows.length > 0))
  // In classification mode the round is postable once at least one flavour is
  // selected; a partial (incomplete) selection still opens Review so the block
  // can be shown, and the preflight/DB reject it.
  const canPost = canSave && (isClassificationMode ? classificationSummary.selectedFlavours > 0 : pageSummary.counted > 0)

  const updateRow = (stockConfigId: string, patch: Partial<Pick<CountRow, 'physicalCount' | 'note'>>) => {
    setRows(prev => prev.map(row => row.stockConfigId === stockConfigId ? { ...row, ...patch } : row))
  }

  const handlePhysicalCountChange = (stockConfigId: string, value: string) => {
    if (value === '' || /^\d+$/.test(value)) updateRow(stockConfigId, { physicalCount: value })
  }

  const focusNextCountInput = (stockConfigId: string) => {
    const index = selectedGroupRows.findIndex(row => row.stockConfigId === stockConfigId)
    const next = selectedGroupRows[index + 1]
    if (next) document.querySelector<HTMLInputElement>(`input[data-count-input="${next.stockConfigId}"]`)?.focus()
  }

  const saveDraft = async (options: { noteOverride?: string; silent?: boolean } = {}): Promise<string | null> => {
    if (!canSave) return null
    if (countDate > todayIso()) {
      toast({ title: 'Invalid count date', description: 'Count date cannot be in the future.', variant: 'destructive' })
      return null
    }

    setSaving(true)
    try {
      const payload = {
        warehouse_organization_id: selectedWarehouse,
        count_date: countDate,
        count_type: countType,
        reference_name: referenceName.trim() || null,
        notes: normalizeStockCountPostingNote(options.noteOverride ?? notes) || null,
        status: 'draft',
        created_by: userProfile?.id || null,
        updated_by: userProfile?.id || null,
        updated_at: new Date().toISOString(),
      }

      let sessionId = currentSessionId
      if (sessionId) {
        const { error } = await supabase.from('stock_count_sessions' as any).update(payload).eq('id', sessionId).eq('status', 'draft')
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('stock_count_sessions' as any).insert(payload).select('id').single()
        if (error) throw error
        sessionId = (data as any).id
        setCurrentSessionId(sessionId)
      }

      // Classification sessions always force the Legacy/Unclassified row to a
      // physical count of exactly 0 (it is never user-typed — see
      // prepare_stock_count_verification's classification guard) and only
      // include target rows that already have a physical count entered. This is
      // the shared `draftRows` memo so the persisted set and the client
      // signature can never disagree.
      const savedSignature = currentSignature
      await supabase.from('stock_count_session_items' as any).delete().eq('session_id', sessionId)
      if (draftRows.length > 0) {
        const { error: itemError } = await supabase.from('stock_count_session_items' as any).insert(draftRows.map(row => {
          const physical = parseCount(row.physicalCount)
          return {
            session_id: sessionId,
            variant_id: row.variantId,
            stock_config_id: row.stockConfigId,
            sku: skuForRow(row),
            system_quantity: row.systemQuantity,
            physical_quantity: physical,
            adjustment_quantity: physical === null ? null : physical - row.systemQuantity,
            unit_cost: row.unitCost,
            note: row.note.trim() || null,
          }
        }))
        if (itemError) throw itemError
      }

      // The screen and the saved draft are now identical — clear the dirty flag.
      setLastSavedSignature(savedSignature)
      if (!options.silent) toast({ title: 'Draft saved', description: `${draftRows.length} counted or noted row(s) saved.` })
      loadDrafts(selectedWarehouse)
      return sessionId
    } catch (error: any) {
      toast({ title: 'Save draft failed', description: error.message, variant: 'destructive' })
      return null
    } finally {
      setSaving(false)
    }
  }

  // Atomic autosave after an Excel import. Runs on the render *after* the
  // imported rows are committed (setRows is async), so saveDraft persists the
  // imported counts. "Import complete" is only shown once the save succeeds;
  // a failed save surfaces a blocking "not saved" warning instead of silently
  // leaving the screen ahead of the draft.
  useEffect(() => {
    if (!pendingAutoSave) return
    setPendingAutoSave(false)
    const summary = importSummary
    if (!canSave) {
      if (summary) toast({ title: 'Import applied', description: `${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.failed} failed. Save the draft to persist.` })
      return
    }
    void (async () => {
      const savedId = await saveDraft({ silent: true })
      if (savedId) {
        toast({
          title: 'Import complete',
          description: summary
            ? `${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.failed} failed. Saved to draft.`
            : 'Imported counts saved to the draft.',
        })
      } else {
        toast({ title: 'Imported counts not saved', description: UNSAVED_CHANGES_MESSAGE, variant: 'destructive' })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoSave])

  const loadDraft = async (sessionId: string) => {
    const { data: session, error } = await supabase.from('stock_count_sessions' as any).select('id, count_date, count_type, reference_name, notes, status').eq('id', sessionId).single()
    if (error) {
      toast({ title: 'Open draft failed', description: error.message, variant: 'destructive' })
      return
    }
    const { data: items, error: itemError } = await supabase.from('stock_count_session_items' as any).select('stock_config_id, variant_id, physical_quantity, note').eq('session_id', sessionId)
    if (itemError) {
      toast({ title: 'Open draft failed', description: itemError.message, variant: 'destructive' })
      return
    }

    const legacyItem = (items || []).find((item: any) => !item.stock_config_id)
    if (legacyItem) {
      setStaleDraftIds(prev => new Set(prev).add(sessionId))
      toast({
        title: 'This draft uses an older Stock Count format',
        description: 'Create a new configuration-aware count. The historical draft remains unchanged until archived.',
        variant: 'destructive',
      })
      return
    }
    const itemMap = new Map((items || []).map((item: any) => [item.stock_config_id, item]))
    if (rows.some(row => itemMap.has(row.stockConfigId) && row.configStatus !== 'active' && row.systemQuantity === 0)) setShowInactive(true)
    setCurrentSessionId((session as any).id)
    setCurrentStatus((session as any).status)
    setCountDate((session as any).count_date)
    setCountType((session as any).count_type)
    setReferenceName((session as any).reference_name || '')
    setNotes((session as any).notes || '')
    setRows(prev => prev.map(row => {
      const item = itemMap.get(row.stockConfigId) as any
      return item ? { ...row, physicalCount: item.physical_quantity === null ? '' : String(item.physical_quantity), note: item.note || '' } : { ...row, physicalCount: '', note: '' }
    }))
    // The freshly loaded rows exactly match what is persisted, so seed the
    // saved-signature baseline from the loaded items (not from the pre-load
    // memo, which has not recomputed yet) to avoid a false "unsaved" flag.
    setLastSavedSignature(stockCountRowsSignature((items || []).map((item: any) => ({
      stockConfigId: item.stock_config_id ?? null,
      variantId: item.variant_id,
      physicalCount: item.physical_quantity === null || item.physical_quantity === undefined ? null : Number(item.physical_quantity),
      note: typeof item.note === 'string' ? item.note : '',
    }))))
    setVerification(null)
    setVerifiedSignature(null)
    toast({ title: 'Draft opened', description: 'Saved counts are loaded for review.' })
  }

  const archiveDraft = async (sessionId: string) => {
    if (!window.confirm('Archive this draft? It cannot post against the current Stock Count model and will be retired permanently.')) return
    setArchivingDraftId(sessionId)
    try {
      const { error } = await supabase.rpc('archive_stock_count_draft' as any, { p_session_id: sessionId })
      if (error) throw error
      setStaleDraftIds(prev => { const next = new Set(prev); next.delete(sessionId); return next })
      toast({ title: 'Draft archived', description: 'The stale draft has been retired.' })
      if (currentSessionId === sessionId) resetSession()
      await loadDrafts(selectedWarehouse)
    } catch (error: any) {
      toast({ title: 'Archive draft failed', description: error.message, variant: 'destructive' })
    } finally {
      setArchivingDraftId(null)
    }
  }

  const resetSession = () => {
    setCurrentSessionId(null)
    setCurrentStatus('draft')
    setCountDate(todayIso())
    setCountType('full_count')
    setReferenceName('')
    setNotes('')
    setRows(prev => prev.map(row => ({ ...row, physicalCount: '', note: '' })))
    setLastSavedSignature(EMPTY_SIGNATURE)
    setVerification(null)
    setVerifiedSignature(null)
    setImportSummary(null)
  }

  const downloadExcel = async () => {
    if (isClassificationMode) {
      if (classificationGroups.length === 0) return
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      buildClassificationWorksheet(workbook, classificationSummary.perGroup.flatMap(({ group, classifiedTotal, variance }) => [
        {
          stockConfigId: group.legacyRow.stockConfigId, stockSku: group.legacyRow.stockSku, variantId: group.variantId,
          groupName: group.legacyRow.groupName, productName: group.legacyRow.productName,
          variantName: group.legacyRow.variantName, productCode: group.legacyRow.productCode,
          volumeMl: group.legacyRow.volumeMl, packagingVersion: group.legacyRow.packagingVersion, lifecycle: group.legacyRow.configLabel,
          isLegacy: true, legacySystemQuantity: group.legacyRow.systemQuantity, physicalCount: '0',
          classifiedTotal, variance,
        },
        ...group.targetRows.map(row => ({
          stockConfigId: row.stockConfigId, stockSku: row.stockSku, variantId: group.variantId,
          groupName: row.groupName, productName: row.productName,
          variantName: row.variantName, productCode: row.productCode,
          volumeMl: row.volumeMl, packagingVersion: row.packagingVersion, lifecycle: row.configLabel,
          isLegacy: false, legacySystemQuantity: group.legacyRow.systemQuantity, physicalCount: row.physicalCount,
          classifiedTotal, variance,
        })),
      ]))
      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Serapod2U_Initial_Configuration_Classification_${countDate}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      return
    }

    if (visibleRows.length === 0) return
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    buildStockCountWorksheet(workbook, visibleRows.map(row => ({
      stockConfigId: row.stockConfigId,
      stockSku: row.stockSku,
      variantId: row.variantId,
      volumeMl: row.volumeMl,
      packagingVersion: row.packagingVersion,
      groupName: row.groupName,
      variantName: row.variantName,
      productName: row.productName,
      productCode: row.productCode,
      systemQuantity: row.systemQuantity,
      physicalCount: row.physicalCount,
      note: row.note,
    })))
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Serapod2U_Stock_Count_${countDate}.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Any change to the counted rows voids an outstanding verification code: the
  // code (and the server-side snapshot hash it is bound to) no longer describes
  // what is on screen. The user must review and request a fresh code.
  const invalidatePendingVerification = () => {
    setVerification(null)
    setVerifiedSignature(null)
    setVerificationCode('')
    setVerificationError(null)
    if (preflight.status !== 'idle') setPreflight({ status: 'idle' })
  }

  // Called after an Excel import has patched the on-screen rows. The imported
  // counts live only in React state until persisted, so we (1) void any pending
  // code and (2) request an atomic autosave so "Import complete" is only ever
  // shown after the counts are safely in stock_count_session_items.
  const onImportApplied = () => {
    invalidatePendingVerification()
    setPendingAutoSave(true)
  }

  const importExcel = async (file: File) => {
    try {
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.arrayBuffer())
      const sheet = workbook.worksheets[0]
      if (!sheet) throw new Error('The Excel file does not contain a worksheet.')

      if (isClassificationMode) {
        const targets = classificationGroups.flatMap(group => [
          {
            stockConfigId: group.legacyRow.stockConfigId,
            stockSku: group.legacyRow.stockSku,
            variantId: group.variantId,
            groupName: group.legacyRow.groupName,
            productName: group.legacyRow.productName,
            variantName: group.legacyRow.variantName,
            productCode: group.legacyRow.productCode,
            volumeMl: group.legacyRow.volumeMl,
            packagingVersion: group.legacyRow.packagingVersion,
            lifecycle: group.legacyRow.configLabel,
            isLegacy: true,
            legacySystemQuantity: group.legacyRow.systemQuantity,
            physicalCount: '0',
          },
          ...group.targetRows.map(row => ({
            stockConfigId: row.stockConfigId,
            stockSku: row.stockSku,
            variantId: group.variantId,
            groupName: row.groupName,
            productName: row.productName,
            variantName: row.variantName,
            productCode: row.productCode,
            volumeMl: row.volumeMl,
            packagingVersion: row.packagingVersion,
            lifecycle: row.configLabel,
            isLegacy: false,
            legacySystemQuantity: group.legacyRow.systemQuantity,
            physicalCount: row.physicalCount,
          })),
        ])
        const result = parseClassificationWorksheet(sheet, targets)
        setRows(prev => prev.map(row => result.patches.has(row.stockConfigId) ? { ...row, ...result.patches.get(row.stockConfigId)! } : row))
        setImportSummary({ updated: result.updated, unchanged: result.unchanged, failed: result.failed, rows: result.rows })
        onImportApplied()
        return
      }

      const result = parseStockCountWorksheet(sheet, rows.map(row => ({
        stockConfigId: row.stockConfigId,
        variantId: row.variantId,
        stockSku: row.stockSku,
        physicalCount: row.physicalCount,
        note: row.note,
      })))
      setRows(prev => prev.map(row => result.patches.has(row.stockConfigId) ? { ...row, ...result.patches.get(row.stockConfigId)! } : row))
      setImportSummary({
        updated: result.updated,
        unchanged: result.unchanged,
        failed: result.failed,
        rows: result.rows,
      })
      onImportApplied()
    } catch (error: any) {
      toast({
        title: 'Excel import failed',
        description: error?.message || 'The Stock Count Excel file could not be read.',
        variant: 'destructive',
      })
    }
  }

  const requestVerificationCode = async () => {
    if (!canPost || currentStatus === 'posted') return
    if (reviewVarianceItems > 0 && !isValidStockCountPostingNote(notes)) {
      setVerificationError('A Posting Note is required when the Stock Count contains variance.')
      return
    }
    setPosting(true)
    setVerificationError(null)
    try {
      const sessionId = currentSessionId || await saveDraft()
      if (!sessionId) throw new Error('Save the draft before posting.')
      if (currentSessionId) {
        const savedSessionId = await saveDraft()
        if (!savedSessionId) throw new Error('The latest Stock Count changes could not be saved.')
      }
      setPreflight({ status: 'loading' })
      const response = await fetch('/api/inventory/stock-count/verification/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }),
      })
      const result = await response.json()
      if (!response.ok) {
        setPreflight({ status: 'error', code: result.code, message: result.error, guidance: result.guidance })
        return
      }
      setPreflight({ status: 'ready', recipientCount: result.recipients.length })
      setVerification({ ...result, sessionId })
      // Bind the issued code to the exact counts on screen. Any later edit/import
      // makes verificationStale true and blocks Verify & Post.
      setVerifiedSignature(currentSignature)
      setVerificationCode('')
      setVerificationNow(Date.now())
      toast({ title: 'Verification code sent', description: `Sent to ${result.recipients.length} authorized recipient(s).` })
    } catch (error: any) {
      setVerificationError(error.message)
    } finally {
      setPosting(false)
    }
  }

  const runVerificationPreflight = async (sessionId: string) => {
    setPreflight({ status: 'loading' })
    setVerificationError(null)
    if (permissionGate === 'checking') return
    if (permissionGate === 'denied') {
      const friendly = stockCountVerificationError('permission_denied')
      setPreflight({ status: 'error', code: friendly.code, message: friendly.message })
      return
    }
    // Enforced on every preflight path (open, retry, permission re-check) so a
    // Full/Cycle/Spot count can never be used to reclassify a legacy balance.
    // The DB (migration 09) is the authoritative backstop; this is the friendly
    // early block. See classificationMisuseRows.
    if (hasClassificationMisuse) {
      const names = Array.from(new Set(classificationMisuseRows.map(row => `${row.productName} — ${row.variantName}`))).slice(0, 5)
      setPreflight({
        status: 'error',
        code: 'classification_misuse',
        message: `${names.join('; ')}${classificationMisuseRows.length > names.length ? '; …' : ''} still ${names.length === 1 ? 'has' : 'have'} a Legacy/Unclassified balance. Use the "Initial Configuration Classification" count type to move that balance into 20ml/50ml boxes — a Full/Cycle/Spot count would add phantom stock on top of the unclassified balance.`,
      })
      return
    }
    // A *selected* classification flavour (≥1 target counted) must have all three
    // targets counted. Deferred (all-blank) flavours are ignored. The DB
    // (prepare_stock_count_verification) is the backstop; this is the friendly
    // early block. See classificationPartialSelected.
    if (isClassificationMode && classificationPartialSelected.length > 0) {
      const names = classificationPartialSelected.map(entry => `${entry.group.productName} — ${entry.group.variantName}`).slice(0, 5)
      setPreflight({
        status: 'error',
        code: 'classification_incomplete',
        message: `Enter a physical count for all three target configurations (20ml New Box, 50ml New Box, 50ml Old Box) for ${names.join('; ')}${classificationPartialSelected.length > names.length ? '; …' : ''}, or clear its counts to defer it to a later round.`,
      })
      return
    }
    try {
      const response = await fetch(`/api/inventory/stock-count/verification/preflight?sessionId=${encodeURIComponent(sessionId)}`)
      const result = await response.json()
      if (!response.ok || !result.ok) {
        setPreflight({ status: 'error', code: result.code, message: result.error, guidance: result.guidance })
        return
      }
      // Requirement C: the server recomputed the summary from the *persisted*
      // draft. If its signature differs from what is on screen, the saved draft
      // is stale relative to the review — block before a code can be issued.
      if (typeof result.persistedSignature === 'string' && result.persistedSignature !== currentSignature) {
        setPreflight({ status: 'error', code: 'unsaved_changes', message: UNSAVED_CHANGES_MESSAGE })
        return
      }
      if (result.authoritativeBaseCosts && typeof result.authoritativeBaseCosts === 'object') {
        setRows(current => current.map(row => Object.prototype.hasOwnProperty.call(result.authoritativeBaseCosts, row.variantId)
          ? { ...row, unitCost: normalizeBaseCost(result.authoritativeBaseCosts[row.variantId]) }
          : row))
      }
      setPreflight({ status: 'ready', recipientCount: result.recipientCount, guidance: result.guidance })
    } catch {
      const friendly = stockCountVerificationError('unexpected_error')
      setPreflight({ status: 'error', code: friendly.code, message: friendly.message })
    }
  }

  const openPostReview = async () => {
    setConfirmPostOpen(true)
    setPreflight({ status: 'loading' })
    setVerificationError(null)
    // Block the misuse before persisting anything (runVerificationPreflight
    // repeats this guard for the Retry path; the DB is the final backstop).
    if (hasClassificationMisuse) {
      const names = Array.from(new Set(classificationMisuseRows.map(row => `${row.productName} — ${row.variantName}`))).slice(0, 5)
      setPreflight({
        status: 'error',
        code: 'classification_misuse',
        message: `${names.join('; ')}${classificationMisuseRows.length > names.length ? '; …' : ''} still ${names.length === 1 ? 'has' : 'have'} a Legacy/Unclassified balance. Use the "Initial Configuration Classification" count type to move that balance into 20ml/50ml boxes — a Full/Cycle/Spot count would add phantom stock on top of the unclassified balance.`,
      })
      return
    }
    const sessionId = await saveDraft()
    if (!sessionId) {
      setPreflight({ status: 'error', message: 'Save the Stock Count draft before requesting verification.' })
      return
    }
    await runVerificationPreflight(sessionId)
  }

  const retryVerificationPreflight = async () => {
    setPreflight({ status: 'loading' })
    const sessionId = await saveDraft({ silent: true })
    if (!sessionId) {
      setPreflight({ status: 'error', message: 'The latest Stock Count changes could not be saved. Please try again.' })
      return
    }
    await runVerificationPreflight(sessionId)
  }

  const handlePostingNoteChange = (value: string) => {
    setNotes(value)
    if (reviewVarianceItems === 0) return

    if (!isValidStockCountPostingNote(value)) {
      if (postingNoteRecheckTimerRef.current !== null) window.clearTimeout(postingNoteRecheckTimerRef.current)
      postingNoteRecheckTimerRef.current = null
      postingNoteRecheckPendingRef.current = false
      const friendly = stockCountVerificationError('posting_note_required')
      setPreflight({ status: 'error', code: friendly.code, message: friendly.message })
      return
    }

    if (preflight.code !== 'posting_note_required' && !postingNoteRecheckPendingRef.current) return

    // Clear the local validation error immediately, then persist the final
    // debounced value before asking the authoritative server to check again.
    setPreflight({ status: 'loading' })
    postingNoteRecheckPendingRef.current = true
    if (postingNoteRecheckTimerRef.current !== null) window.clearTimeout(postingNoteRecheckTimerRef.current)
    postingNoteRecheckTimerRef.current = window.setTimeout(async () => {
      postingNoteRecheckTimerRef.current = null
      postingNoteRecheckPendingRef.current = false
      const normalizedNote = normalizeStockCountPostingNote(value)
      setNotes(normalizedNote)
      const sessionId = await saveDraft({ noteOverride: normalizedNote, silent: true })
      if (!sessionId) {
        setPreflight({ status: 'error', message: 'The Posting Note could not be saved. Please try again.' })
        return
      }
      await runVerificationPreflight(sessionId)
    }, 350)
  }

  useEffect(() => {
    if (confirmPostOpen && !verification && !permissionLoading && preflight.status === 'loading' && currentSessionId) {
      void runVerificationPreflight(currentSessionId)
    }
    // Re-run only when the permission lookup finishes for an open review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionLoading])

  const verifyAndPostCount = async () => {
    if (!verification || verificationCode.length !== 8) return
    // Defence in depth on top of the server snapshot-hash check: never submit a
    // code once the on-screen counts have moved away from what it was issued for.
    if (verificationStale) {
      setVerificationError('The counts changed after this code was requested. Request a new code before posting.')
      return
    }
    setPosting(true)
    setVerificationError(null)
    setPreflight({ status: 'idle' })
    try {
      const response = await fetch('/api/inventory/stock-count/verification/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: verification.requestId, sessionId: verification.sessionId, code: verificationCode }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to verify and post the Stock Count.')
      setCurrentStatus('posted')
      setVerification(null)
      setVerifiedSignature(null)
      setVerificationCode('')
      setConfirmPostOpen(false)
      setLastSavedSignature(EMPTY_SIGNATURE)
      toast({ title: 'Stock count posted', description: `${result.movement_count || 0} variance movement(s) recorded.` })
      await loadCountRows(selectedWarehouse)
      await loadDrafts(selectedWarehouse)
    } catch (error: any) {
      setVerificationError(error.message)
      setVerificationCode('')
    } finally {
      setPosting(false)
    }
  }

  const closePostDialog = () => {
    if (postingNoteRecheckTimerRef.current !== null) window.clearTimeout(postingNoteRecheckTimerRef.current)
    postingNoteRecheckTimerRef.current = null
    postingNoteRecheckPendingRef.current = false
    setConfirmPostOpen(false)
    setVerification(null)
    setVerifiedSignature(null)
    setVerificationCode('')
    setVerificationError(null)
  }

  const summaryCards = [
    { label: 'Total Items', value: formatNumber(pageSummary.totalItems), sub: `Across ${Math.max(groups.length - 1, 0)} groups`, icon: Boxes, color: 'text-violet-600 bg-violet-50' },
    { label: 'Counted', value: formatNumber(pageSummary.counted), sub: `${pageSummary.totalItems ? Math.round((pageSummary.counted / pageSummary.totalItems) * 100) : 0}% of total`, icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
    { label: 'Not Counted', value: formatNumber(pageSummary.notCounted), sub: `${pageSummary.totalItems ? Math.round((pageSummary.notCounted / pageSummary.totalItems) * 100) : 0}% remaining`, icon: CalendarDays, color: 'text-amber-600 bg-amber-50' },
    { label: 'Variance Items', value: formatNumber(pageSummary.varianceItems), sub: 'Items with variance', icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    { label: 'Net Adjustment', value: `${pageSummary.netAdjustment > 0 ? '+' : ''}${formatNumber(pageSummary.netAdjustment)}`, sub: 'Total units', icon: RotateCcw, color: 'text-blue-600 bg-blue-50' },
    { label: 'Estimated Value', value: formatMoney(pageSummary.estimatedValue), sub: 'Based on variance', icon: FileSpreadsheet, color: 'text-purple-600 bg-purple-50' },
  ]
  const warehouseName = warehouseLocations.find(location => location.id === selectedWarehouse)?.org_name || '—'
  const expirySeconds = verification ? Math.max(0, Math.ceil((new Date(verification.expiresAt).getTime() - verificationNow) / 1000)) : 0
  const resendSeconds = verification ? Math.max(0, Math.ceil((new Date(verification.resendAvailableAt).getTime() - verificationNow) / 1000)) : 0
  const reviewCounted = isClassificationMode ? classificationSummary.completeFlavours : pageSummary.counted
  const reviewVarianceItems = isClassificationMode
    ? classificationSummary.perGroup.filter(entry => entry.complete && entry.variance !== 0).length
    : pageSummary.varianceItems
  const reviewNetAdjustment = isClassificationMode ? classificationSummary.netVariance : pageSummary.netAdjustment
  const reviewEstimatedValue = isClassificationMode ? classificationSummary.estimatedValue : pageSummary.estimatedValue
  const highImpact = Math.abs(reviewEstimatedValue) >= HIGH_IMPACT_VALUE_THRESHOLD || Math.abs(reviewNetAdjustment) >= 1000

  // Per-configuration breakdown shown in Review & Post so the exact lines that
  // will post (system → physical → variance for each configuration, plus the
  // Legacy/Unclassified source) are visible before OTP. A summary-only review
  // is what let the stale 50/50/50 hide behind a single "+150" in the incident.
  const reviewBreakdown = useMemo<ReviewBreakdownGroup[]>(() => {
    if (isClassificationMode) {
      // Only selected flavours appear — deferred (all-blank) flavours are not
      // part of this round and their Legacy balance is left untouched.
      return classificationSummary.selected.map(entry => ({
        kind: 'classification' as const,
        variantId: entry.group.variantId,
        heading: `${entry.group.productName} — ${entry.group.variantName}`,
        legacy: { label: entry.group.legacyRow.configLabel, system: entry.group.legacyRow.systemQuantity },
        lines: entry.group.targetRows.map(row => ({
          key: row.stockConfigId,
          label: row.configLabel,
          system: row.systemQuantity,
          physical: parseCount(row.physicalCount),
        })),
        targetTotal: entry.classifiedTotal,
        variance: entry.variance,
        complete: entry.complete,
      }))
    }
    const counted = draftRows.filter(row => parseCount(row.physicalCount) !== null)
    const byVariant = new Map<string, CountBreakdownGroup>()
    counted.forEach(row => {
      const group = byVariant.get(row.variantId)
        || { kind: 'count' as const, variantId: row.variantId, heading: `${row.productName} — ${row.variantName}`, lines: [] }
      group.lines.push({ key: row.stockConfigId, label: row.configLabel, system: row.systemQuantity, physical: parseCount(row.physicalCount) })
      byVariant.set(row.variantId, group)
    })
    return Array.from(byVariant.values())
  }, [isClassificationMode, classificationSummary, draftRows])

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
            <span>Supply Chain</span><ChevronRight className="h-4 w-4" /><span>Inventory</span><ChevronRight className="h-4 w-4" /><span className="font-medium text-slate-900">Stock Count</span>
          </div>
          <h1 className="text-3xl font-bold tracking-normal text-slate-950">Stock Count</h1>
          <p className="mt-1 text-sm text-slate-600">Count inventory faster with grouped variants and Excel bulk update.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {onViewChange && <Button variant="outline" onClick={() => onViewChange('inventory')}><ArrowLeft className="mr-2 h-4 w-4" /> Inventory</Button>}
          <Button
            variant="outline"
            onClick={downloadExcel}
            disabled={isClassificationMode ? classificationGroups.length === 0 : visibleRows.length === 0}
          >
            <Download className="mr-2 h-4 w-4" /> Download Excel Template
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="mr-2 h-4 w-4" /> Import Updated Excel</Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={event => {
            const file = event.target.files?.[0]
            if (file) importExcel(file)
            event.target.value = ''
          }} />
          {hasUnsavedChanges && currentStatus !== 'posted' && (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Unsaved changes</Badge>
          )}
          <Button variant={hasUnsavedChanges ? 'default' : 'outline'} onClick={() => void saveDraft()} disabled={!canSave || saving} className={hasUnsavedChanges && currentStatus !== 'posted' ? 'bg-amber-600 hover:bg-amber-700' : ''}><Save className="mr-2 h-4 w-4" /> {saving ? 'Saving...' : 'Save Draft'}</Button>
          <Button onClick={openPostReview} disabled={!canPost || currentStatus === 'posted' || saving} className="bg-orange-600 hover:bg-orange-700">Review & Post Count <ArrowRight className="ml-2 h-4 w-4" /></Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Warehouse Location <span className="text-red-500">*</span></label>
            <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
              <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
              <SelectContent>{warehouseLocations.map(loc => <SelectItem key={loc.id} value={loc.id}>{loc.org_name} ({loc.org_code})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Count Date <span className="text-red-500">*</span></label>
            <Input type="date" max={todayIso()} value={countDate} onChange={event => setCountDate(event.target.value)} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Count Type <span className="text-red-500">*</span></label>
            <Select value={countType} onValueChange={value => setCountType(value as CountType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{countTypeOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Reference / Batch Name</label>
            <Input value={referenceName} onChange={event => setReferenceName(event.target.value)} placeholder="e.g. Monthly Count" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Notes (Optional)</label>
            <Input value={notes} onChange={event => setNotes(event.target.value)} placeholder="Add notes..." />
          </div>
        </CardContent>
      </Card>

      {drafts.length > 0 && (
        <Card className="border-blue-100 bg-blue-50/50">
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <span className="text-sm font-semibold text-blue-950">Open draft:</span>
            {drafts.map(draft => (
              <div key={draft.id} className="flex items-center gap-1">
                <Button variant={currentSessionId === draft.id ? 'default' : staleDraftIds.has(draft.id) ? 'destructive' : 'outline'} size="sm" onClick={() => loadDraft(draft.id)}>
                  {draft.reference_name || countTypeOptions.find(option => option.value === draft.count_type)?.label || 'Draft'} · {draft.count_date}
                </Button>
                {staleDraftIds.has(draft.id) && (
                  <Button variant="outline" size="sm" disabled={archivingDraftId === draft.id} onClick={() => archiveDraft(draft.id)}>
                    {archivingDraftId === draft.id ? 'Archiving...' : 'Archive'}
                  </Button>
                )}
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={resetSession}>New count</Button>
          </CardContent>
        </Card>
      )}

      {!isClassificationMode && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {summaryCards.map(card => <Card key={card.label}><CardContent className="flex items-center gap-4 p-4"><div className={`flex h-12 w-12 items-center justify-center rounded-lg ${card.color}`}><card.icon className="h-6 w-6" /></div><div className="min-w-0"><p className="text-sm font-semibold text-slate-600">{card.label}</p><p className="truncate text-xl font-bold text-slate-950">{card.value}</p><p className="text-xs text-slate-500">{card.sub}</p></div></CardContent></Card>)}
        </div>
      )}

      {hasClassificationMisuse && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-red-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">This looks like a classification, not a {countTypeOptions.find(option => option.value === countType)?.label}.</p>
              <p className="mt-1">{classificationMisuseRows.length} configuration count{classificationMisuseRows.length === 1 ? '' : 's'} target a 20ml/50ml box for a variant that still holds a Legacy/Unclassified balance. Switch Count Type to <strong>Initial Configuration Classification</strong> so the legacy balance is drawn down instead of adding phantom stock. Posting is blocked until this is resolved.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {isClassificationMode && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardContent className="p-4"><p className="text-sm font-semibold text-slate-600">Flavours with Legacy balance</p><p className="text-xl font-bold text-slate-950">{formatNumber(classificationSummary.totalFlavours)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm font-semibold text-slate-600">Selected this round</p><p className="text-xl font-bold text-slate-950">{formatNumber(classificationSummary.selectedFlavours)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm font-semibold text-emerald-700">Fully classified (selected)</p><p className="text-xl font-bold text-emerald-700">{formatNumber(classificationSummary.completeFlavours)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm font-semibold text-slate-500">Deferred (blank)</p><p className="text-xl font-bold text-slate-500">{formatNumber(classificationSummary.deferredFlavours)}</p></CardContent></Card>
        </div>
      )}

      {!isClassificationMode && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                {groups.map(group => <Button key={group.id} variant={selectedGroupId === group.id ? 'default' : 'outline'} onClick={() => setSelectedGroupId(group.id)} className={selectedGroupId === group.id ? 'bg-orange-600 hover:bg-orange-700' : ''}>{group.name} ({group.count})</Button>)}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="w-72 pl-9" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder={selectedGroupId === ALL_GROUP_ID ? 'Search all variants...' : 'Search variants in this group...'} /></div>
                <div className="flex items-center gap-2"><Switch checked={showVarianceOnly} onCheckedChange={setShowVarianceOnly} /><span className="text-sm font-semibold text-slate-700">Show Variance Only</span></div>
                <div className="flex items-center gap-2"><Switch checked={showInactive} onCheckedChange={setShowInactive} /><span className="text-sm font-semibold text-slate-700">Show inactive</span></div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="outline"><Columns3 className="mr-2 h-4 w-4" /> Columns</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {Object.entries({ unitCost: 'Unit Cost', adjustmentValue: 'Adjustment Value', note: 'Note / Status' }).map(([key, label]) => (
                      <DropdownMenuItem key={key} onClick={() => setVisibleColumns(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}><Checkbox className="mr-2" checked={visibleColumns[key as keyof typeof visibleColumns]} readOnly /> {label}</DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="rounded-lg border">
              <button type="button" className="flex w-full items-center justify-between gap-4 p-4 text-left" onClick={() => setGroupExpanded(!groupExpanded)}>
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-slate-100">{selectedGroup?.logoUrl ? <img src={getStorageUrl(selectedGroup.logoUrl) || selectedGroup.logoUrl} alt="" className="h-full w-full object-cover" /> : <Package className="h-8 w-8 text-slate-400" />}</div>
                  <div><div className="flex items-center gap-2"><h2 className="text-xl font-bold text-slate-950">{selectedGroup?.name || 'All'}</h2><Badge variant="outline">{groupSummary.variants} configurations</Badge></div><p className="text-sm text-slate-500">{selectedGroup?.description || (selectedGroupId === ALL_GROUP_ID ? 'Configuration-aware inventory balances in the selected warehouse.' : 'Stock configurations in this product group.')}</p></div>
                </div>
                <div className="hidden flex-1 grid-cols-3 divide-x text-center md:grid">
                  <div><p className="text-xs font-semibold text-slate-500">System Qty (Total)</p><p className="text-lg font-bold">{formatNumber(groupSummary.systemTotal)}</p></div>
                  <div><p className="text-xs font-semibold text-slate-500">Counted (Total)</p><p className="text-lg font-bold">{formatNumber(groupSummary.countedTotal)}</p></div>
                  <div><p className="text-xs font-semibold text-slate-500">Variance (Total)</p><p className={`text-lg font-bold ${groupSummary.varianceTotal > 0 ? 'text-green-600' : groupSummary.varianceTotal < 0 ? 'text-red-600' : 'text-slate-700'}`}>{groupSummary.varianceTotal > 0 ? '+' : ''}{formatNumber(groupSummary.varianceTotal)}</p></div>
                </div>
                <ChevronDown className={`h-5 w-5 transition ${groupExpanded ? '' : '-rotate-90'}`} />
              </button>

              {groupExpanded && (
                <div className="overflow-x-auto border-t">
                  <Table>
                    <TableHeader><TableRow><TableHead className="min-w-[320px]">Variant / Stock Configuration</TableHead><TableHead className="text-right">System Quantity</TableHead><TableHead className="min-w-[170px]">Physical Count</TableHead><TableHead className="text-right">Variance</TableHead>{visibleColumns.unitCost && <TableHead className="text-right">Unit Cost</TableHead>}{visibleColumns.adjustmentValue && <TableHead className="text-right">Adjustment Value</TableHead>}{visibleColumns.note && <TableHead className="min-w-[240px]">Note / Status</TableHead>}</TableRow></TableHeader>
                    <TableBody>
                      {loadingRows && <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-500">Loading inventory configurations...</TableCell></TableRow>}
                      {!loadingRows && selectedGroupRows.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-500">No variants match this view.</TableCell></TableRow>}
                      {selectedGroupRows.map(row => {
                        const variance = varianceForRow(row)
                        const adjustmentValue = adjustmentValueForRow(row)
                        return (
                          <TableRow key={row.stockConfigId}>
                            <TableCell><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded bg-slate-100">{row.imageUrl ? <img src={getStorageUrl(row.imageUrl) || row.imageUrl} alt="" className="h-full w-full object-cover" /> : <Package className="h-5 w-5 text-slate-400" />}</div><div><p className="font-semibold text-slate-950">{row.variantName}</p><div className="mt-1 flex flex-wrap items-center gap-1.5"><Badge variant={row.configStatus === 'active' ? 'secondary' : 'outline'}>{row.configLabel}</Badge><span className="font-mono text-xs text-slate-500">{skuForRow(row)}</span></div><p className="text-xs text-slate-500">{row.productName}</p></div></div></TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{formatNumber(row.systemQuantity)}</TableCell>
                            <TableCell><Input data-count-input={row.stockConfigId} inputMode="numeric" min="0" value={row.physicalCount} disabled={currentStatus === 'posted'} onChange={event => handlePhysicalCountChange(row.stockConfigId, event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); focusNextCountInput(row.stockConfigId) } }} placeholder="Blank" className="w-36 font-semibold tabular-nums" /></TableCell>
                            <TableCell className={`text-right font-bold tabular-nums ${variance === null || variance === 0 ? 'text-slate-600' : variance > 0 ? 'text-green-600' : 'text-red-600'}`}>{variance === null ? 'Not counted' : `${variance > 0 ? '+' : ''}${formatNumber(variance)}`}</TableCell>
                            {visibleColumns.unitCost && <TableCell className="text-right tabular-nums">{row.unitCost === null ? '—' : formatMoney(row.unitCost)}</TableCell>}
                            {visibleColumns.adjustmentValue && <TableCell className={`text-right font-semibold tabular-nums ${!adjustmentValue ? 'text-slate-600' : adjustmentValue > 0 ? 'text-green-600' : 'text-red-600'}`}>{adjustmentValue === null ? '-' : formatMoney(adjustmentValue)}</TableCell>}
                            {visibleColumns.note && <TableCell><div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-slate-400" /><Input value={row.note} disabled={currentStatus === 'posted'} onChange={event => updateRow(row.stockConfigId, { note: event.target.value })} placeholder={variance === null ? 'Not counted' : variance === 0 ? 'Matched' : 'Add note'} /></div></TableCell>}
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isClassificationMode && (
        <div className="space-y-4">
          {classificationSummary.perGroup.length === 0 && (
            <Card><CardContent className="p-8 text-center text-sm text-slate-500">No flavour at this warehouse has a Legacy/Unclassified balance to classify.</CardContent></Card>
          )}
          {classificationSummary.perGroup.map(({ group, complete, selected, cardDisplay }) => (
            <Card key={group.variantId} className={selected ? '' : 'opacity-70'}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-950">{group.productName} — {group.variantName}</h3>
                    <p className="text-xs text-slate-500">Classify the Legacy/Unclassified balance into 20ml New Box, 50ml New Box, and 50ml Old Box.</p>
                  </div>
                  {!selected
                    ? <Badge variant="outline" className="border-slate-300 text-slate-500">Deferred — not this round</Badge>
                    : complete
                      ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Selected · Complete</Badge>
                      : <Badge variant="outline" className="border-amber-300 text-amber-800">Selected · Incomplete</Badge>}
                </div>

                {!selected && (
                  <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                    <span>All three target counts are blank, so this flavour is deferred to a later round. Its Legacy balance is left untouched. Enter counts to include it now.</span>
                  </div>
                )}

                {selected && !complete && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Enter a physical count for all three target configurations before this flavour can be posted, or clear all three to defer it.</span>
                  </div>
                )}

                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader><TableRow><TableHead className="min-w-[180px]">Configuration</TableHead><TableHead className="min-w-[170px]">Row Type</TableHead><TableHead className="text-right">System Quantity</TableHead><TableHead className="min-w-[170px]">Physical Count</TableHead></TableRow></TableHeader>
                    <TableBody>
                      <TableRow className="bg-slate-50">
                        <TableCell><Badge variant="outline">{group.legacyRow.configLabel}</Badge><p className="mt-1 text-xs text-slate-500">To be classified</p></TableCell>
                        <TableCell><Badge variant="outline" className="border-slate-300 text-slate-600">Legacy Source — Read Only</Badge></TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatNumber(group.legacyRow.systemQuantity)}</TableCell>
                        <TableCell>
                          <div className="relative">
                            <Input value="0" disabled className="w-36 bg-slate-100 font-semibold tabular-nums italic text-slate-400" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-slate-400">Do not enter</span>
                          </div>
                        </TableCell>
                      </TableRow>
                      {group.targetRows.map(row => (
                        <TableRow key={row.stockConfigId}>
                          <TableCell><Badge variant="secondary">{row.configLabel}</Badge></TableCell>
                          <TableCell><Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">Target Configuration</Badge></TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatNumber(row.systemQuantity)}</TableCell>
                          <TableCell><Input inputMode="numeric" min="0" value={row.physicalCount} disabled={currentStatus === 'posted'} onChange={event => handlePhysicalCountChange(row.stockConfigId, event.target.value)} placeholder="Blank" className="w-36 font-semibold tabular-nums" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid grid-cols-4 divide-x rounded-lg border bg-slate-50 text-center">
                  <div className="p-2"><p className="text-xs font-semibold text-slate-500">Legacy System Qty</p><p className="text-lg font-bold">{formatNumber(group.legacyRow.systemQuantity)}</p></div>
                  <div className="p-2"><p className="text-xs font-semibold text-slate-500">Total Target Physical Count</p><p className="text-lg font-bold">{cardDisplay.totalTargetPhysicalCount === null ? '—' : formatNumber(cardDisplay.totalTargetPhysicalCount)}</p></div>
                  <div className="p-2"><p className="text-xs font-semibold text-slate-500">Variance</p><p className={`text-lg font-bold ${cardDisplay.variance === null || cardDisplay.variance === 0 ? 'text-slate-700' : cardDisplay.variance > 0 ? 'text-green-600' : 'text-red-600'}`}>{cardDisplay.variance === null ? '—' : `${cardDisplay.variance > 0 ? '+' : ''}${formatNumber(cardDisplay.variance)}`}</p></div>
                  <div className="p-2"><p className="text-xs font-semibold text-slate-500">Completion Status</p><p className={`text-lg font-bold ${complete ? 'text-emerald-600' : selected ? 'text-amber-600' : 'text-slate-500'}`}>{cardDisplay.completionStatus}</p></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {importSummary && <Card className="border-slate-200"><CardHeader><CardTitle>Import Summary</CardTitle></CardHeader><CardContent><div className="mb-3 flex flex-wrap gap-2"><Badge className="bg-green-600">Updated {importSummary.updated}</Badge><Badge variant="secondary">Unchanged {importSummary.unchanged}</Badge><Badge variant="destructive">Failed {importSummary.failed}</Badge></div>{importSummary.rows.filter(row => row.status === 'Failed').slice(0, 6).map(row => <p key={`${row.row}-${row.sku}`} className="text-sm text-red-600">Row {row.row}: {row.sku} - {row.message}</p>)}</CardContent></Card>}

      <Dialog open={confirmPostOpen} onOpenChange={(open) => open ? setConfirmPostOpen(true) : closePostDialog()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{verification ? 'Verify Stock Count Posting' : 'Review & Post Count'}</DialogTitle>
            <DialogDescription>{verification ? 'Inventory remains unchanged until the code is verified.' : 'Review the complete posting context before requesting approval.'}</DialogDescription>
          </DialogHeader>
          {!verification ? <>
            <div className="grid gap-x-8 gap-y-3 rounded-lg border bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div><span className="text-slate-500">Warehouse</span><strong className="block text-slate-900">{warehouseName}</strong></div>
              <div><span className="text-slate-500">Count date</span><strong className="block text-slate-900">{countDate}</strong></div>
              <div><span className="text-slate-500">Count type</span><strong className="block text-slate-900">{countTypeOptions.find(option => option.value === countType)?.label}</strong></div>
              <div><span className="text-slate-500">Reference / batch</span><strong className="block text-slate-900">{referenceName || '—'}</strong></div>
              {isClassificationMode && (
                <>
                  <div className="flex justify-between sm:col-span-2"><span>Selected this round</span><strong>{formatNumber(classificationSummary.selectedFlavours)} flavour{classificationSummary.selectedFlavours === 1 ? '' : 's'}</strong></div>
                  <div className="flex justify-between sm:col-span-2 text-slate-500"><span>Deferred to a later round</span><strong className="text-slate-500">{formatNumber(classificationSummary.deferredFlavours)} flavour{classificationSummary.deferredFlavours === 1 ? '' : 's'}</strong></div>
                  <div className="flex justify-between sm:col-span-2"><span>Selected Legacy total</span><strong>{formatNumber(classificationSummary.selectedLegacyTotal)}</strong></div>
                  <div className="flex justify-between sm:col-span-2"><span>Selected target physical total</span><strong>{formatNumber(classificationSummary.selectedTargetTotal)}</strong></div>
                </>
              )}
              <div className="flex justify-between sm:col-span-2"><span>{isClassificationMode ? 'Flavours fully classified' : 'Total configurations counted'}</span><strong>{formatNumber(reviewCounted)}</strong></div>
              <div className="flex justify-between sm:col-span-2"><span>Variance items</span><strong>{formatNumber(reviewVarianceItems)}</strong></div>
              <div className={`flex justify-between rounded-md px-2 py-1 sm:col-span-2 ${highImpact ? 'bg-amber-100 text-amber-950' : ''}`}><span>{isClassificationMode ? 'Genuine net variance' : 'Net quantity adjustment'}</span><strong className={reviewNetAdjustment < 0 ? 'text-red-700' : reviewNetAdjustment > 0 ? 'text-emerald-700' : ''}>{reviewNetAdjustment > 0 ? '+' : ''}{formatNumber(reviewNetAdjustment)}</strong></div>
              <div className={`flex justify-between rounded-md px-2 py-1 sm:col-span-2 ${highImpact ? 'bg-amber-100 text-amber-950' : ''}`}><span>Estimated adjustment value</span><strong className={reviewEstimatedValue < 0 ? 'text-red-700' : reviewEstimatedValue > 0 ? 'text-emerald-700' : ''}>{formatMoney(reviewEstimatedValue)}</strong></div>
            </div>

            {/* Per-configuration breakdown — the exact lines that will post. */}
            <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Configuration breakdown</p>
              {reviewBreakdown.length === 0 && <p className="text-sm text-slate-500">No configuration has a physical count entered yet.</p>}
              {reviewBreakdown.map(group => (
                <div key={group.variantId} className="rounded-md border border-slate-100">
                  <div className="flex items-center justify-between gap-2 border-b bg-slate-50 px-3 py-1.5">
                    <span className="text-sm font-semibold text-slate-900">{group.heading}</span>
                    {group.kind === 'classification' && (
                      group.complete
                        ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Complete</Badge>
                        : <Badge variant="outline" className="border-amber-300 text-amber-800">Incomplete</Badge>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-slate-500">
                          <th className="px-3 py-1 text-left font-medium">Configuration</th>
                          <th className="px-3 py-1 text-right font-medium">Previous / System</th>
                          <th className="px-3 py-1 text-right font-medium">Physical</th>
                          <th className="px-3 py-1 text-right font-medium">Variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.kind === 'classification' && (
                          <tr className="border-t bg-slate-50/60">
                            <td className="px-3 py-1 text-left text-slate-600">{group.legacy.label} <span className="text-xs text-slate-400">(source → 0)</span></td>
                            <td className="px-3 py-1 text-right tabular-nums">{formatNumber(group.legacy.system)}</td>
                            <td className="px-3 py-1 text-right tabular-nums text-slate-400">0</td>
                            <td className="px-3 py-1 text-right tabular-nums text-red-600">-{formatNumber(group.legacy.system)}</td>
                          </tr>
                        )}
                        {group.lines.map(line => {
                          const variance = line.physical === null ? null : line.physical - line.system
                          return (
                            <tr key={line.key} className="border-t">
                              <td className="px-3 py-1 text-left">{line.label}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{formatNumber(line.system)}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{line.physical === null ? '—' : formatNumber(line.physical)}</td>
                              <td className={`px-3 py-1 text-right font-semibold tabular-nums ${variance === null || variance === 0 ? 'text-slate-500' : variance > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{variance === null ? '—' : `${variance > 0 ? '+' : ''}${formatNumber(variance)}`}</td>
                            </tr>
                          )
                        })}
                        {group.kind === 'classification' && (
                          <tr className="border-t bg-slate-50 font-semibold">
                            <td className="px-3 py-1 text-left">Target total vs legacy</td>
                            <td className="px-3 py-1 text-right tabular-nums">{formatNumber(group.legacy.system)}</td>
                            <td className="px-3 py-1 text-right tabular-nums">{formatNumber(group.targetTotal)}</td>
                            <td className={`px-3 py-1 text-right tabular-nums ${group.variance === 0 ? 'text-slate-600' : group.variance > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{group.variance > 0 ? '+' : ''}{formatNumber(group.variance)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            {highImpact && <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-5 w-5 shrink-0" /><span><strong>High-impact adjustment.</strong> Review quantities and value carefully before requesting verification.</span></div>}
            <div><label className="mb-1.5 block text-sm font-medium">Posting Note {reviewVarianceItems > 0 && <span className="text-red-600">*</span>}</label><Textarea value={notes} onChange={event => handlePostingNoteChange(event.target.value)} placeholder="Explain the reason for this posting..." /></div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">A verification code will be sent to authorized recipients. Inventory will only be updated after the code is verified.</div>
            {preflight.status === 'loading' && <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><Loader2 className="h-4 w-4 animate-spin" />Checking permission, notification recipients, and email provider…</div>}
            {preflight.status === 'ready' && <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Verification is ready. The code will be emailed to {preflight.recipientCount} authorized recipient{preflight.recipientCount === 1 ? '' : 's'}.</span></div>}
            {preflight.status === 'error' && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><div>{preflight.message}</div>{preflight.guidance && <div className="mt-1 text-xs text-red-600">{preflight.guidance}</div>}<Button type="button" variant="outline" size="sm" className="mt-3" onClick={retryVerificationPreflight} disabled={saving || permissionLoading}>{saving ? 'Saving Changes…' : 'Retry Check'}</Button></div>}
            {verificationError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{verificationError}</div>}
            <DialogFooter><Button variant="outline" onClick={closePostDialog}>Cancel</Button><Button onClick={requestVerificationCode} disabled={posting || preflight.status !== 'ready' || !hasPostStockCountPermission || !canPost || (reviewVarianceItems > 0 && !isValidStockCountPostingNote(notes))} className="bg-orange-600 hover:bg-orange-700">{posting ? 'Sending Code...' : preflight.status === 'loading' ? 'Checking Configuration...' : 'Request Verification Code'}</Button></DialogFooter>
          </> : <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
              <div className="font-semibold">Code sent to authorized recipients</div>
              <div className="mt-2 flex flex-wrap gap-2">{verification.recipients.map(recipient => <Badge key={recipient} variant="secondary">{recipient}</Badge>)}</div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">8-digit verification code</label>
              <Input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={verificationCode} onChange={event => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={event => { if (event.key === 'Enter' && verificationCode.length === 8) void verifyAndPostCount() }} className="h-14 text-center font-mono text-2xl tracking-[0.4em]" placeholder="00000000" />
              <div className="flex justify-between text-xs text-slate-500"><span>{expirySeconds > 0 ? `Expires in ${Math.floor(expirySeconds / 60)}:${String(expirySeconds % 60).padStart(2, '0')}` : 'Code expired'}</span><span>Maximum 5 attempts</span></div>
            </div>
            {verificationStale && <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-5 w-5 shrink-0" /><span><strong>Counts changed after this code was issued.</strong> This code can no longer post. Cancel, save the draft, and request a new code.</span></div>}
            {verificationError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{verificationError}</div>}
            <DialogFooter className="gap-2 sm:justify-between">
              <div className="flex gap-2"><Button variant="outline" onClick={closePostDialog}>Cancel</Button><Button variant="ghost" onClick={requestVerificationCode} disabled={posting || resendSeconds > 0}>{resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend Code'}</Button></div>
              <Button onClick={verifyAndPostCount} disabled={posting || verificationCode.length !== 8 || expirySeconds <= 0 || verificationStale} className="bg-orange-600 hover:bg-orange-700">{posting ? 'Posting...' : 'Verify & Post Count'}</Button>
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Card className="border-amber-200 bg-amber-50"><CardContent className="flex items-center gap-3 p-3 text-sm text-amber-900"><Warehouse className="h-4 w-4" /><span>Tip: select a group, update all variant physical counts directly or by Excel import, then save draft before posting.</span></CardContent></Card>
    </div>
  )
}
