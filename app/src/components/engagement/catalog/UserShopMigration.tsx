import { useState, useEffect, useMemo, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Link2,
  Unlink,
  Zap,
  Store,
  Users,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"

// ── Types ────────────────────────────────────────────────────────

interface MigrationUser {
  user_id: string
  full_name: string | null
  phone: string | null
  email: string | null
  current_shop_name: string | null
  current_org_id: string | null
  current_org_name: string | null
  matched_org_id: string | null
  matched_org_name: string | null
  matched_org_branch: string | null
  match_status: 'linked' | 'auto_matchable' | 'unmatched' | 'no_shop'
  created_at: string
  is_active: boolean
}

interface Summary {
  total: number
  linked: number
  auto_matchable: number
  unmatched: number
  no_shop: number
}

interface ShopOrg {
  id: string
  org_name: string
}

interface UserShopMigrationProps {
  onMigrationComplete?: () => void
}

const STATUS_CONFIG = {
  linked: { label: 'Linked', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  auto_matchable: { label: 'Auto-matchable', color: 'bg-blue-100 text-blue-700', icon: Zap },
  unmatched: { label: 'Unmatched', color: 'bg-amber-100 text-amber-700', icon: AlertCircle },
  no_shop: { label: 'No Shop', color: 'bg-gray-100 text-gray-500', icon: Unlink },
}

export function UserShopMigration({ onMigrationComplete }: UserShopMigrationProps) {
  const [users, setUsers] = useState<MigrationUser[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [shops, setShops] = useState<ShopOrg[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Filters
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  // Manual assign state
  const [assigningUserId, setAssigningUserId] = useState<string | null>(null)
  const [selectedOrgId, setSelectedOrgId] = useState<string>("")

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)

  // ── Data fetching ──────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/user-shop-migration')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setUsers(json.data || [])
      setSummary(json.summary || null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadShops = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('organizations')
      .select('id, org_name')
      .eq('org_type_code', 'SHOP')
      .order('org_name')
    setShops(data || [])
  }, [])

  useEffect(() => {
    loadData()
    loadShops()
  }, [loadData, loadShops])

  // ── Filtering & pagination ─────────────────────────────────────

  const filteredUsers = useMemo(() => {
    let result = users
    if (statusFilter !== 'all') {
      result = result.filter(u => u.match_status === statusFilter)
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      result = result.filter(u =>
        (u.full_name && u.full_name.toLowerCase().includes(q)) ||
        (u.phone && u.phone.includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.current_shop_name && u.current_shop_name.toLowerCase().includes(q)) ||
        (u.current_org_name && u.current_org_name.toLowerCase().includes(q)) ||
        (u.matched_org_name && u.matched_org_name.toLowerCase().includes(q))
      )
    }
    return result
  }, [users, statusFilter, searchTerm])

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / itemsPerPage))
  const startIdx = (currentPage - 1) * itemsPerPage
  const paginatedUsers = filteredUsers.slice(startIdx, startIdx + itemsPerPage)

  useEffect(() => { setCurrentPage(1) }, [searchTerm, statusFilter])

  // ── Actions ────────────────────────────────────────────────────

  const handleAutoMatch = async () => {
    setActionLoading(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await fetch('/api/admin/user-shop-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto_match' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Auto-match failed')
      setSuccessMsg(json.message)
      await loadData()
      onMigrationComplete?.()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleAssign = async (userId: string, orgId: string) => {
    setActionLoading(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await fetch('/api/admin/user-shop-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assign', assignments: [{ user_id: userId, org_id: orgId }] }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Assign failed')
      setSuccessMsg(`Assigned successfully`)
      setAssigningUserId(null)
      setSelectedOrgId("")
      await loadData()
      onMigrationComplete?.()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleUnlink = async (userId: string) => {
    setActionLoading(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await fetch('/api/admin/user-shop-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink', user_ids: [userId] }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Unlink failed')
      setSuccessMsg(json.message)
      await loadData()
      onMigrationComplete?.()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  // ── Export CSV ────────────────────────────────────────────────

  const exportCSV = () => {
    const headers = ['Name', 'Phone', 'Email', 'Shop Name (free text)', 'Match Status', 'Current Org', 'Matched Org', 'Created At']
    const rows = filteredUsers.map(u => [
      u.full_name || '',
      u.phone || '',
      u.email || '',
      u.current_shop_name || '',
      u.match_status,
      u.current_org_name || '',
      u.matched_org_name || '',
      u.created_at || '',
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `user-shop-migration-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── JSX ────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-100 p-2.5">
              <Store className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-blue-900">User ↔ Shop Migration</h3>
              <p className="mt-0.5 text-sm text-blue-700/80">
                Link consumers to their shop organizations. Consumers with a free-text shop name can be auto-matched to registered organizations, or manually assigned.
              </p>
              {summary && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="bg-green-100/80 text-green-700 text-[11px]">
                    ✓ {summary.linked} Linked
                  </Badge>
                  <Badge variant="secondary" className="bg-blue-100/80 text-blue-700 text-[11px]">
                    ⚡ {summary.auto_matchable} Auto-matchable
                  </Badge>
                  <Badge variant="secondary" className="bg-amber-100/80 text-amber-700 text-[11px]">
                    ⚠ {summary.unmatched} Unmatched
                  </Badge>
                  <Badge variant="secondary" className="bg-gray-100/80 text-gray-500 text-[11px]">
                    — {summary.no_shop} No Shop
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerts */}
      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-700">{error}</AlertDescription>
        </Alert>
      )}
      {successMsg && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-700">{successMsg}</AlertDescription>
        </Alert>
      )}

      {/* Main Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Link2 className="h-4 w-4" /> Consumer → Shop Assignments
              </CardTitle>
              <CardDescription className="mt-0.5">
                {filteredUsers.length} consumer{filteredUsers.length !== 1 ? 's' : ''} shown
              </CardDescription>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search name, phone, shop..."
                  className="pl-8 h-9 w-[220px] text-sm"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-[150px] text-sm">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="linked">✓ Linked</SelectItem>
                  <SelectItem value="auto_matchable">⚡ Auto-matchable</SelectItem>
                  <SelectItem value="unmatched">⚠ Unmatched</SelectItem>
                  <SelectItem value="no_shop">— No Shop</SelectItem>
                </SelectContent>
              </Select>

              {summary && summary.auto_matchable > 0 && (
                <Button
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={handleAutoMatch}
                  disabled={actionLoading}
                >
                  {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                  Auto-Match ({summary.auto_matchable})
                </Button>
              )}

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
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">No consumers found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {searchTerm || statusFilter !== 'all' ? 'Try adjusting filters.' : 'No consumer data available.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <th className="px-3 py-3 text-xs font-semibold uppercase text-muted-foreground w-[40px] text-center">#</th>
                      <th className="px-3 py-3 text-xs font-semibold uppercase text-muted-foreground">Consumer</th>
                      <th className="px-3 py-3 text-xs font-semibold uppercase text-muted-foreground">Shop Name (text)</th>
                      <th className="px-3 py-3 text-xs font-semibold uppercase text-muted-foreground">Status</th>
                      <th className="px-3 py-3 text-xs font-semibold uppercase text-muted-foreground">Matched / Linked Org</th>
                      <th className="px-3 py-3 text-xs font-semibold uppercase text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {paginatedUsers.map((user, idx) => {
                      const cfg = STATUS_CONFIG[user.match_status]
                      const StatusIcon = cfg.icon
                      const isAssigning = assigningUserId === user.user_id

                      return (
                        <tr key={user.user_id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">
                            {startIdx + idx + 1}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-sm">{user.full_name || '—'}</div>
                            <div className="text-xs text-muted-foreground">
                              {[user.phone, user.email].filter(Boolean).join(' · ')}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-sm">{user.current_shop_name || '—'}</td>
                          <td className="px-3 py-2.5">
                            <Badge variant="secondary" className={`${cfg.color} gap-1 text-[11px]`}>
                              <StatusIcon className="h-3 w-3" />
                              {cfg.label}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-sm">
                            {user.match_status === 'linked' && (
                              <span className="text-green-700 font-medium">{user.current_org_name}</span>
                            )}
                            {user.match_status === 'auto_matchable' && (
                              <span className="text-blue-700">{user.matched_org_name}{user.matched_org_branch && ` (${user.matched_org_branch})`}</span>
                            )}
                            {(user.match_status === 'unmatched' || user.match_status === 'no_shop') && (
                              isAssigning ? (
                                <div className="flex items-center gap-2">
                                  <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                                    <SelectTrigger className="h-8 w-[200px] text-xs">
                                      <SelectValue placeholder="Select shop..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {shops.map(s => (
                                        <SelectItem key={s.id} value={s.id}>
                                          {s.org_name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Button
                                    size="sm"
                                    className="h-8 text-xs"
                                    disabled={!selectedOrgId || actionLoading}
                                    onClick={() => handleAssign(user.user_id, selectedOrgId)}
                                  >
                                    {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 text-xs"
                                    onClick={() => { setAssigningUserId(null); setSelectedOrgId("") }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {user.match_status === 'linked' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => handleUnlink(user.user_id)}
                                disabled={actionLoading}
                              >
                                <Unlink className="h-3 w-3" /> Unlink
                              </Button>
                            )}
                            {(user.match_status === 'unmatched' || user.match_status === 'no_shop') && !isAssigning && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-xs"
                                onClick={() => { setAssigningUserId(user.user_id); setSelectedOrgId("") }}
                              >
                                <Link2 className="h-3 w-3" /> Assign
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {filteredUsers.length > 0 && (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>{startIdx + 1}–{Math.min(startIdx + itemsPerPage, filteredUsers.length)} of {filteredUsers.length}</span>
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
                    <span className="px-2 text-sm text-muted-foreground">
                      Page {currentPage} of {totalPages}
                    </span>
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
    </div>
  )
}
