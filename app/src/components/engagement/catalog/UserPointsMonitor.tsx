import { useState, useMemo, useCallback } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Search, Users, Trophy, Edit, ArrowUpDown,
  Settings2, Download, FileSpreadsheet, FileText,
  Eye, EyeOff, RotateCcw,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from "lucide-react"
import { formatNumber, formatDateLabel } from "./catalog-utils"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PointMigration } from "./PointMigration"
import { MigrationHistory } from "./MigrationHistory"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// ── Types ────────────────────────────────────────────────────────

interface ConsumerUser {
  user_id: string
  consumer_name: string
  consumer_phone: string | null
  consumer_email: string | null
  consumer_location?: string | null
  consumer_reference?: string | null
  referral_name?: string | null
  referral_email?: string | null
  consumer_shop_name?: string | null
  current_balance: number
  total_collected_system: number
  total_collected_manual: number
  total_migration: number
  total_redundancy?: number
  total_other?: number
  other_types?: string
  total_redeemed: number
  transaction_count: number
  last_transaction_date: string | null
  last_migration_by_name?: string | null
}

interface UserPointsMonitorProps {
  users: ConsumerUser[]
  loading: boolean
  onAdjustPoints: (user: ConsumerUser) => void
  onRefresh?: () => void
}

// ── Column definition ────────────────────────────────────────────

interface ColumnDef {
  id: string
  label: string
  shortLabel?: string
  sortKey?: keyof ConsumerUser
  defaultVisible: boolean
  exportFn: (user: ConsumerUser) => string | number
  group: 'identity' | 'balance' | 'activity'
}

const ALL_COLUMNS: ColumnDef[] = [
  { id: 'row_num', label: '#', defaultVisible: true, group: 'identity', exportFn: () => '' },
  { id: 'consumer', label: 'Consumer', shortLabel: 'Name', defaultVisible: true, group: 'identity', sortKey: 'consumer_name', exportFn: (u) => u.consumer_name },
  { id: 'phone', label: 'Phone', defaultVisible: false, group: 'identity', sortKey: 'consumer_phone', exportFn: (u) => u.consumer_phone || '' },
  { id: 'email', label: 'Email', defaultVisible: false, group: 'identity', sortKey: 'consumer_email', exportFn: (u) => u.consumer_email || '' },
  { id: 'location', label: 'Location', defaultVisible: true, group: 'identity', sortKey: 'consumer_location', exportFn: (u) => u.consumer_location || '' },
  { id: 'reference', label: 'Reference', defaultVisible: true, group: 'identity', sortKey: 'consumer_reference', exportFn: (u) => [u.referral_name, u.consumer_reference, u.referral_email].filter(Boolean).join(' | ') },
  { id: 'shop_name', label: 'Shop Name', defaultVisible: true, group: 'identity', sortKey: 'consumer_shop_name', exportFn: (u) => u.consumer_shop_name || '' },
  { id: 'current_balance', label: 'Current Balance', shortLabel: 'Balance', defaultVisible: true, group: 'balance', sortKey: 'current_balance', exportFn: (u) => u.current_balance },
  { id: 'collected_system', label: 'Collected (System)', shortLabel: 'System', defaultVisible: true, group: 'balance', sortKey: 'total_collected_system', exportFn: (u) => u.total_collected_system },
  { id: 'collected_manual', label: 'Collected (Manual)', shortLabel: 'Manual', defaultVisible: true, group: 'balance', sortKey: 'total_collected_manual', exportFn: (u) => u.total_collected_manual },
  { id: 'migration', label: 'Migration Points', shortLabel: 'Migration', defaultVisible: true, group: 'balance', sortKey: 'total_migration', exportFn: (u) => u.total_migration },
  { id: 'other_points', label: 'Other Points', shortLabel: 'Other', defaultVisible: false, group: 'balance', sortKey: 'total_other', exportFn: (u) => u.total_other || 0 },
  { id: 'total_redeemed', label: 'Total Redeemed', shortLabel: 'Redeemed', defaultVisible: true, group: 'balance', sortKey: 'total_redeemed', exportFn: (u) => u.total_redeemed },
  { id: 'transactions', label: 'Transactions', shortLabel: 'Txn', defaultVisible: true, group: 'activity', sortKey: 'transaction_count', exportFn: (u) => u.transaction_count },
  { id: 'last_activity', label: 'Last Activity', defaultVisible: true, group: 'activity', sortKey: 'last_transaction_date', exportFn: (u) => u.last_transaction_date || '' },
  { id: 'actions', label: 'Actions', defaultVisible: true, group: 'activity', exportFn: () => '' },
]

const STORAGE_KEY = 'consumer-points-columns'
const GROUP_LABELS: Record<string, string> = { identity: 'Identity', balance: 'Points & Balance', activity: 'Activity' }

function loadSavedColumns(): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : null
  } catch { return null }
}

function saveColumns(ids: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)) } catch { /* noop */ }
}

// ── Component ────────────────────────────────────────────────────

export function UserPointsMonitor({ users, loading, onAdjustPoints, onRefresh }: UserPointsMonitorProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)
  const [sortConfig, setSortConfig] = useState<{ key: keyof ConsumerUser; direction: 'asc' | 'desc' } | null>(null)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  // Column visibility – persisted in localStorage
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(() => {
    const saved = loadSavedColumns()
    return saved || ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.id)
  })

  const visibleColumns = useMemo(
    () => ALL_COLUMNS.filter(c => visibleColumnIds.includes(c.id)),
    [visibleColumnIds]
  )

  const toggleColumn = (id: string) => {
    setVisibleColumnIds(prev => {
      const next = prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
      saveColumns(next)
      return next
    })
  }

  const resetColumns = () => {
    const defaults = ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.id)
    setVisibleColumnIds(defaults)
    saveColumns(defaults)
  }

  const visibleCount = visibleColumnIds.filter(id => id !== 'row_num' && id !== 'actions').length

  // ── Search & sort ──────────────────────────────────────────────

  const filteredUsers = useMemo(() => {
    const term = searchTerm.toLowerCase()
    if (!term) return users
    return users.filter(user =>
      user.consumer_name.toLowerCase().includes(term) ||
      (user.consumer_phone || "").toLowerCase().includes(term) ||
      (user.consumer_email || "").toLowerCase().includes(term) ||
      (user.consumer_reference || "").toLowerCase().includes(term) ||
      (user.consumer_shop_name || "").toLowerCase().includes(term)
    )
  }, [users, searchTerm])

  const handleSort = (key: keyof ConsumerUser) => {
    setSortConfig(prev => {
      if (prev?.key === key && prev.direction === 'asc') return { key, direction: 'desc' }
      return { key, direction: 'asc' }
    })
  }

  const sortedUsers = useMemo(() => {
    if (!sortConfig) return filteredUsers
    return [...filteredUsers].sort((a, b) => {
      const aVal = a[sortConfig.key]
      const bVal = b[sortConfig.key]
      if (aVal === bVal) return 0
      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1
      return sortConfig.direction === 'asc'
        ? (aVal < bVal ? -1 : 1)
        : (aVal > bVal ? -1 : 1)
    })
  }, [filteredUsers, sortConfig])

  // ── Pagination ─────────────────────────────────────────────────

  const totalPages = Math.ceil(sortedUsers.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedUsers = sortedUsers.slice(startIndex, startIndex + itemsPerPage)

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setCurrentPage(1)
  }

  // ── Export ─────────────────────────────────────────────────────

  const exportableColumns = useMemo(
    () => visibleColumns.filter(c => c.id !== 'row_num' && c.id !== 'actions'),
    [visibleColumns]
  )

  const buildExportData = useCallback(() => {
    const headers = exportableColumns.map(c => c.label)
    const rows = sortedUsers.map(user => exportableColumns.map(c => c.exportFn(user)))
    return { headers, rows }
  }, [exportableColumns, sortedUsers])

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const exportCSV = useCallback(() => {
    const { headers, rows } = buildExportData()
    const esc = (v: string | number) => {
      const s = String(v)
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    downloadBlob(blob, `consumer-points-${new Date().toISOString().slice(0, 10)}.csv`)
    setExportOpen(false)
  }, [buildExportData])

  const exportExcel = useCallback(() => {
    const { headers, rows } = buildExportData()
    const thCells = headers.map(h => `<th>${h}</th>`).join('')
    const bodyRows = rows.map(r => `<tr>${r.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><style>td,th{border:1px solid #ddd;padding:6px 10px;font-family:Segoe UI,sans-serif;font-size:11pt}th{background:#4F46E5;color:#fff;font-weight:600}tr:nth-child(even){background:#F9FAFB}</style></head><body><table><thead><tr>${thCells}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    downloadBlob(blob, `consumer-points-${new Date().toISOString().slice(0, 10)}.xls`)
    setExportOpen(false)
  }, [buildExportData])

  // ── Sortable header ────────────────────────────────────────────

  const SortableHeader = ({ label, sortKey }: { label: string; sortKey?: keyof ConsumerUser }) => {
    if (!sortKey) return <th className="px-3 py-3 text-xs font-semibold tracking-wide uppercase text-muted-foreground whitespace-nowrap">{label}</th>
    return (
      <th
        className="px-3 py-3 text-xs font-semibold tracking-wide uppercase text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground select-none transition-colors"
        onClick={() => handleSort(sortKey)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          <ArrowUpDown className={`h-3 w-3 shrink-0 ${sortConfig?.key === sortKey ? 'text-primary' : 'text-muted-foreground/50'}`} />
        </span>
      </th>
    )
  }

  // ── Render cell by column ID ───────────────────────────────────

  const renderCell = (colId: string, user: ConsumerUser, rowIndex: number) => {
    switch (colId) {
      case 'row_num':
        return <td key={colId} className="px-3 py-3 text-muted-foreground tabular-nums text-center w-[40px]">{startIndex + rowIndex + 1}</td>
      case 'consumer':
        return (
          <td key={colId} className="px-3 py-3">
            <Link href={`/dashboard?view=user-profile&id=${user.user_id}`} className="font-medium text-primary hover:underline">
              {user.consumer_name}
            </Link>
            {!visibleColumnIds.includes('phone') && (
              <div className="text-xs text-muted-foreground mt-0.5">{user.consumer_phone}</div>
            )}
            {!visibleColumnIds.includes('email') && (
              <div className="text-xs text-muted-foreground">{user.consumer_email}</div>
            )}
          </td>
        )
      case 'phone':
        return <td key={colId} className="px-3 py-3 text-sm text-muted-foreground">{user.consumer_phone || '-'}</td>
      case 'email':
        return <td key={colId} className="px-3 py-3 text-sm text-muted-foreground">{user.consumer_email || '-'}</td>
      case 'location':
        return <td key={colId} className="px-3 py-3 text-sm">{user.consumer_location || '-'}</td>
      case 'reference':
        return (
          <td key={colId} className="px-3 py-3">
            {user.consumer_reference ? (
              <>
                {user.referral_name && (
                  <div className="font-medium text-sm">{user.referral_name}</div>
                )}
                <div className="text-xs text-muted-foreground">{user.consumer_reference}</div>
                {user.referral_email && (
                  <div className="text-xs text-muted-foreground">{user.referral_email}</div>
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </td>
        )
      case 'shop_name':
        return (
          <td key={colId} className="px-3 py-3">
            <span className="text-sm">{user.consumer_shop_name || '-'}</span>
          </td>
        )
      case 'current_balance':
        return (
          <td key={colId} className="px-3 py-3">
            <span className="inline-flex items-center gap-1.5 font-bold text-primary tabular-nums">
              <Trophy className="h-3.5 w-3.5 shrink-0" />
              {formatNumber(user.current_balance)}
            </span>
          </td>
        )
      case 'collected_system':
        return (
          <td key={colId} className="px-3 py-3">
            <span className="text-green-600 tabular-nums">+{formatNumber(user.total_collected_system)}</span>
            <div className="text-[11px] text-muted-foreground">via QR scans</div>
          </td>
        )
      case 'collected_manual':
        return (
          <td key={colId} className="px-3 py-3">
            <span className="text-blue-600 tabular-nums">{user.total_collected_manual > 0 ? '+' : ''}{formatNumber(user.total_collected_manual)}</span>
            <div className="text-[11px] text-muted-foreground">by admin</div>
          </td>
        )
      case 'migration':
        return (
          <td key={colId} className="px-3 py-3">
            <span className="text-purple-600 font-medium tabular-nums">{user.total_migration > 0 ? '+' : ''}{formatNumber(user.total_migration)}</span>
            <div className="text-[11px] text-muted-foreground">{user.last_migration_by_name ? `by ${user.last_migration_by_name}` : 'via migration'}</div>
          </td>
        )
      case 'other_points':
        return (
          <td key={colId} className="px-3 py-3">
            <span className="text-gray-600 tabular-nums">{(user.total_other || 0) > 0 ? '+' : ''}{formatNumber(user.total_other || 0)}</span>
            <div className="text-[11px] text-muted-foreground">{user.other_types || '-'}</div>
          </td>
        )
      case 'total_redeemed':
        return (
          <td key={colId} className="px-3 py-3">
            <span className="text-orange-600 tabular-nums">-{formatNumber(user.total_redeemed)}</span>
          </td>
        )
      case 'transactions':
        return <td key={colId} className="px-3 py-3 tabular-nums">{formatNumber(user.transaction_count)}</td>
      case 'last_activity':
        return <td key={colId} className="px-3 py-3 text-muted-foreground text-sm">{user.last_transaction_date ? formatDateLabel(user.last_transaction_date) : 'Never'}</td>
      case 'actions':
        return (
          <td key={colId} className="px-3 py-3 text-right">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onAdjustPoints(user)}>
              <Edit className="h-3.5 w-3.5" /> Adjust
            </Button>
          </td>
        )
      default:
        return <td key={colId} className="px-3 py-3">-</td>
    }
  }

  // ── Page numbers helper ────────────────────────────────────────

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages: (number | string)[] = [1]
    const start = Math.max(2, currentPage - 1)
    const end = Math.min(totalPages - 1, currentPage + 1)
    if (start > 2) pages.push('e1')
    for (let i = start; i <= end; i++) pages.push(i)
    if (end < totalPages - 1) pages.push('e2')
    pages.push(totalPages)
    return pages
  }, [totalPages, currentPage])

  // ── JSX ────────────────────────────────────────────────────────

  return (
    <Tabs defaultValue="monitor" className="space-y-4">
      <TabsList>
        <TabsTrigger value="monitor">Monitor Points</TabsTrigger>
        <TabsTrigger value="migration">Point Migration</TabsTrigger>
        <TabsTrigger value="history">Migration History</TabsTrigger>
      </TabsList>

      <TabsContent value="monitor" className="space-y-4">
        {/* Info Banner */}
        <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-purple-100 p-2.5">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-purple-900">Consumer Point Collection System</h3>
                <p className="mt-0.5 text-sm text-purple-700/80">
                  Individual consumers collect points through the mobile app. All point collections are tracked here for monitoring and management.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {['Individual Accounts', 'Real-time Balance Updates', 'Transaction History'].map(tag => (
                    <Badge key={tag} variant="secondary" className="bg-purple-100/80 text-purple-700 text-[11px] font-medium">
                      ✓ {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Trophy className="h-4 w-4" /> Consumer Point Balances
                </CardTitle>
                <CardDescription className="mt-0.5">
                  {sortedUsers.length > 0
                    ? `${formatNumber(sortedUsers.length)} consumer${sortedUsers.length !== 1 ? 's' : ''} · ${visibleCount} columns visible`
                    : 'Monitor consumer point collections and balances.'}
                </CardDescription>
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Search..."
                    className="pl-8 h-9 w-[200px] sm:w-[240px] text-sm"
                  />
                </div>

                {/* Column picker */}
                <Popover open={columnsOpen} onOpenChange={setColumnsOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                      <Settings2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Columns</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[260px] p-0" sideOffset={8}>
                    <div className="p-3 border-b">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold">Show / Hide Columns</h4>
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={resetColumns}>
                          <RotateCcw className="h-3 w-3" /> Reset
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{visibleCount} of {ALL_COLUMNS.length - 2} columns selected</p>
                    </div>
                    <div className="max-h-[340px] overflow-y-auto p-2 space-y-3">
                      {Object.entries(GROUP_LABELS).map(([groupKey, groupLabel]) => {
                        const groupCols = ALL_COLUMNS.filter(c => c.group === groupKey && c.id !== 'row_num' && c.id !== 'actions')
                        if (groupCols.length === 0) return null
                        return (
                          <div key={groupKey}>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 px-1 mb-1.5">{groupLabel}</div>
                            {groupCols.map(col => (
                              <label
                                key={col.id}
                                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 cursor-pointer transition-colors"
                              >
                                <Checkbox
                                  checked={visibleColumnIds.includes(col.id)}
                                  onCheckedChange={() => toggleColumn(col.id)}
                                  className="h-4 w-4"
                                />
                                <span className="flex-1">{col.label}</span>
                                {visibleColumnIds.includes(col.id)
                                  ? <Eye className="h-3 w-3 text-primary/60" />
                                  : <EyeOff className="h-3 w-3 text-muted-foreground/40" />}
                              </label>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Export */}
                <Popover open={exportOpen} onOpenChange={setExportOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                      <Download className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Export</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[220px] p-2" sideOffset={8}>
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground px-2 pb-1">Export {formatNumber(sortedUsers.length)} rows · {exportableColumns.length} columns</p>
                      <button
                        onClick={exportCSV}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-muted/70 transition-colors text-left"
                      >
                        <FileText className="h-4 w-4 text-green-600" />
                        <div>
                          <div className="font-medium">CSV File</div>
                          <div className="text-[11px] text-muted-foreground">Comma-separated values</div>
                        </div>
                      </button>
                      <button
                        onClick={exportExcel}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-muted/70 transition-colors text-left"
                      >
                        <FileSpreadsheet className="h-4 w-4 text-blue-600" />
                        <div>
                          <div className="font-medium">Excel File</div>
                          <div className="text-[11px] text-muted-foreground">Open in Microsoft Excel</div>
                        </div>
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary"></div>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="rounded-full bg-muted p-4 mb-4">
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold">No consumers found</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {searchTerm ? "Try adjusting your search terms." : "No consumers have collected points yet."}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/40 border-b">
                      <tr>
                        {visibleColumns.map(col => (
                          col.id === 'row_num'
                            ? <th key={col.id} className="px-3 py-3 text-xs font-semibold uppercase text-muted-foreground w-[40px] text-center">#</th>
                            : col.id === 'actions'
                              ? <th key={col.id} className="px-3 py-3 text-xs font-semibold uppercase text-muted-foreground text-right whitespace-nowrap">Actions</th>
                              : <SortableHeader key={col.id} label={col.shortLabel || col.label} sortKey={col.sortKey} />
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {paginatedUsers.map((user, idx) => (
                        <tr key={user.user_id} className="hover:bg-muted/30 transition-colors">
                          {visibleColumns.map(col => renderCell(col.id, user, idx))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {sortedUsers.length > 0 && (
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span>
                        {startIndex + 1}–{Math.min(startIndex + itemsPerPage, sortedUsers.length)} of {formatNumber(sortedUsers.length)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">Rows</span>
                        <Select
                          value={itemsPerPage.toString()}
                          onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1) }}
                        >
                          <SelectTrigger className="h-7 w-[60px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent side="top">
                            {[10, 20, 50, 100].map(n => (
                              <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      {pageNumbers.map((p, i) =>
                        typeof p === 'string'
                          ? <span key={p} className="px-1 text-muted-foreground">…</span>
                          : <Button
                              key={p}
                              variant={currentPage === p ? 'default' : 'ghost'}
                              size="icon"
                              className={`h-8 w-8 text-xs ${currentPage === p ? '' : 'text-muted-foreground'}`}
                              onClick={() => setCurrentPage(p as number)}
                            >
                              {p}
                            </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="migration">
        <PointMigration onMigrationComplete={onRefresh} />
      </TabsContent>

      <TabsContent value="history">
        <MigrationHistory onRefresh={onRefresh} />
      </TabsContent>
    </Tabs>
  )
}
