'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
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
  unitCost: number
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

interface StockAdjustmentViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

const ALL_GROUP_ID = 'all'
const UNGROUPED_GROUP_ID = 'ungrouped'
const todayIso = () => new Date().toISOString().slice(0, 10)
const countTypeOptions: Array<{ value: CountType; label: string }> = [
  { value: 'full_count', label: 'Full Count' },
  { value: 'cycle_count', label: 'Cycle Count' },
  { value: 'spot_check', label: 'Spot Check' },
]
const formatNumber = (value: number) => value.toLocaleString('en-MY')
const formatMoney = (value: number) => `RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const parseCount = (value: string) => (value.trim() === '' ? null : Number(value))
const skuForRow = (row: CountRow) => row.manufacturerSku || row.variantCode || row.manualSku || row.variantId
const varianceForRow = (row: CountRow) => {
  const physical = parseCount(row.physicalCount)
  return physical === null ? null : physical - row.systemQuantity
}
const adjustmentValueForRow = (row: CountRow) => {
  const variance = varianceForRow(row)
  return variance === null ? null : variance * row.unitCost
}

export default function StockAdjustmentView({ userProfile, onViewChange }: StockAdjustmentViewProps) {
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
  const [groupExpanded, setGroupExpanded] = useState(true)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [confirmPostOpen, setConfirmPostOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState({ unitCost: true, adjustmentValue: true, note: true })

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
      const { data, error } = await supabase
        .from('product_inventory')
        .select(`
          id,
          variant_id,
          organization_id,
          quantity_on_hand,
          average_cost,
          warehouse_location,
          product_variants!inner (
            id,
            product_id,
            variant_code,
            variant_name,
            manufacturer_sku,
            manual_sku,
            image_url,
            is_active,
            base_cost,
            products!inner (
              id,
              product_code,
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
        const variant = Array.isArray(item.product_variants) ? item.product_variants[0] : item.product_variants
        const product = Array.isArray(variant?.products) ? variant.products[0] : variant?.products
        const group = Array.isArray(product?.product_groups) ? product.product_groups[0] : product?.product_groups
        const brand = Array.isArray(product?.brands) ? product.brands[0] : product?.brands
        const groupId = group?.id || brand?.id || UNGROUPED_GROUP_ID
        const groupName = group?.group_name || brand?.brand_name || 'Ungrouped'
        return {
          inventoryId: item.id,
          variantId: item.variant_id,
          productName: product?.product_name || 'Unnamed product',
          productCode: product?.product_code || '',
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
          unitCost: Number(item.average_cost ?? variant?.base_cost ?? 0),
          warehouseLocation: item.warehouse_location || null,
        }
      }).sort((a, b) => `${a.groupName} ${a.productName} ${a.variantName}`.localeCompare(`${b.groupName} ${b.productName} ${b.variantName}`))

      setRows(nextRows)
    } catch (error: any) {
      toast({ title: 'Inventory load failed', description: error.message, variant: 'destructive' })
    } finally {
      setLoadingRows(false)
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; logoUrl: string | null; description: string | null }>()
    rows.forEach(row => {
      const existing = map.get(row.groupId)
      if (existing) existing.count += 1
      else map.set(row.groupId, { id: row.groupId, name: row.groupName, count: 1, logoUrl: row.brandLogoUrl || row.imageUrl, description: row.groupDescription })
    })
    return [{ id: ALL_GROUP_ID, name: 'All', count: rows.length, logoUrl: null, description: null }, ...Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))]
  }, [rows])

  const selectedGroup = groups.find(group => group.id === selectedGroupId) || groups[0]
  const selectedGroupRows = useMemo(() => {
    const scoped = selectedGroupId === ALL_GROUP_ID ? rows : rows.filter(row => row.groupId === selectedGroupId)
    const query = searchTerm.trim().toLowerCase()
    return scoped.filter(row => {
      const variance = varianceForRow(row)
      if (showVarianceOnly && (!variance || variance === 0)) return false
      if (!query) return true
      return [row.productName, row.variantName, row.variantCode, row.manufacturerSku, row.manualSku].filter(Boolean).some(value => String(value).toLowerCase().includes(query))
    })
  }, [rows, searchTerm, selectedGroupId, showVarianceOnly])

  const pageSummary = useMemo(() => {
    const counted = rows.filter(row => parseCount(row.physicalCount) !== null)
    const variances = counted.map(row => varianceForRow(row) || 0)
    return {
      totalItems: rows.length,
      counted: counted.length,
      notCounted: rows.length - counted.length,
      varianceItems: variances.filter(value => value !== 0).length,
      netAdjustment: variances.reduce((sum, value) => sum + value, 0),
      estimatedValue: rows.reduce((sum, row) => sum + (adjustmentValueForRow(row) || 0), 0),
    }
  }, [rows])

  const groupSummary = useMemo(() => {
    const scoped = selectedGroupId === ALL_GROUP_ID ? rows : rows.filter(row => row.groupId === selectedGroupId)
    return {
      variants: scoped.length,
      systemTotal: scoped.reduce((sum, row) => sum + row.systemQuantity, 0),
      countedTotal: scoped.reduce((sum, row) => sum + (parseCount(row.physicalCount) ?? 0), 0),
      varianceTotal: scoped.reduce((sum, row) => sum + (varianceForRow(row) || 0), 0),
    }
  }, [rows, selectedGroupId])

  const canSave = Boolean(selectedWarehouse && countDate && rows.length > 0 && currentStatus !== 'posted')
  const canPost = canSave && pageSummary.counted > 0

  const updateRow = (variantId: string, patch: Partial<Pick<CountRow, 'physicalCount' | 'note'>>) => {
    setRows(prev => prev.map(row => row.variantId === variantId ? { ...row, ...patch } : row))
  }

  const handlePhysicalCountChange = (variantId: string, value: string) => {
    if (value === '' || /^\d+$/.test(value)) updateRow(variantId, { physicalCount: value })
  }

  const focusNextCountInput = (variantId: string) => {
    const index = selectedGroupRows.findIndex(row => row.variantId === variantId)
    const next = selectedGroupRows[index + 1]
    if (next) document.querySelector<HTMLInputElement>(`input[data-count-input="${next.variantId}"]`)?.focus()
  }

  const saveDraft = async (): Promise<string | null> => {
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
        notes: notes.trim() || null,
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

      const draftRows = rows.filter(row => parseCount(row.physicalCount) !== null || row.note.trim())
      await supabase.from('stock_count_session_items' as any).delete().eq('session_id', sessionId)
      if (draftRows.length > 0) {
        const { error: itemError } = await supabase.from('stock_count_session_items' as any).insert(draftRows.map(row => {
          const physical = parseCount(row.physicalCount)
          return {
            session_id: sessionId,
            variant_id: row.variantId,
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

      toast({ title: 'Draft saved', description: `${draftRows.length} counted or noted row(s) saved.` })
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
    const { data: items, error: itemError } = await supabase.from('stock_count_session_items' as any).select('variant_id, physical_quantity, note').eq('session_id', sessionId)
    if (itemError) {
      toast({ title: 'Open draft failed', description: itemError.message, variant: 'destructive' })
      return
    }

    const itemMap = new Map((items || []).map((item: any) => [item.variant_id, item]))
    setCurrentSessionId((session as any).id)
    setCurrentStatus((session as any).status)
    setCountDate((session as any).count_date)
    setCountType((session as any).count_type)
    setReferenceName((session as any).reference_name || '')
    setNotes((session as any).notes || '')
    setRows(prev => prev.map(row => {
      const item = itemMap.get(row.variantId) as any
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
    if (rows.length === 0) return
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Stock Count')
    worksheet.addRow(['Variant ID', 'Product Group/Brand', 'Product Name', 'Variant Name', 'SKU', 'System Quantity', 'Physical Count', 'Note'])
    worksheet.getRow(1).font = { bold: true }
    rows.forEach(row => worksheet.addRow([row.variantId, row.groupName, row.productName, row.variantName, skuForRow(row), row.systemQuantity, parseCount(row.physicalCount) ?? '', row.note]))
    worksheet.columns = [{ width: 38 }, { width: 24 }, { width: 30 }, { width: 28 }, { width: 22 }, { width: 16 }, { width: 16 }, { width: 34 }]
    worksheet.getColumn(6).numFmt = '#,##0'
    worksheet.getColumn(7).numFmt = '#,##0'
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
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await file.arrayBuffer())
    const sheet = workbook.worksheets[0]
    const headers = (sheet.getRow(1).values as any[]).map(value => String(value || '').trim())
    const headerIndex = (name: string) => headers.findIndex(value => value.toLowerCase() === name.toLowerCase())
    const variantIdIndex = headerIndex('Variant ID')
    const skuIndex = headerIndex('SKU')
    const physicalIndex = headerIndex('Physical Count')
    const noteIndex = headerIndex('Note')
    const byVariant = new Map(rows.map(row => [row.variantId, row]))
    const skuCounts = rows.reduce((map, row) => {
      const sku = skuForRow(row)
      map.set(sku, (map.get(sku) || 0) + 1)
      return map
    }, new Map<string, number>())
    const duplicateSkus = new Set(Array.from(skuCounts.entries()).filter(([, count]) => count > 1).map(([sku]) => sku))
    const bySku = new Map(rows.filter(row => !duplicateSkus.has(skuForRow(row))).map(row => [skuForRow(row), row]))
    const seenKeys = new Set<string>()
    const patches = new Map<string, { physicalCount: string; note: string }>()
    let updated = 0
    let unchanged = 0
    const results: ImportSummary['rows'] = []

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const values = row.values as any[]
      const variantId = variantIdIndex >= 0 ? String(values[variantIdIndex] || '').trim() : ''
      const sku = skuIndex >= 0 ? String(values[skuIndex] || '').trim() : ''
      const key = variantId || sku
      const matched = (variantId && byVariant.get(variantId)) || (sku && bySku.get(sku))
      const physicalRaw = physicalIndex >= 0 ? values[physicalIndex] : ''
      const note = noteIndex >= 0 ? String(values[noteIndex] || '').trim() : ''

      if (!key || !matched) {
        results.push({ row: rowNumber, sku: sku || variantId || '-', status: 'Failed', message: duplicateSkus.has(sku) ? 'SKU matches more than one active variant. Use Variant ID.' : 'Unknown SKU or variant ID.' })
        return
      }
      if (seenKeys.has(key)) {
        results.push({ row: rowNumber, sku: sku || variantId, status: 'Failed', message: 'Duplicate SKU or variant ID in import file.' })
        return
      }
      seenKeys.add(key)

      const physicalString = physicalRaw === null || physicalRaw === undefined ? '' : String(physicalRaw).trim()
      if (physicalString === '') {
        patches.set(matched.variantId, { physicalCount: '', note })
        unchanged += 1
        results.push({ row: rowNumber, sku: sku || variantId, status: 'Unchanged', message: 'Blank physical count kept as not counted.' })
        return
      }
      if (!/^\d+$/.test(physicalString)) {
        results.push({ row: rowNumber, sku: sku || variantId, status: 'Failed', message: 'Physical Count must be zero or a positive integer.' })
        return
      }
      const changed = matched.physicalCount !== physicalString || matched.note !== note
      patches.set(matched.variantId, { physicalCount: physicalString, note })
      if (changed) updated += 1
      else unchanged += 1
      results.push({ row: rowNumber, sku: sku || variantId, status: changed ? 'Updated' : 'Unchanged', message: changed ? 'Loaded into draft.' : 'No change from current draft.' })
    })

    setRows(prev => prev.map(row => patches.has(row.variantId) ? { ...row, ...patches.get(row.variantId)! } : row))
    const failed = results.filter(row => row.status === 'Failed').length
    setImportSummary({ updated, unchanged, failed, rows: results })
    toast({ title: 'Import complete', description: `${updated} updated, ${unchanged} unchanged, ${failed} failed.` })
  }

  const postCount = async () => {
    if (!canPost || currentStatus === 'posted') return
    setPosting(true)
    try {
      const sessionId = currentSessionId || await saveDraft()
      if (!sessionId) throw new Error('Save the draft before posting.')
      const postedRows = rows.filter(row => {
        const variance = varianceForRow(row)
        return variance !== null && variance !== 0
      })
      const { data: sessionData, error: sessionError } = await supabase.from('stock_count_sessions' as any).select('id, status').eq('id', sessionId).single()
      if (sessionError) throw sessionError
      if ((sessionData as any).status === 'posted') throw new Error('This count session has already been posted.')

      for (const row of postedRows) {
        const variance = varianceForRow(row)!
        const { error } = await supabase.rpc('record_stock_movement', {
          p_movement_type: 'adjustment',
          p_variant_id: row.variantId,
          p_organization_id: selectedWarehouse,
          p_quantity_change: variance,
          p_unit_cost: row.unitCost,
          p_manufacturer_id: null,
          p_warehouse_location: row.warehouseLocation,
          p_reason: `Stock count ${countTypeOptions.find(option => option.value === countType)?.label || ''}`,
          p_notes: row.note || `Stock count ${referenceName || countDate}: system ${row.systemQuantity}, physical ${row.physicalCount}`,
          p_reference_type: 'adjustment',
          p_reference_id: sessionId,
          p_reference_no: referenceName || `Stock Count ${countDate}`,
          p_company_id: userProfile?.organizations?.id || userProfile?.organization_id || null,
          p_created_by: userProfile?.id || null,
          p_evidence_urls: null,
        } as any)
        if (error) throw error
      }

      await supabase.from('stock_count_sessions' as any).update({
        status: 'posted',
        posted_by: userProfile?.id || null,
        posted_at: new Date().toISOString(),
        total_variants_counted: pageSummary.counted,
        variance_items: pageSummary.varianceItems,
        net_quantity_adjustment: pageSummary.netAdjustment,
        estimated_adjustment_value: pageSummary.estimatedValue,
        updated_by: userProfile?.id || null,
        updated_at: new Date().toISOString(),
      }).eq('id', sessionId).eq('status', 'draft')

      const reasonResult = await supabase.from('stock_adjustment_reasons').select('id').eq('is_active', true).ilike('reason_name', '%count%').limit(1).maybeSingle()
      const { data: adjustment } = await supabase.from('stock_adjustments').insert({
        organization_id: selectedWarehouse,
        reason_id: reasonResult.data?.id || null,
        notes: notes || `Posted stock count session ${sessionId}`,
        status: 'completed',
        created_by: userProfile?.id || null,
        manufacturer_status: 'draft',
      }).select('id').single()

      if (adjustment && postedRows.length > 0) {
        await supabase.from('stock_adjustment_items').insert(postedRows.map(row => {
          const physical = parseCount(row.physicalCount)!
          return {
            adjustment_id: adjustment.id,
            variant_id: row.variantId,
            system_quantity: row.systemQuantity,
            physical_quantity: physical,
            adjustment_quantity: physical - row.systemQuantity,
            unit_cost: row.unitCost,
          }
        }))
      }

      setCurrentStatus('posted')
      setConfirmPostOpen(false)
      toast({ title: 'Stock count posted', description: `${postedRows.length} variance movement(s) recorded.` })
      await loadCountRows(selectedWarehouse)
      await loadDrafts(selectedWarehouse)
    } catch (error: any) {
      toast({ title: 'Post failed', description: error.message, variant: 'destructive' })
    } finally {
      setPosting(false)
    }
  }

  const summaryCards = [
    { label: 'Total Items', value: formatNumber(pageSummary.totalItems), sub: `Across ${Math.max(groups.length - 1, 0)} groups`, icon: Boxes, color: 'text-violet-600 bg-violet-50' },
    { label: 'Counted', value: formatNumber(pageSummary.counted), sub: `${pageSummary.totalItems ? Math.round((pageSummary.counted / pageSummary.totalItems) * 100) : 0}% of total`, icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
    { label: 'Not Counted', value: formatNumber(pageSummary.notCounted), sub: `${pageSummary.totalItems ? Math.round((pageSummary.notCounted / pageSummary.totalItems) * 100) : 0}% remaining`, icon: CalendarDays, color: 'text-amber-600 bg-amber-50' },
    { label: 'Variance Items', value: formatNumber(pageSummary.varianceItems), sub: 'Items with variance', icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    { label: 'Net Adjustment', value: `${pageSummary.netAdjustment > 0 ? '+' : ''}${formatNumber(pageSummary.netAdjustment)}`, sub: 'Total units', icon: RotateCcw, color: 'text-blue-600 bg-blue-50' },
    { label: 'Estimated Value', value: formatMoney(pageSummary.estimatedValue), sub: 'Based on variance', icon: FileSpreadsheet, color: 'text-purple-600 bg-purple-50' },
  ]

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
          <Button variant="outline" onClick={downloadExcel} disabled={!rows.length}><Download className="mr-2 h-4 w-4" /> Download Excel Template</Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="mr-2 h-4 w-4" /> Import Updated Excel</Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={event => {
            const file = event.target.files?.[0]
            if (file) importExcel(file)
            event.target.value = ''
          }} />
          <Button variant="outline" onClick={saveDraft} disabled={!canSave || saving}><Save className="mr-2 h-4 w-4" /> {saving ? 'Saving...' : 'Save Draft'}</Button>
          <Button onClick={() => setConfirmPostOpen(true)} disabled={!canPost || currentStatus === 'posted'} className="bg-orange-600 hover:bg-orange-700">Review & Post Count <ArrowRight className="ml-2 h-4 w-4" /></Button>
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
                <div><div className="flex items-center gap-2"><h2 className="text-xl font-bold text-slate-950">{selectedGroup?.name || 'All'}</h2><Badge variant="outline">{groupSummary.variants} variants</Badge></div><p className="text-sm text-slate-500">{selectedGroup?.description || (selectedGroupId === ALL_GROUP_ID ? 'All active inventory variants in the selected warehouse.' : 'Active variants in this product group.')}</p></div>
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
                  <TableHeader><TableRow><TableHead className="min-w-[280px]">Variant / SKU</TableHead><TableHead className="text-right">System Quantity</TableHead><TableHead className="min-w-[170px]">Physical Count</TableHead><TableHead className="text-right">Variance</TableHead>{visibleColumns.unitCost && <TableHead className="text-right">Unit Cost</TableHead>}{visibleColumns.adjustmentValue && <TableHead className="text-right">Adjustment Value</TableHead>}{visibleColumns.note && <TableHead className="min-w-[240px]">Note / Status</TableHead>}</TableRow></TableHeader>
                  <TableBody>
                    {loadingRows && <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-500">Loading inventory variants...</TableCell></TableRow>}
                    {!loadingRows && selectedGroupRows.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-500">No variants match this view.</TableCell></TableRow>}
                    {selectedGroupRows.map(row => {
                      const variance = varianceForRow(row)
                      const adjustmentValue = adjustmentValueForRow(row)
                      return (
                        <TableRow key={row.variantId}>
                          <TableCell><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded bg-slate-100">{row.imageUrl ? <img src={getStorageUrl(row.imageUrl) || row.imageUrl} alt="" className="h-full w-full object-cover" /> : <Package className="h-5 w-5 text-slate-400" />}</div><div><p className="font-semibold text-slate-950">{row.variantName}</p><p className="text-xs text-slate-500">{row.productName} · {skuForRow(row)}</p></div></div></TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatNumber(row.systemQuantity)}</TableCell>
                          <TableCell><Input data-count-input={row.variantId} inputMode="numeric" min="0" value={row.physicalCount} disabled={currentStatus === 'posted'} onChange={event => handlePhysicalCountChange(row.variantId, event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); focusNextCountInput(row.variantId) } }} placeholder="Blank" className="w-36 font-semibold tabular-nums" /></TableCell>
                          <TableCell className={`text-right font-bold tabular-nums ${variance === null || variance === 0 ? 'text-slate-600' : variance > 0 ? 'text-green-600' : 'text-red-600'}`}>{variance === null ? 'Not counted' : `${variance > 0 ? '+' : ''}${formatNumber(variance)}`}</TableCell>
                          {visibleColumns.unitCost && <TableCell className="text-right tabular-nums">{formatMoney(row.unitCost)}</TableCell>}
                          {visibleColumns.adjustmentValue && <TableCell className={`text-right font-semibold tabular-nums ${!adjustmentValue ? 'text-slate-600' : adjustmentValue > 0 ? 'text-green-600' : 'text-red-600'}`}>{adjustmentValue === null ? '-' : formatMoney(adjustmentValue)}</TableCell>}
                          {visibleColumns.note && <TableCell><div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-slate-400" /><Input value={row.note} disabled={currentStatus === 'posted'} onChange={event => updateRow(row.variantId, { note: event.target.value })} placeholder={variance === null ? 'Not counted' : variance === 0 ? 'Matched' : 'Add note'} /></div></TableCell>}
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

      <Dialog open={confirmPostOpen} onOpenChange={setConfirmPostOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review & Post Count</DialogTitle><DialogDescription>Posting creates inventory movement records and updates stock balances. This cannot be posted twice.</DialogDescription></DialogHeader>
          <div className="grid gap-3 py-2 text-sm"><div className="flex justify-between"><span>Total variants counted</span><strong>{formatNumber(pageSummary.counted)}</strong></div><div className="flex justify-between"><span>Variance items</span><strong>{formatNumber(pageSummary.varianceItems)}</strong></div><div className="flex justify-between"><span>Net quantity adjustment</span><strong>{pageSummary.netAdjustment > 0 ? '+' : ''}{formatNumber(pageSummary.netAdjustment)}</strong></div><div className="flex justify-between"><span>Estimated adjustment value</span><strong>{formatMoney(pageSummary.estimatedValue)}</strong></div></div>
          <Textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Posting note..." />
          <DialogFooter><Button variant="outline" onClick={() => setConfirmPostOpen(false)}>Cancel</Button><Button onClick={postCount} disabled={posting || !canPost} className="bg-orange-600 hover:bg-orange-700">{posting ? 'Posting...' : 'Confirm Post Count'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="border-amber-200 bg-amber-50"><CardContent className="flex items-center gap-3 p-3 text-sm text-amber-900"><Warehouse className="h-4 w-4" /><span>Tip: select a group, update all variant physical counts directly or by Excel import, then save draft before posting.</span></CardContent></Card>
    </div>
  )
}
