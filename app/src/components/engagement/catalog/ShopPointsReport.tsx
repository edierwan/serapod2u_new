import { useState, useEffect, useMemo, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Search, Download, Store, TrendingUp, Users, Trophy,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUpDown, X, Phone, Mail, Loader2,
} from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatNumber } from "./catalog-utils"

interface ShopSummary {
  shop_id: string
  shop_name: string
  branch_name: string | null
  contact_name: string | null
  contact_phone: string | null
  state: string | null
  total_consumers: number
  total_points_balance: number
  total_collected_system: number
  total_collected_manual: number
  total_migration_points: number
  total_redeemed: number
  total_transactions: number
  last_activity: string | null
}

interface Totals {
  total_shops: number
  shops_with_consumers: number
  grand_total_balance: number
  grand_total_consumers: number
  grand_total_redeemed: number
}

type SortKey = keyof ShopSummary

interface ShopConsumer {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  role_code: string
  created_at: string
  current_balance: number
}

export function ShopPointsReport() {
  const [data, setData] = useState<ShopSummary[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("total_points_balance")
  const [sortAsc, setSortAsc] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)

  // Consumer detail dialog state
  const [selectedShop, setSelectedShop] = useState<ShopSummary | null>(null)
  const [consumers, setConsumers] = useState<ShopConsumer[]>([])
  const [consumersLoading, setConsumersLoading] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/admin/shop-points-report')
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        setData(json.data || [])
        setTotals(json.totals || null)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const openConsumerDetail = useCallback(async (shop: ShopSummary) => {
    setSelectedShop(shop)
    setConsumersLoading(true)
    setConsumers([])
    try {
      const res = await fetch(`/api/admin/shop-consumers?shop_id=${encodeURIComponent(shop.shop_id)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setConsumers(json.data || [])
    } catch {
      setConsumers([])
    } finally {
      setConsumersLoading(false)
    }
  }, [])

  const filtered = useMemo(() => {
    let result = data
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      result = result.filter(s =>
        s.shop_name.toLowerCase().includes(q) ||
        (s.branch_name && s.branch_name.toLowerCase().includes(q)) ||
        (s.contact_name && s.contact_name.toLowerCase().includes(q)) ||
        (s.state && s.state.toLowerCase().includes(q))
      )
    }
    result = [...result].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return result
  }, [data, searchTerm, sortKey, sortAsc])

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage))
  const startIdx = (currentPage - 1) * itemsPerPage
  const paginated = filtered.slice(startIdx, startIdx + itemsPerPage)

  useEffect(() => { setCurrentPage(1) }, [searchTerm])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) { setSortAsc(!sortAsc) } else { setSortKey(key); setSortAsc(false) }
  }

  const exportCSV = () => {
    const headers = ['Shop Name', 'Branch', 'State', 'Contact', 'Phone', 'Consumers', 'Total Balance', 'System Collected', 'Manual Collected', 'Migration', 'Redeemed', 'Transactions', 'Last Activity']
    const rows = filtered.map(s => [
      s.shop_name, s.branch_name || '', s.state || '', s.contact_name || '', s.contact_phone || '',
      s.total_consumers, s.total_points_balance, s.total_collected_system, s.total_collected_manual,
      s.total_migration_points, s.total_redeemed, s.total_transactions, s.last_activity || '',
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shop-points-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      className="px-3 py-3 text-xs font-semibold uppercase text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap"
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      </span>
    </th>
  )

  return (
    <div className="space-y-4">
      {/* Summary Banner */}
      <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-emerald-100 p-2.5">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-emerald-900">Shop Points Report</h3>
              <p className="mt-0.5 text-sm text-emerald-700/80">
                Overview of point collection performance by shop. Shows which shops have the highest point balances and how many linked shop accounts they have.
              </p>
              {totals && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="bg-emerald-100/80 text-emerald-700 text-[11px]">
                    <Store className="h-3 w-3 mr-1" /> {totals.total_shops} Shops
                  </Badge>
                  <Badge variant="secondary" className="bg-emerald-100/80 text-emerald-700 text-[11px]">
                    <Users className="h-3 w-3 mr-1" /> {formatNumber(totals.grand_total_consumers)} Linked Users
                  </Badge>
                  <Badge variant="secondary" className="bg-emerald-100/80 text-emerald-700 text-[11px]">
                    <Trophy className="h-3 w-3 mr-1" /> {formatNumber(totals.grand_total_balance)} Total Points
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Store className="h-4 w-4" /> Shop Collection Ranking
              </CardTitle>
              <CardDescription className="mt-0.5">
                {filtered.length} shop{filtered.length !== 1 ? 's' : ''} · sorted by {sortKey.replace(/_/g, ' ')}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search shop..."
                  className="pl-8 h-9 w-[200px] text-sm"
                />
              </div>
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCSV}>
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export CSV</span>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
            </div>
          ) : error ? (
            <div className="text-center py-16 text-red-600">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Store className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">No shops found</h3>
              <p className="text-sm text-muted-foreground mt-1">No shop organizations or no linked shop users yet.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <th className="px-3 py-3 text-xs font-semibold uppercase text-muted-foreground w-[40px] text-center">#</th>
                      <SortHeader label="Shop" field="shop_name" />
                      <SortHeader label="State" field="state" />
                      <SortHeader label="Linked Users" field="total_consumers" />
                      <SortHeader label="Total Balance" field="total_points_balance" />
                      <SortHeader label="System" field="total_collected_system" />
                      <SortHeader label="Manual" field="total_collected_manual" />
                      <SortHeader label="Migration" field="total_migration_points" />
                      <SortHeader label="Redeemed" field="total_redeemed" />
                      <SortHeader label="Transactions" field="total_transactions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {paginated.map((shop, idx) => (
                      <tr key={shop.shop_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">{startIdx + idx + 1}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-sm">{shop.shop_name}</div>
                          {shop.branch_name && <div className="text-xs text-muted-foreground">{shop.branch_name}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-sm">{shop.state || '—'}</td>
                        <td className="px-3 py-2.5 text-sm">
                          {shop.total_consumers > 0 ? (
                            <button
                              className="font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                              onClick={() => openConsumerDetail(shop)}
                            >
                              {formatNumber(shop.total_consumers)}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-sm font-semibold text-emerald-700">{formatNumber(shop.total_points_balance)}</td>
                        <td className="px-3 py-2.5 text-sm">{formatNumber(shop.total_collected_system)}</td>
                        <td className="px-3 py-2.5 text-sm">{formatNumber(shop.total_collected_manual)}</td>
                        <td className="px-3 py-2.5 text-sm">{formatNumber(shop.total_migration_points)}</td>
                        <td className="px-3 py-2.5 text-sm text-red-600">{formatNumber(shop.total_redeemed)}</td>
                        <td className="px-3 py-2.5 text-sm">{formatNumber(shop.total_transactions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {filtered.length > 0 && (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>{startIdx + 1}–{Math.min(startIdx + itemsPerPage, filtered.length)} of {filtered.length}</span>
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
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(1)} disabled={currentPage <= 1}>
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="px-2 text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(totalPages)} disabled={currentPage >= totalPages}>
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Shop Staff Detail Dialog */}
      {selectedShop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedShop(null)}>
          <div className="relative mx-4 w-full max-w-xl rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold">{selectedShop.shop_name}</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedShop.total_consumers} shop staff{selectedShop.total_consumers !== 1 ? 's' : ''}
                  {selectedShop.branch_name && ` · ${selectedShop.branch_name}`}
                  {selectedShop.state && ` · ${selectedShop.state}`}
                </p>
              </div>
              <button onClick={() => setSelectedShop(null)} className="rounded-full p-1.5 hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {consumersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : consumers.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No shop staff found for this shop.</div>
              ) : (
                <div className="space-y-3">
                  {consumers.map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/30">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{c.full_name}</div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                          {c.phone && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3" /> {c.phone}
                            </span>
                          )}
                          {c.email && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Mail className="h-3 w-3" /> {c.email}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Joined {new Date(c.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="ml-3 text-right shrink-0">
                        <div className="flex items-center gap-1 text-sm font-semibold text-emerald-700">
                          <Trophy className="h-3.5 w-3.5" />
                          {formatNumber(c.current_balance)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">points</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
