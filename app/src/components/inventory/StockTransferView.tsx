'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ArrowRight, Building2, CheckCircle2, Download, FileText, MoreHorizontal,
  Save, Search, Send, Truck, Upload,
} from 'lucide-react'
import {
  STOCK_TRANSFER_HQ_APPROVER_LABEL,
  STOCK_TRANSFER_NOTES_MAX,
  STOCK_TRANSFER_STAGES,
  SourceInventoryRow,
  afterTransferQty,
  buildTransferRpcItems,
  canApproveStockTransfer,
  canCancelStockTransfer,
  canDispatchStockTransfer,
  canPrintTransferNote,
  canReceiveStockTransfer,
  canRejectStockTransfer,
  configBadgeClass,
  filterSourceInventoryRows,
  formatTransferItemsSummary,
  inventoryRowKey,
  isHqInventoryAdmin,
  isTransferableConfiguration,
  mapDbStatusToStage,
  paginateRows,
  summarizeDraftSelection,
  transferStatusBadgeClass,
  transferStatusLabel,
  transferStockImpactMessage,
  validateTransferQuantity,
  validateTransferRoute,
} from '@/lib/inventory/stock-transfer'
import type { Json } from '@/types/database'
import {
  buildStockTransferWorksheet,
  parseStockTransferImport,
} from '@/lib/inventory/stock-transfer-excel'
import {
  downloadTransferNotePdf,
  transferNoteLinesFromItems,
} from '@/lib/inventory/stock-transfer-note'

interface Warehouse {
  id: string
  org_code: string
  org_name: string
}

interface TransferRecord {
  id: string
  transfer_no: string
  from_organization_id: string
  to_organization_id: string
  status: string
  items: any[]
  total_items: number | null
  total_value: number | null
  notes: string | null
  required_date: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
  submitted_by?: string | null
  approved_at: string | null
  approved_by: string | null
  received_at: string | null
  received_by: string | null
  shipped_at: string | null
  dispatched_by?: string | null
  created_by: string
  from_org?: Warehouse | null
  to_org?: Warehouse | null
}

interface StockTransferViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

const PAGE_SIZE = 10

export default function StockTransferView({ userProfile }: StockTransferViewProps) {
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [fromWarehouse, setFromWarehouse] = useState('')
  const [toWarehouse, setToWarehouse] = useState('')
  const [requiredDate, setRequiredDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [transferId, setTransferId] = useState<string | null>(null)
  const [transferNo, setTransferNo] = useState<string>('(unsaved draft)')
  const [status, setStatus] = useState<string>('draft')

  const [sourceRows, setSourceRows] = useState<SourceInventoryRow[]>([])
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [productLine, setProductLine] = useState('all')
  const [configurationKey, setConfigurationKey] = useState('all')
  const [availableOnly, setAvailableOnly] = useState(true)
  const [page, setPage] = useState(1)

  const [recent, setRecent] = useState<TransferRecord[]>([])
  const [loadingInventory, setLoadingInventory] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'submit' | 'approve' | 'dispatch' | 'receive' | 'reject' | 'cancel' | null>(null)
  const [isHqAdmin, setIsHqAdmin] = useState(false)

  // Only true drafts are editable. Legacy `pending` rows may already have
  // source movements and must not be rewritten through the draft composer.
  const editable = status === 'draft'
  const roleLevel = Number(userProfile?.roles?.role_level)
  const profileSaysHqAdmin = isHqInventoryAdmin(roleLevel)

  useEffect(() => {
    if (!isReady) return
    void loadWarehouses()
    void loadRecent()
    // Prefer the canonical RPC; fall back to role_level <= 10 if RPC unavailable.
    void supabase.rpc('is_hq_admin').then(({ data, error }) => {
      if (error) {
        setIsHqAdmin(profileSaysHqAdmin)
        return
      }
      setIsHqAdmin(Boolean(data) || profileSaysHqAdmin)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, profileSaysHqAdmin])

  useEffect(() => {
    if (!fromWarehouse) {
      setSourceRows([])
      return
    }
    void loadSourceInventory(fromWarehouse)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromWarehouse])

  const loadWarehouses = async () => {
    const { data, error } = await supabase
      .from('organizations')
      .select('id, org_code, org_name')
      .in('org_type_code', ['HQ', 'WH'])
      .eq('is_active', true)
      .order('org_name')
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
      return
    }
    setWarehouses(data || [])
  }

  const loadRecent = async () => {
    const { data, error } = await supabase
      .from('stock_transfers')
      .select('id, transfer_no, from_organization_id, to_organization_id, status, items, total_items, total_value, notes, required_date, created_at, updated_at, submitted_at, submitted_by, approved_at, approved_by, received_at, received_by, shipped_at, dispatched_by, created_by')
      .order('updated_at', { ascending: false })
      .limit(25)
    if (error) {
      toast({ title: 'Error', description: `Failed to load transfers: ${error.message}`, variant: 'destructive' })
      return
    }
    const rows = (data || []) as TransferRecord[]
    const orgIds = Array.from(new Set(rows.flatMap((row) => [row.from_organization_id, row.to_organization_id])))
    const orgMap = new Map(warehouses.map((wh) => [wh.id, wh]))
    if (orgIds.some((id) => !orgMap.has(id))) {
      const { data: orgs } = await supabase
        .from('organizations')
        .select('id, org_code, org_name')
        .in('id', orgIds)
      ;(orgs || []).forEach((org: Warehouse) => orgMap.set(org.id, org))
    }
    setRecent(rows.map((row) => ({
      ...row,
      items: Array.isArray(row.items) ? row.items : [],
      from_org: orgMap.get(row.from_organization_id) || null,
      to_org: orgMap.get(row.to_organization_id) || null,
    })))
  }

  const loadSourceInventory = async (organizationId: string) => {
    try {
      setLoadingInventory(true)
      const { data, error } = await supabase
        .from('product_inventory')
        .select(`
          variant_id,
          stock_config_id,
          quantity_available,
          average_cost,
          product_variants!inner (
            id,
            variant_name,
            variant_code,
            image_url,
            product_id,
            products!inner (
              id,
              product_code,
              product_name,
              product_groups (id, group_name)
            )
          ),
          inventory_stock_configurations!product_inventory_stock_config_fk (
            id,
            config_label,
            stock_sku,
            volume_ml,
            packaging,
            config_code,
            status
          )
        `)
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .not('stock_config_id', 'is', null)

      if (error) throw error

      const rows: SourceInventoryRow[] = []
      for (const item of data || []) {
        const variant = (item as any).product_variants
        const product = Array.isArray(variant?.products) ? variant.products[0] : variant?.products
        const group = Array.isArray(product?.product_groups) ? product.product_groups[0] : product?.product_groups
        const config = Array.isArray((item as any).inventory_stock_configurations)
          ? (item as any).inventory_stock_configurations[0]
          : (item as any).inventory_stock_configurations
        if (!config?.id) continue
        if (!isTransferableConfiguration({
          stockConfigId: config.id,
          configCode: config.config_code,
          status: config.status,
        })) continue

        rows.push({
          inventoryKey: inventoryRowKey(variant.id, config.id),
          variantId: variant.id,
          stockConfigId: config.id,
          productId: product?.id || '',
          productCode: product?.product_code || '',
          productName: product?.product_name || '',
          variantName: variant.variant_name || '',
          flavour: variant.variant_name || '',
          productLine: group?.group_name || 'Ungrouped',
          configLabel: config.config_label || config.stock_sku,
          stockSku: config.stock_sku,
          volumeMl: config.volume_ml,
          packaging: config.packaging,
          configCode: config.config_code,
          available: Number(item.quantity_available || 0),
          unitCost: item.average_cost == null ? null : Number(item.average_cost),
          imageUrl: variant.image_url,
        })
      }

      rows.sort((a, b) => a.variantName.localeCompare(b.variantName) || a.configLabel.localeCompare(b.configLabel))
      setSourceRows(rows)
      setPage(1)
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to load inventory', variant: 'destructive' })
    } finally {
      setLoadingInventory(false)
    }
  }

  const productLines = useMemo(
    () => Array.from(new Set(sourceRows.map((row) => row.productLine))).sort(),
    [sourceRows],
  )

  const configurationOptions = useMemo(() => {
    const map = new Map<string, string>()
    sourceRows.forEach((row) => {
      const key = `${row.volumeMl ?? 'std'}|${row.packaging ?? 'none'}|${row.configLabel}`
      map.set(key, row.configLabel)
    })
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [sourceRows])

  const filteredRows = useMemo(
    () => filterSourceInventoryRows(sourceRows, {
      search,
      productLine,
      configurationKey,
      availableOnly,
    }),
    [sourceRows, search, productLine, configurationKey, availableOnly],
  )

  const { pageRows, totalPages, page: safePage } = useMemo(
    () => paginateRows(filteredRows, page, PAGE_SIZE),
    [filteredRows, page],
  )

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  const summary = useMemo(
    () => summarizeDraftSelection(sourceRows, quantities),
    [sourceRows, quantities],
  )

  const activeStage = mapDbStatusToStage(status) || 'draft'
  const fromOrg = warehouses.find((wh) => wh.id === fromWarehouse)
  const toOrg = warehouses.find((wh) => wh.id === toWarehouse)
  const userOrgId = userProfile?.organizations?.id as string | undefined
  const canApprove = canApproveStockTransfer({ status, isHqAdmin })
  const canDispatch = canDispatchStockTransfer({
    status,
    isHqAdmin,
    userOrgId,
    fromOrgId: fromWarehouse,
  })
  const canReceive = canReceiveStockTransfer({
    status,
    isHqAdmin,
    userOrgId,
    toOrgId: toWarehouse,
  })
  const canCancel = canCancelStockTransfer({ status })
  const canReject = canRejectStockTransfer({ status, isHqAdmin })
  const canPrintNote = canPrintTransferNote({ status, hasTransferId: Boolean(transferId) })
  const stockImpact = transferStockImpactMessage(status)

  const setQuantityForKey = (key: string, value: string) => {
    setQuantities((prev) => {
      const next = { ...prev }
      if (value === '') delete next[key]
      else next[key] = value
      return next
    })
  }

  const toggleSelect = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const allVisibleSelected = pageRows.length > 0 && pageRows.every((row) => selectedKeys.has(row.inventoryKey))

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      pageRows.forEach((row) => {
        if (checked) next.add(row.inventoryKey)
        else next.delete(row.inventoryKey)
      })
      return next
    })
  }

  const addSelectedDefaults = () => {
    if (selectedKeys.size === 0) {
      toast({ title: 'No rows selected', description: 'Select one or more inventory rows first.', variant: 'destructive' })
      return
    }
    setQuantities((prev) => {
      const next = { ...prev }
      sourceRows.forEach((row) => {
        if (!selectedKeys.has(row.inventoryKey)) return
        if (next[row.inventoryKey]) return
        if (row.available > 0) next[row.inventoryKey] = '1'
      })
      return next
    })
    toast({ title: 'Selected rows ready', description: 'Enter or adjust Transfer Qty for each selected configuration.' })
  }

  const resetComposer = () => {
    setTransferId(null)
    setTransferNo('(unsaved draft)')
    setStatus('draft')
    setFromWarehouse('')
    setToWarehouse('')
    setRequiredDate(new Date().toISOString().slice(0, 10))
    setNotes('')
    setQuantities({})
    setSelectedKeys(new Set())
    setSearch('')
    setProductLine('all')
    setConfigurationKey('all')
    setAvailableOnly(true)
    setPage(1)
  }

  const openTransfer = async (record: TransferRecord) => {
    setTransferId(record.id)
    setTransferNo(record.transfer_no)
    setStatus(record.status)
    setFromWarehouse(record.from_organization_id)
    setToWarehouse(record.to_organization_id)
    setRequiredDate(record.required_date || new Date().toISOString().slice(0, 10))
    setNotes(record.notes || '')
    const nextQty: Record<string, string> = {}
    for (const item of record.items || []) {
      if (!item?.variant_id || !item?.stock_config_id) continue
      nextQty[inventoryRowKey(item.variant_id, item.stock_config_id)] = String(item.quantity || '')
    }
    setQuantities(nextQty)
    setSelectedKeys(new Set(Object.keys(nextQty)))
    toast({ title: 'Transfer opened', description: record.transfer_no })
  }

  const collectItemsOrToast = () => {
    const routeError = validateTransferRoute(fromWarehouse, toWarehouse)
    if (routeError) {
      toast({ title: 'Validation Error', description: routeError, variant: 'destructive' })
      return null
    }
    if (notes.length > STOCK_TRANSFER_NOTES_MAX) {
      toast({ title: 'Validation Error', description: `Notes cannot exceed ${STOCK_TRANSFER_NOTES_MAX} characters`, variant: 'destructive' })
      return null
    }
    try {
      const items = buildTransferRpcItems(sourceRows, quantities)
      if (items.length === 0) {
        toast({ title: 'Validation Error', description: 'Select at least one configuration quantity to transfer', variant: 'destructive' })
        return null
      }
      if (summary.errors.length) {
        toast({ title: 'Validation Error', description: summary.errors[0], variant: 'destructive' })
        return null
      }
      return items
    } catch (error: any) {
      toast({ title: 'Validation Error', description: error.message, variant: 'destructive' })
      return null
    }
  }

  const saveDraft = async () => {
    const items = collectItemsOrToast()
    if (!items) return
    try {
      setSaving(true)
      const { data, error } = await supabase.rpc('save_stock_transfer_draft', {
        p_company_id: userProfile.organizations.id,
        p_from_organization_id: fromWarehouse,
        p_to_organization_id: toWarehouse,
        p_items: items as unknown as Json,
        p_notes: notes || undefined,
        p_required_date: requiredDate || undefined,
        p_transfer_id: transferId || undefined,
        p_created_by: userProfile.id,
      })
      if (error) throw error
      setTransferId(data.id)
      setTransferNo(data.transfer_no)
      setStatus(data.status)
      toast({ title: 'Draft saved', description: `${data.transfer_no} saved without changing stock.` })
      await loadRecent()
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to save draft', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const runConfirmedAction = async () => {
    const action = confirmAction
    setConfirmAction(null)
    if (!action) return

    try {
      setSaving(true)
      if (action === 'submit') {
        let id = transferId
        if (!id || status === 'draft') {
          const items = collectItemsOrToast()
          if (!items) return
          const { data, error } = await supabase.rpc('save_stock_transfer_draft', {
            p_company_id: userProfile.organizations.id,
            p_from_organization_id: fromWarehouse,
            p_to_organization_id: toWarehouse,
            p_items: items as unknown as Json,
            p_notes: notes || undefined,
            p_required_date: requiredDate || undefined,
            p_transfer_id: transferId || undefined,
            p_created_by: userProfile.id,
          })
          if (error) throw error
          id = data.id
          setTransferId(data.id)
          setTransferNo(data.transfer_no)
        }
        const { data, error } = await supabase.rpc('submit_stock_transfer_for_approval', {
          p_transfer_id: id,
          p_actor_id: userProfile.id,
        })
        if (error) throw error
        setStatus(data.status)
        toast({ title: 'Submitted', description: `${data.transfer_no} is pending approval. Stock is reserved, not deducted.` })
      } else if (action === 'approve') {
        if (!transferId) throw new Error('Open a pending transfer first')
        const { data, error } = await supabase.rpc('approve_stock_transfer', {
          p_transfer_id: transferId,
          p_actor_id: userProfile.id,
        })
        if (error) throw error
        setStatus(data.status)
        toast({
          title: 'Approved',
          description: `${data.transfer_no} is Ready to Dispatch. Reservation kept; On Hand unchanged.`,
        })
        await printTransferNote(data)
      } else if (action === 'dispatch') {
        if (!transferId) throw new Error('Open a ready-to-dispatch transfer first')
        const { data, error } = await supabase.rpc('dispatch_stock_transfer', {
          p_transfer_id: transferId,
          p_actor_id: userProfile.id,
        })
        if (error) throw error
        setStatus(data.status)
        toast({
          title: 'Dispatched',
          description: `${data.transfer_no} is In Transit. Source stock deducted once.`,
        })
      } else if (action === 'receive') {
        if (!transferId) throw new Error('Open an in-transit transfer first')
        const { data, error } = await supabase.rpc('receive_stock_transfer', {
          p_transfer_id: transferId,
          p_actor_id: userProfile.id,
        })
        if (error) throw error
        setStatus(data.status)
        toast({ title: 'Received', description: `${data.transfer_no} completed. Destination stock posted once.` })
      } else if (action === 'reject') {
        if (!transferId) throw new Error('Open a pending transfer first')
        const { data, error } = await supabase.rpc('reject_stock_transfer', {
          p_transfer_id: transferId,
          p_actor_id: userProfile.id,
          p_reason: 'Rejected from Stock Transfer screen',
        })
        if (error) throw error
        setStatus(data.status)
        toast({ title: 'Rejected', description: `${data.transfer_no} rejected. Reservation released.` })
      } else if (action === 'cancel') {
        if (!transferId) throw new Error('Save or open a transfer first')
        const { data, error } = await supabase.rpc('cancel_stock_transfer', {
          p_transfer_id: transferId,
          p_actor_id: userProfile.id,
          p_reason: 'Cancelled from Stock Transfer screen',
        })
        if (error) throw error
        setStatus(data.status)
        toast({ title: 'Cancelled', description: `${data.transfer_no} cancelled.` })
      }
      await loadRecent()
      if (fromWarehouse) await loadSourceInventory(fromWarehouse)
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Action failed', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const printTransferNote = async (record?: TransferRecord | any) => {
    const current = record || recent.find((row) => row.id === transferId)
    if (!current) {
      toast({ title: 'Transfer Note', description: 'Save or open a transfer first.', variant: 'destructive' })
      return
    }
    const from = warehouses.find((wh) => wh.id === current.from_organization_id)
      || current.from_org
      || { org_code: '—', org_name: 'Source' }
    const to = warehouses.find((wh) => wh.id === current.to_organization_id)
      || current.to_org
      || { org_code: '—', org_name: 'Destination' }
    downloadTransferNotePdf({
      transferNo: current.transfer_no,
      status: current.status,
      from: { orgCode: from.org_code, orgName: from.org_name },
      to: { orgCode: to.org_code, orgName: to.org_name },
      requiredDate: current.required_date,
      notes: current.notes,
      requestedBy: userProfile?.full_name || userProfile?.email || 'Requester',
      approvedBy: current.approved_by ? STOCK_TRANSFER_HQ_APPROVER_LABEL : null,
      approvedAt: current.approved_at,
      shippedAt: current.shipped_at,
      receivedBy: current.received_by ? 'Destination warehouse' : null,
      receivedAt: current.received_at,
      createdAt: current.created_at,
      lines: transferNoteLinesFromItems(current.items),
    })
  }

  const exportExcel = async () => {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    buildStockTransferWorksheet(workbook, filteredRows, quantities)
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `stock-transfer-${fromOrg?.org_code || 'source'}.xlsx`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importExcel = async (file: File) => {
    try {
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.arrayBuffer())
      const result = await parseStockTransferImport(workbook, sourceRows)
      setQuantities((prev) => ({ ...prev, ...result.quantities }))
      setSelectedKeys((prev) => {
        const next = new Set(prev)
        Object.keys(result.quantities).forEach((key) => next.add(key))
        return next
      })
      toast({
        title: 'Excel import complete',
        description: `${result.updated} updated, ${result.unchanged} unchanged, ${result.failed} failed`,
        variant: result.failed ? 'destructive' : 'default',
      })
    } catch (error: any) {
      toast({ title: 'Import failed', description: error.message, variant: 'destructive' })
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Supply Chain &gt; Inventory &gt; Stock Transfer</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">Stock Transfer</h1>
        <p className="text-gray-600 mt-1">
          Bulk-select exact stock configurations, then move through Draft → Pending Approval → Ready to Dispatch → In Transit → Received.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {STOCK_TRANSFER_STAGES.map((stage, index) => {
              const stageIndex = STOCK_TRANSFER_STAGES.findIndex((item) => item.id === activeStage)
              const active = index <= stageIndex && !['cancelled', 'rejected'].includes(status)
              return (
                <div
                  key={stage.id}
                  className={`rounded-lg border px-3 py-3 text-sm ${active ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-500'}`}
                >
                  <div className="font-semibold">{index + 1}. {stage.label}</div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="w-5 h-5" />
                Transfer Route
              </CardTitle>
              <CardDescription>Select source and destination once. Configurations stay exact end-to-end.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">From Warehouse</label>
                  <Select value={fromWarehouse} onValueChange={setFromWarehouse} disabled={!editable}>
                    <SelectTrigger><SelectValue placeholder="Source warehouse" /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map((wh) => (
                        <SelectItem key={wh.id} value={wh.id} disabled={wh.id === toWarehouse}>
                          <span className="flex items-center gap-2">
                            <Building2 className="w-4 h-4" />
                            {wh.org_name} ({wh.org_code})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-center pb-2">
                  <ArrowRight className="w-6 h-6 text-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">To Warehouse</label>
                  <Select value={toWarehouse} onValueChange={setToWarehouse} disabled={!editable}>
                    <SelectTrigger><SelectValue placeholder="Destination warehouse" /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map((wh) => (
                        <SelectItem key={wh.id} value={wh.id} disabled={wh.id === fromWarehouse}>
                          <span className="flex items-center gap-2">
                            <Building2 className="w-4 h-4" />
                            {wh.org_name} ({wh.org_code})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Required Date</label>
                  <Input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} disabled={!editable} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Transfer Reference</label>
                  <Input value={transferNo} readOnly className="bg-slate-50" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes <span className="text-slate-400">({notes.length}/{STOCK_TRANSFER_NOTES_MAX})</span>
                </label>
                <Textarea
                  value={notes}
                  maxLength={STOCK_TRANSFER_NOTES_MAX}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={!editable}
                  placeholder="Optional transfer context"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Select Stock Items</CardTitle>
              <CardDescription>
                Every row is an exact stock_config_id. Legacy/Unclassified balances are excluded from this flow.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2 relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="pl-9"
                    placeholder="Search flavour, product, code or Stock SKU"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                    disabled={!fromWarehouse}
                  />
                </div>
                <Select value={productLine} onValueChange={(value) => { setProductLine(value); setPage(1) }} disabled={!fromWarehouse}>
                  <SelectTrigger><SelectValue placeholder="Product Line" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All product lines</SelectItem>
                    {productLines.map((line) => (
                      <SelectItem key={line} value={line}>{line}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={configurationKey} onValueChange={(value) => { setConfigurationKey(value); setPage(1) }} disabled={!fromWarehouse}>
                  <SelectTrigger><SelectValue placeholder="Configuration" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All configurations</SelectItem>
                    {configurationOptions.map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={availableOnly} onCheckedChange={setAvailableOnly} disabled={!fromWarehouse} id="available-only" />
                  <label htmlFor="available-only" className="text-sm text-slate-700">Show available only</label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={!fromWarehouse || loadingInventory} onClick={() => void exportExcel()}>
                    <Download className="w-4 h-4 mr-2" /> Export Excel
                  </Button>
                  <Button type="button" variant="outline" disabled={!editable || !fromWarehouse} onClick={() => fileInputRef.current?.click()}>
                    <Upload className="w-4 h-4 mr-2" /> Import Excel
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void importExcel(file)
                    }}
                  />
                  <Button type="button" disabled={!editable || !fromWarehouse} onClick={addSelectedDefaults}>
                    Add Selected
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={allVisibleSelected}
                          onCheckedChange={(checked) => toggleSelectAllVisible(Boolean(checked))}
                          disabled={!editable || pageRows.length === 0}
                          aria-label="Select all visible"
                        />
                      </TableHead>
                      <TableHead>Product / Flavour</TableHead>
                      <TableHead>Configuration</TableHead>
                      <TableHead>Stock SKU</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="w-32">Transfer Qty</TableHead>
                      <TableHead className="text-right">After Transfer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!fromWarehouse ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-slate-500 py-10">
                          Select a source warehouse to load transferable configurations.
                        </TableCell>
                      </TableRow>
                    ) : loadingInventory ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-slate-500 py-10">Loading inventory…</TableCell>
                      </TableRow>
                    ) : pageRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-slate-500 py-10">No matching stock configurations.</TableCell>
                      </TableRow>
                    ) : pageRows.map((row) => {
                      const qtyRaw = quantities[row.inventoryKey] || ''
                      const validation = qtyRaw ? validateTransferQuantity(qtyRaw, row.available) : null
                      const qtyValue = validation?.ok ? validation.value : 0
                      const after = qtyRaw && validation?.ok ? afterTransferQty(row.available, qtyValue) : row.available
                      return (
                        <TableRow key={row.inventoryKey}>
                          <TableCell>
                            <Checkbox
                              checked={selectedKeys.has(row.inventoryKey)}
                              onCheckedChange={(checked) => toggleSelect(row.inventoryKey, Boolean(checked))}
                              disabled={!editable}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-slate-900">{row.productName}</div>
                            <div className="text-xs text-slate-500">{row.variantName}</div>
                            <div className="text-xs text-slate-400">{row.productCode}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={configBadgeClass(row.volumeMl, row.packaging)}>
                              {row.configLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.stockSku}</TableCell>
                          <TableCell className="text-right">{row.available.toLocaleString()}</TableCell>
                          <TableCell>
                            <Input
                              type="text"
                              inputMode="numeric"
                              value={qtyRaw}
                              disabled={!editable}
                              onChange={(e) => setQuantityForKey(row.inventoryKey, e.target.value)}
                              className={validation && !validation.ok ? 'border-red-500' : ''}
                            />
                            {validation && !validation.ok ? (
                              <p className="text-[11px] text-red-600 mt-1">{validation.error}</p>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right">{after.toLocaleString()}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>{filteredRows.length} configuration rows</span>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <span>Page {safePage} / {totalPages}</span>
                  <Button type="button" variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 xl:sticky xl:top-4">
          <Card>
            <CardHeader>
              <CardTitle>Draft Summary</CardTitle>
              <CardDescription>
                {fromOrg && toOrg ? `${fromOrg.org_code} → ${toOrg.org_code}` : 'Select a transfer route'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Status</span>
                <Badge variant="outline" className={transferStatusBadgeClass(status)}>{transferStatusLabel(status)}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-slate-500">Flavours</div>
                  <div className="text-lg font-semibold">{summary.selectedFlavours}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-slate-500">Configurations</div>
                  <div className="text-lg font-semibold">{summary.selectedConfigs}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-slate-500">Total Qty</div>
                  <div className="text-lg font-semibold">{summary.totalQuantity.toLocaleString()}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-slate-500">Est. Value</div>
                  <div className="text-lg font-semibold">RM {summary.estimatedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {stockImpact}
              </div>

              <div className="space-y-2">
                {editable ? (
                  <>
                    <Button className="w-full" disabled={saving} onClick={() => void saveDraft()}>
                      <Save className="w-4 h-4 mr-2" /> Save Draft
                    </Button>
                    <Button className="w-full" variant="default" disabled={saving} onClick={() => setConfirmAction('submit')}>
                      <Send className="w-4 h-4 mr-2" /> Submit for Approval
                    </Button>
                  </>
                ) : null}
                {canApprove ? (
                  <Button className="w-full" disabled={saving} onClick={() => setConfirmAction('approve')}>
                    <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
                  </Button>
                ) : null}
                {canReject ? (
                  <Button className="w-full" variant="outline" disabled={saving} onClick={() => setConfirmAction('reject')}>
                    Reject / Recall
                  </Button>
                ) : null}
                {canDispatch ? (
                  <Button className="w-full" disabled={saving} onClick={() => setConfirmAction('dispatch')}>
                    <Truck className="w-4 h-4 mr-2" /> Mark as Dispatched
                  </Button>
                ) : null}
                {canReceive ? (
                  <Button className="w-full" disabled={saving} onClick={() => setConfirmAction('receive')}>
                    Mark as Received
                  </Button>
                ) : null}
                {canCancel && transferId ? (
                  <Button className="w-full" variant="ghost" disabled={saving} onClick={() => setConfirmAction('cancel')}>
                    {status === 'pending_approval' ? 'Recall / Cancel' : 'Cancel Transfer'}
                  </Button>
                ) : null}
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={!canPrintNote}
                  onClick={() => void printTransferNote()}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  {status === 'received' ? 'View / Print Transfer Note' : 'Print Transfer Note'}
                </Button>
                <Button className="w-full" variant="outline" onClick={resetComposer}>
                  New Transfer
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Approval Flow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="font-medium text-slate-900">Requested by</div>
                <div className="text-slate-600">{userProfile?.full_name || 'HQ / Warehouse user'}</div>
              </div>
              <div>
                <div className="font-medium text-slate-900">Approver</div>
                <div className="text-slate-600">{STOCK_TRANSFER_HQ_APPROVER_LABEL}</div>
              </div>
              <div>
                <div className="font-medium text-slate-900">Dispatch</div>
                <div className="text-slate-600">Source warehouse (or HQ Admin override)</div>
              </div>
              <div>
                <div className="font-medium text-slate-900">Receive</div>
                <div className="text-slate-600">Destination warehouse (or HQ Admin override)</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 text-slate-600">
                Submit reserves Available. Approve keeps the reservation and enables the Transfer Note.
                Source On Hand is deducted only when the source warehouse marks Dispatched.
                Destination stock posts only on receipt.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Drafts & Transfers</CardTitle>
          <CardDescription>Historical transfers remain available. Pre-configuration lines render safely without rewriting movement history.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transfer Reference</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-slate-500 py-8">No transfers yet.</TableCell>
                  </TableRow>
                ) : recent.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.transfer_no}</TableCell>
                    <TableCell>
                      {(row.from_org?.org_code || '—')} → {(row.to_org?.org_code || '—')}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate">{formatTransferItemsSummary(row.items)}</TableCell>
                    <TableCell className="text-right">{Number(row.total_items || 0).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={transferStatusBadgeClass(row.status)}>
                        {transferStatusLabel(row.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(row.updated_at || row.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => void openTransfer(row)}>Open</Button>
                        <Button size="sm" variant="ghost" onClick={() => void printTransferNote(row)} aria-label="More">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!saving && !open) setConfirmAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'submit' && 'Submit for approval?'}
              {confirmAction === 'approve' && 'Approve this transfer?'}
              {confirmAction === 'dispatch' && 'Mark as dispatched?'}
              {confirmAction === 'receive' && 'Confirm receipt?'}
              {confirmAction === 'reject' && 'Reject / recall this transfer?'}
              {confirmAction === 'cancel' && 'Cancel this transfer?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'submit' && 'Source stock will be reserved (allocated). On Hand remains unchanged until dispatch.'}
              {confirmAction === 'approve' && 'Reservation integrity will be revalidated. Reservation stays active, On Hand is unchanged, and the Transfer Note becomes available.'}
              {confirmAction === 'dispatch' && 'Source warehouse confirms goods left. Reservation is consumed and transfer_out is posted exactly once.'}
              {confirmAction === 'receive' && 'Destination stock will be posted exactly once and the transfer will complete.'}
              {confirmAction === 'reject' && 'The pending reservation will be released once and the transfer marked Rejected.'}
              {confirmAction === 'cancel' && 'Draft cancels with no stock effect. Pending Approval and Ready to Dispatch release the reservation once. In Transit cannot be cancelled here.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Back</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={(event) => { event.preventDefault(); void runConfirmedAction() }}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
