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
  buildStockCountWorksheet,
  parseStockCountWorksheet,
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

type CountType = 'full_count' | 'cycle_count' | 'spot_check'
type SessionStatus = 'draft' | 'posted'

interface WarehouseLocation {
  id: string
  org_code: string
  org_name: string
}

interface CountRow {
  inventoryId: string
  stockConfigId: string
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
]
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
            id, config_label, stock_sku, volume_ml, packaging, status
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

      const nextRows: CountRow[] = (data || []).map((item: any) => {
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
        return {
          inventoryId: item.id,
          stockConfigId: item.stock_config_id,
          stockSku: config.stock_sku,
          configLabel: config.config_label,
          volumeMl: config.volume_ml,
          packagingVersion: config.packaging,
          configStatus: config.status,
          variantId: item.variant_id,
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
          systemQuantity: Number(item.quantity_on_hand || 0),
          physicalCount: '',
          note: '',
          unitCost: normalizeBaseCost(variant?.base_cost),
          warehouseLocation: item.warehouse_location || null,
        }
      }).sort((a: CountRow, b: CountRow) => `${a.groupName} ${a.productName} ${a.variantName} ${a.configLabel}`.localeCompare(`${b.groupName} ${b.productName} ${b.variantName} ${b.configLabel}`))

      setRows(nextRows)
    } catch (error: any) {
      toast({ title: 'Inventory load failed', description: error.message, variant: 'destructive' })
    } finally {
      setLoadingRows(false)
    }
  }

  const visibleRows = useMemo(
    () => rows.filter(row => showInactive
      || row.configStatus === 'active'
      || row.systemQuantity !== 0
      || parseCount(row.physicalCount) !== null
      || Boolean(row.note.trim())),
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

  const canSave = Boolean(selectedWarehouse && countDate && visibleRows.length > 0 && currentStatus !== 'posted')
  const canPost = canSave && pageSummary.counted > 0

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

      const draftRows = visibleRows.filter(row => parseCount(row.physicalCount) !== null || row.note.trim())
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
      toast({
        title: 'Draft template is incompatible',
        description: 'This draft predates Stock Configuration IDs and cannot be matched safely. Start a new Stock Count; the historical draft remains unchanged.',
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
    toast({ title: 'Draft opened', description: 'Saved counts are loaded for review.' })
  }

  const resetSession = () => {
    setCurrentSessionId(null)
    setCurrentStatus('draft')
    setCountDate(todayIso())
    setCountType('full_count')
    setReferenceName('')
    setNotes('')
    setRows(prev => prev.map(row => ({ ...row, physicalCount: '', note: '' })))
  }

  const downloadExcel = async () => {
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

  const importExcel = async (file: File) => {
    try {
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.arrayBuffer())
      const sheet = workbook.worksheets[0]
      if (!sheet) throw new Error('The Excel file does not contain a worksheet.')

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
      toast({ title: 'Import complete', description: `${result.updated} updated, ${result.unchanged} unchanged, ${result.failed} failed.` })
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
    if (pageSummary.varianceItems > 0 && !isValidStockCountPostingNote(notes)) {
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
    try {
      const response = await fetch(`/api/inventory/stock-count/verification/preflight?sessionId=${encodeURIComponent(sessionId)}`)
      const result = await response.json()
      if (!response.ok || !result.ok) {
        setPreflight({ status: 'error', code: result.code, message: result.error, guidance: result.guidance })
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
    if (pageSummary.varianceItems === 0) return

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
      setVerificationCode('')
      setConfirmPostOpen(false)
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
  const highImpact = Math.abs(pageSummary.estimatedValue) >= HIGH_IMPACT_VALUE_THRESHOLD || Math.abs(pageSummary.netAdjustment) >= 1000

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
          <Button variant="outline" onClick={downloadExcel} disabled={!visibleRows.length}><Download className="mr-2 h-4 w-4" /> Download Excel Template</Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="mr-2 h-4 w-4" /> Import Updated Excel</Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={event => {
            const file = event.target.files?.[0]
            if (file) importExcel(file)
            event.target.value = ''
          }} />
          <Button variant="outline" onClick={() => void saveDraft()} disabled={!canSave || saving}><Save className="mr-2 h-4 w-4" /> {saving ? 'Saving...' : 'Save Draft'}</Button>
          <Button onClick={openPostReview} disabled={!canPost || currentStatus === 'posted'} className="bg-orange-600 hover:bg-orange-700">Review & Post Count <ArrowRight className="ml-2 h-4 w-4" /></Button>
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
              <Button key={draft.id} variant={currentSessionId === draft.id ? 'default' : 'outline'} size="sm" onClick={() => loadDraft(draft.id)}>
                {draft.reference_name || countTypeOptions.find(option => option.value === draft.count_type)?.label || 'Draft'} · {draft.count_date}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={resetSession}>New count</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {summaryCards.map(card => <Card key={card.label}><CardContent className="flex items-center gap-4 p-4"><div className={`flex h-12 w-12 items-center justify-center rounded-lg ${card.color}`}><card.icon className="h-6 w-6" /></div><div className="min-w-0"><p className="text-sm font-semibold text-slate-600">{card.label}</p><p className="truncate text-xl font-bold text-slate-950">{card.value}</p><p className="text-xs text-slate-500">{card.sub}</p></div></CardContent></Card>)}
      </div>

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

      {importSummary && <Card className="border-slate-200"><CardHeader><CardTitle>Import Summary</CardTitle></CardHeader><CardContent><div className="mb-3 flex flex-wrap gap-2"><Badge className="bg-green-600">Updated {importSummary.updated}</Badge><Badge variant="secondary">Unchanged {importSummary.unchanged}</Badge><Badge variant="destructive">Failed {importSummary.failed}</Badge></div>{importSummary.rows.filter(row => row.status === 'Failed').slice(0, 6).map(row => <p key={`${row.row}-${row.sku}`} className="text-sm text-red-600">Row {row.row}: {row.sku} - {row.message}</p>)}</CardContent></Card>}

      <Dialog open={confirmPostOpen} onOpenChange={(open) => open ? setConfirmPostOpen(true) : closePostDialog()}>
        <DialogContent className="max-w-2xl">
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
              <div className="flex justify-between sm:col-span-2"><span>Total configurations counted</span><strong>{formatNumber(pageSummary.counted)}</strong></div>
              <div className="flex justify-between sm:col-span-2"><span>Variance items</span><strong>{formatNumber(pageSummary.varianceItems)}</strong></div>
              <div className={`flex justify-between rounded-md px-2 py-1 sm:col-span-2 ${highImpact ? 'bg-amber-100 text-amber-950' : ''}`}><span>Net quantity adjustment</span><strong className={pageSummary.netAdjustment < 0 ? 'text-red-700' : pageSummary.netAdjustment > 0 ? 'text-emerald-700' : ''}>{pageSummary.netAdjustment > 0 ? '+' : ''}{formatNumber(pageSummary.netAdjustment)}</strong></div>
              <div className={`flex justify-between rounded-md px-2 py-1 sm:col-span-2 ${highImpact ? 'bg-amber-100 text-amber-950' : ''}`}><span>Estimated adjustment value</span><strong className={pageSummary.estimatedValue < 0 ? 'text-red-700' : pageSummary.estimatedValue > 0 ? 'text-emerald-700' : ''}>{formatMoney(pageSummary.estimatedValue)}</strong></div>
            </div>
            {highImpact && <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-5 w-5 shrink-0" /><span><strong>High-impact adjustment.</strong> Review quantities and value carefully before requesting verification.</span></div>}
            <div><label className="mb-1.5 block text-sm font-medium">Posting Note {pageSummary.varianceItems > 0 && <span className="text-red-600">*</span>}</label><Textarea value={notes} onChange={event => handlePostingNoteChange(event.target.value)} placeholder="Explain the reason for this posting..." /></div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">A verification code will be sent to authorized recipients. Inventory will only be updated after the code is verified.</div>
            {preflight.status === 'loading' && <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><Loader2 className="h-4 w-4 animate-spin" />Checking permission, notification recipients, and email provider…</div>}
            {preflight.status === 'ready' && <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Verification is ready. The code will be emailed to {preflight.recipientCount} authorized recipient{preflight.recipientCount === 1 ? '' : 's'}.</span></div>}
            {preflight.status === 'error' && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><div>{preflight.message}</div>{preflight.guidance && <div className="mt-1 text-xs text-red-600">{preflight.guidance}</div>}<Button type="button" variant="outline" size="sm" className="mt-3" onClick={retryVerificationPreflight} disabled={saving || permissionLoading}>{saving ? 'Saving Changes…' : 'Retry Check'}</Button></div>}
            {verificationError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{verificationError}</div>}
            <DialogFooter><Button variant="outline" onClick={closePostDialog}>Cancel</Button><Button onClick={requestVerificationCode} disabled={posting || preflight.status !== 'ready' || !hasPostStockCountPermission || !canPost || (pageSummary.varianceItems > 0 && !isValidStockCountPostingNote(notes))} className="bg-orange-600 hover:bg-orange-700">{posting ? 'Sending Code...' : preflight.status === 'loading' ? 'Checking Configuration...' : 'Request Verification Code'}</Button></DialogFooter>
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
            {verificationError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{verificationError}</div>}
            <DialogFooter className="gap-2 sm:justify-between">
              <div className="flex gap-2"><Button variant="outline" onClick={closePostDialog}>Cancel</Button><Button variant="ghost" onClick={requestVerificationCode} disabled={posting || resendSeconds > 0}>{resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend Code'}</Button></div>
              <Button onClick={verifyAndPostCount} disabled={posting || verificationCode.length !== 8 || expirySeconds <= 0} className="bg-orange-600 hover:bg-orange-700">{posting ? 'Posting...' : 'Verify & Post Count'}</Button>
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Card className="border-amber-200 bg-amber-50"><CardContent className="flex items-center gap-3 p-3 text-sm text-amber-900"><Warehouse className="h-4 w-4" /><span>Tip: select a group, update all variant physical counts directly or by Excel import, then save draft before posting.</span></CardContent></Card>
    </div>
  )
}
