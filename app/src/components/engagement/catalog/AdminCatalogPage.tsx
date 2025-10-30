"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Database } from "@/types/database"
import type { UserProfileWithRelations } from "@/lib/server/get-user-profile"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  CATEGORY_LABELS,
  EnrichedReward,
  RewardCategory,
  RewardStatus,
  enrichReward,
  formatDateLabel,
  formatNumber,
  getStatusBadgeClass
} from "./catalog-utils"
import {
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock,
  Edit,
  Filter,
  ListChecks,
  Loader2,
  Package,
  PlusCircle,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
  Save,
  Trophy
} from "lucide-react"

type RedeemItemRow = Database["public"]["Tables"]["redeem_items"]["Row"]
type PointsTransactionRow = Database["public"]["Tables"]["points_transactions"]["Row"]

interface ShopUser {
  consumer_phone: string
  consumer_email: string | null
  current_balance: number
  total_earned: number
  total_redeemed: number
  last_transaction_date: string | null
  transaction_count: number
}

interface AdminCatalogPageProps {
  userProfile: UserProfileWithRelations
}

const SORT_OPTIONS = [
  { value: "updated-desc", label: "Recently Updated" },
  { value: "points-asc", label: "Points: Low to High" },
  { value: "points-desc", label: "Points: High to Low" },
  { value: "stock-asc", label: "Stock: Low to High" }
]

function getTransactionDate(txn: PointsTransactionRow): Date {
  const raw = txn.transaction_date ?? txn.created_at
  return raw ? new Date(raw) : new Date()
}

function formatRelative(date: Date): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMinutes = Math.round(diffMs / (1000 * 60))

  if (Math.abs(diffMinutes) < 60) {
    if (diffMinutes === 0) return "just now"
    return diffMinutes > 0 ? `in ${diffMinutes}m` : `${Math.abs(diffMinutes)}m ago`
  }

  const diffHours = Math.round(diffMs / (1000 * 60 * 60))
  if (Math.abs(diffHours) < 24) {
    return diffHours > 0 ? `in ${diffHours}h` : `${Math.abs(diffHours)}h ago`
  }

  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (Math.abs(diffDays) < 14) {
    return diffDays > 0 ? `in ${diffDays}d` : `${Math.abs(diffDays)}d ago`
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date)
}

export function AdminCatalogPage({ userProfile }: AdminCatalogPageProps) {
  const [rewards, setRewards] = useState<RedeemItemRow[]>([])
  const [transactions, setTransactions] = useState<PointsTransactionRow[]>([])
  const [shopUsers, setShopUsers] = useState<ShopUser[]>([])
  const [loading, setLoading] = useState(true)
  const [usersLoading, setUsersLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<"all" | RewardStatus>("all")
  const [categoryFilter, setCategoryFilter] = useState<"all" | RewardCategory>("all")
  const [searchTerm, setSearchTerm] = useState("")
  const [userSearchTerm, setUserSearchTerm] = useState("")
  const [sortOption, setSortOption] = useState<string>("updated-desc")
  const [activeTab, setActiveTab] = useState<"rewards" | "users">("rewards")
  
  // Points adjustment modal
  const [showAdjustPointsModal, setShowAdjustPointsModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<ShopUser | null>(null)
  const [pointsAdjustment, setPointsAdjustment] = useState({
    amount: 0,
    type: 'add' as 'add' | 'subtract',
    description: ''
  })

  const companyId = userProfile.organizations.id

  useEffect(() => {
    let cancelled = false
    const supabaseClient = createClient()

    async function loadAdminData() {
      setLoading(true)
      setError(null)

      const [rewardsRes, transactionsRes] = await Promise.all([
        supabaseClient
          .from("redeem_items")
          .select("*")
          .eq("company_id", companyId)
          .order("updated_at", { ascending: false }),
        supabaseClient
          .from("points_transactions")
          .select("*")
          .eq("company_id", companyId)
          .eq("transaction_type", "redeem")
          .order("transaction_date", { ascending: false })
          .limit(250)
      ])

      if (cancelled) return

      if (rewardsRes.error) {
        console.error("Failed to fetch rewards", rewardsRes.error)
        setError("Unable to load reward catalog. Please try again later.")
      } else {
        setRewards(rewardsRes.data ?? [])
      }

      if (transactionsRes.error) {
        console.warn("Failed to fetch redemption transactions", transactionsRes.error)
      } else {
        setTransactions(transactionsRes.data ?? [])
      }

      setLoading(false)
    }

    loadAdminData()

    return () => {
      cancelled = true
    }
  }, [companyId])

  // Load shop users when switching to users tab
  useEffect(() => {
    if (activeTab === 'users' && shopUsers.length === 0) {
      loadShopUsers()
    }
  }, [activeTab])

  async function loadShopUsers() {
    setUsersLoading(true)
    const supabaseClient = createClient()

    try {
      // Get all transactions for this company
      const { data: allTransactions, error: txnError } = await supabaseClient
        .from("points_transactions")
        .select("*")
        .eq("company_id", companyId)
        .order("transaction_date", { ascending: false })

      if (txnError) {
        console.error("Failed to load user transactions", txnError)
        setUsersLoading(false)
        return
      }

      // Aggregate by consumer_phone
      const userMap = new Map<string, ShopUser>()
      
      allTransactions?.forEach((txn) => {
        const phone = txn.consumer_phone
        if (!userMap.has(phone)) {
          userMap.set(phone, {
            consumer_phone: phone,
            consumer_email: txn.consumer_email,
            current_balance: 0,
            total_earned: 0,
            total_redeemed: 0,
            last_transaction_date: null,
            transaction_count: 0
          })
        }

        const user = userMap.get(phone)!
        user.transaction_count += 1
        
        if (!user.last_transaction_date || txn.transaction_date > user.last_transaction_date) {
          user.last_transaction_date = txn.transaction_date
          user.current_balance = txn.balance_after
        }

        if (txn.transaction_type === 'earn' || txn.transaction_type === 'adjust') {
          if (txn.points_amount > 0) {
            user.total_earned += txn.points_amount
          }
        } else if (txn.transaction_type === 'redeem') {
          user.total_redeemed += Math.abs(txn.points_amount)
        }
      })

      setShopUsers(Array.from(userMap.values()))
    } catch (error) {
      console.error("Error loading shop users:", error)
    } finally {
      setUsersLoading(false)
    }
  }

  async function handleAdjustPoints() {
    if (!selectedUser || pointsAdjustment.amount === 0) {
      alert('Please enter a valid amount')
      return
    }

    const supabaseClient = createClient()
    const finalAmount = pointsAdjustment.type === 'subtract' 
      ? -Math.abs(pointsAdjustment.amount)
      : Math.abs(pointsAdjustment.amount)

    const newBalance = selectedUser.current_balance + finalAmount

    if (newBalance < 0) {
      alert('Cannot subtract more points than user has')
      return
    }

    try {
      const { error } = await supabaseClient
        .from('points_transactions')
        .insert({
          company_id: companyId,
          consumer_phone: selectedUser.consumer_phone,
          consumer_email: selectedUser.consumer_email,
          transaction_type: 'adjust',
          points_amount: finalAmount,
          balance_after: newBalance,
          description: pointsAdjustment.description || 'Admin adjustment - transfer from old system',
          transaction_date: new Date().toISOString()
        })

      if (error) {
        console.error('Error adjusting points:', error)
        alert('Failed to adjust points: ' + error.message)
        return
      }

      // Reload users
      await loadShopUsers()
      
      setShowAdjustPointsModal(false)
      setSelectedUser(null)
      setPointsAdjustment({ amount: 0, type: 'add', description: '' })
      
      alert(`Successfully ${pointsAdjustment.type === 'add' ? 'added' : 'subtracted'} ${Math.abs(finalAmount)} points`)
    } catch (error) {
      console.error('Error adjusting points:', error)
      alert('Failed to adjust points')
    }
  }

  const enrichedRewards = useMemo<EnrichedReward[]>(() => {
    const now = new Date()
    return rewards.map((reward) => enrichReward(reward, now))
  }, [rewards])

  const rewardMap = useMemo(() => {
    const map = new Map<string, EnrichedReward>()
    enrichedRewards.forEach((reward) => map.set(reward.id, reward))
    return map
  }, [enrichedRewards])

  const summaryStats = useMemo(() => {
    const now = new Date()
    const soonThreshold = new Date(now)
    soonThreshold.setDate(now.getDate() + 7)

    const totals = {
      total: enrichedRewards.length,
      available: 0,
      scheduled: 0,
      paused: 0,
      expired: 0,
      soldOut: 0,
      lowStock: 0,
      endingSoon: 0
    }

    enrichedRewards.forEach((reward) => {
      const statusKey = reward.status as keyof typeof totals
      if (statusKey in totals) {
        totals[statusKey] += 1
      }
      if (reward.lowStock) totals.lowStock += 1
      if (reward.valid_until && new Date(reward.valid_until) <= soonThreshold && reward.status === "available") {
        totals.endingSoon += 1
      }
    })

    return totals
  }, [enrichedRewards])

  const redemptionAnalytics = useMemo(() => {
    const now = new Date()
    const monthAgo = new Date(now)
    monthAgo.setDate(now.getDate() - 30)

    const recentTransactions = transactions.filter((txn) => getTransactionDate(txn) >= monthAgo)
    const totalRedemptions = recentTransactions.length
    const totalPointsRedeemed = recentTransactions.reduce((sum, txn) => sum + Math.abs(txn.points_amount), 0)

    const redemptionMap = new Map<
      string,
      {
        rewardId: string
        count: number
        points: number
        reward: EnrichedReward | undefined
      }
    >()

    transactions.forEach((txn) => {
      const rewardId = txn.redeem_item_id ?? "unknown"
      const entry = redemptionMap.get(rewardId) ?? {
        rewardId,
        count: 0,
        points: 0,
        reward: txn.redeem_item_id ? rewardMap.get(txn.redeem_item_id) : undefined
      }
      entry.count += 1
      entry.points += Math.abs(txn.points_amount)
      redemptionMap.set(rewardId, entry)
    })

    const topRewards = Array.from(redemptionMap.values())
      .filter((entry) => entry.reward)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    const maxCount = topRewards[0]?.count ?? 0

    const recentFeed = transactions.slice(0, 8).map((txn) => {
      const reward = txn.redeem_item_id ? rewardMap.get(txn.redeem_item_id) : undefined
      const occurredAt = getTransactionDate(txn)
      return {
        id: txn.id,
        rewardName: reward?.item_name ?? "Reward redemption",
        points: Math.abs(txn.points_amount),
        when: occurredAt,
        label: formatRelative(occurredAt),
        consumer: txn.consumer_phone
      }
    })

    return {
      totalRedemptions,
      totalPointsRedeemed,
      topRewards,
      maxCount,
      recentFeed
    }
  }, [rewardMap, transactions])

  const filteredRewards = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    let base = enrichedRewards

    if (statusFilter !== "all") {
      base = base.filter((reward) => reward.status === statusFilter)
    }

    if (categoryFilter !== "all") {
      base = base.filter((reward) => reward.category === categoryFilter)
    }

    if (term) {
      base = base.filter((reward) => {
        return (
          reward.item_name.toLowerCase().includes(term) ||
          (reward.item_description ?? "").toLowerCase().includes(term) ||
          (reward.item_code ?? "").toLowerCase().includes(term)
        )
      })
    }

    return [...base].sort((a, b) => {
      switch (sortOption) {
        case "points-asc":
          return a.points_required - b.points_required
        case "points-desc":
          return b.points_required - a.points_required
        case "stock-asc": {
          const stockA = typeof a.stock_quantity === "number" ? a.stock_quantity : Number.MAX_SAFE_INTEGER
          const stockB = typeof b.stock_quantity === "number" ? b.stock_quantity : Number.MAX_SAFE_INTEGER
          return stockA - stockB
        }
        case "updated-desc":
        default:
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      }
    })
  }, [categoryFilter, enrichedRewards, searchTerm, sortOption, statusFilter])

  const filteredUsers = useMemo(() => {
    const term = userSearchTerm.trim().toLowerCase()
    if (!term) return shopUsers

    return shopUsers.filter((user) => {
      return (
        user.consumer_phone.toLowerCase().includes(term) ||
        (user.consumer_email ?? '').toLowerCase().includes(term)
      )
    })
  }, [shopUsers, userSearchTerm])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Consumer Engagement • Admin View</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Point Catalog Management</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Monitor inventory, publish new rewards, and track redemption momentum across shops. Everything you need
            to keep the catalog fresh lives here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="gap-2">
            <Link href="/engagement/catalog">
              <Sparkles className="h-4 w-4" /> View shop experience
            </Link>
          </Button>
          <Button asChild className="gap-2">
            <Link href="/engagement/catalog/admin/new">
              <PlusCircle className="h-4 w-4" /> Create reward
            </Link>
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "rewards" | "users")} className="space-y-6">
        <TabsList>
          <TabsTrigger value="rewards" className="gap-2">
            <Package className="h-4 w-4" /> Manage Rewards
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" /> Manage Users
          </TabsTrigger>
        </TabsList>

        {/* MANAGE REWARDS TAB */}
        <TabsContent value="rewards" className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" /> Active rewards
            </CardTitle>
            <CardDescription>Currently visible to shops</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-emerald-600">{summaryStats.available}</p>
            <p className="mt-2 text-xs text-muted-foreground">{summaryStats.total} total rewards in catalog</p>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-blue-50/60 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-blue-700">
              <Clock className="h-5 w-5" /> Scheduled or ending soon
            </CardTitle>
            <CardDescription className="text-blue-700/80">Plan upcoming launches ahead of time</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-blue-700">{summaryStats.scheduled + summaryStats.endingSoon}</p>
            <p className="mt-2 text-xs text-blue-700/70">{summaryStats.scheduled} scheduled • {summaryStats.endingSoon} ending within 7 days</p>
          </CardContent>
        </Card>

        <Card className="border-amber-200 bg-amber-50/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-amber-700">
              <ShieldAlert className="h-5 w-5" /> Stock risks
            </CardTitle>
            <CardDescription className="text-amber-700/80">Keep popular rewards replenished</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{summaryStats.lowStock + summaryStats.soldOut}</p>
            <p className="mt-2 text-xs text-amber-800/70">{summaryStats.lowStock} running low • {summaryStats.soldOut} sold out</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-emerald-700">
              <TrendingUp className="h-5 w-5" /> Redemptions (30d)
            </CardTitle>
            <CardDescription className="text-emerald-700/80">Performance snapshot across shops</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-emerald-700">{formatNumber(redemptionAnalytics.totalRedemptions)}</p>
            <p className="mt-2 text-xs text-emerald-700/70">{formatNumber(redemptionAnalytics.totalPointsRedeemed)} points redeemed</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="gap-4 border-b border-border/50 pb-6">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ListChecks className="h-4 w-4" /> Reward inventory
                </CardTitle>
                <CardDescription>Filter by status, category, or search to focus your review.</CardDescription>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative sm:min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search rewards…"
                    className="pl-9"
                  />
                </div>
                <Select value={sortOption} onValueChange={setSortOption}>
                  <SelectTrigger className="sm:w-56">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={statusFilter === "all" ? "default" : "outline"}
                onClick={() => setStatusFilter("all")}
              >
                All statuses
              </Button>
              {(["available", "scheduled", "paused", "expired", "soldOut"] as RewardStatus[]).map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={statusFilter === status ? "default" : "outline"}
                  onClick={() => setStatusFilter(status)}
                  className="capitalize"
                >
                  {status === "soldOut" ? "Sold out" : status}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={categoryFilter === "all" ? "default" : "outline"}
                onClick={() => setCategoryFilter("all")}
              >
                All categories
              </Button>
              {(Object.keys(CATEGORY_LABELS) as RewardCategory[]).map((category) => (
                <Button
                  key={category}
                  size="sm"
                  variant={categoryFilter === category ? "default" : "outline"}
                  onClick={() => setCategoryFilter(category)}
                >
                  {CATEGORY_LABELS[category]}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading rewards…
              </div>
            ) : error ? (
              <div className="py-12 text-center text-sm text-destructive">{error}</div>
            ) : filteredRewards.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No rewards match the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Reward</th>
                      <th className="px-4 py-3">Points</th>
                      <th className="px-4 py-3">Stock</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Schedule</th>
                      <th className="px-4 py-3">Verification</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredRewards.map((reward) => (
                      <tr key={reward.id} className="hover:bg-muted/40">
                        <td className="px-4 py-4">
                          <div className="font-medium text-foreground">{reward.item_name}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className="border-border/70 bg-background">
                              {CATEGORY_LABELS[reward.category]}
                            </Badge>
                            {reward.lowStock && (
                              <Badge className="bg-amber-500 text-white">Low stock</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 font-semibold text-blue-600">{formatNumber(reward.points_required)}</td>
                        <td className="px-4 py-4 text-sm">
                          {typeof reward.stock_quantity === "number" ? (
                            <span className={reward.stock_quantity <= 0 ? "text-destructive" : undefined}>
                              {reward.stock_quantity} units
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Unlimited</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <Badge className={getStatusBadgeClass(reward.status)}>{reward.status}</Badge>
                        </td>
                        <td className="px-4 py-4 text-xs text-muted-foreground">
                          <div>Start: {reward.valid_from ? formatDateLabel(reward.valid_from) : "Now"}</div>
                          <div>End: {reward.valid_until ? formatDateLabel(reward.valid_until) : "Open"}</div>
                        </td>
                        <td className="px-4 py-4 text-xs text-muted-foreground">
                          {reward.requiresVerification ? "Manual check" : "Auto approve"}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex gap-2">
                            <Button asChild size="sm" variant="outline" className="gap-1">
                              <Link href={`/engagement/catalog/admin/edit/${reward.id}`}>
                                <Edit className="h-4 w-4" /> Edit
                              </Link>
                            </Button>
                            <Button asChild size="sm" variant="outline" className="gap-1">
                              <Link href={`/engagement/catalog/admin?focus=${reward.id}`}>
                                <Filter className="h-4 w-4" /> Focus
                              </Link>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="h-4 w-4" /> Top redeemed rewards
              </CardTitle>
              <CardDescription>Based on redemption counts across all shops.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {redemptionAnalytics.topRewards.length === 0 ? (
                <div className="text-sm text-muted-foreground">No redemption activity captured yet.</div>
              ) : (
                redemptionAnalytics.topRewards.map((entry) => (
                  <div key={entry.rewardId} className="space-y-2">
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span>{entry.reward?.item_name}</span>
                      <span className="text-muted-foreground">{entry.count} redemptions</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600"
                        style={{ width: `${redemptionAnalytics.maxCount ? (entry.count / redemptionAnalytics.maxCount) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Package className="h-4 w-4" /> Latest redemptions
              </CardTitle>
              <CardDescription>Live feed of the most recent redemption approvals.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {redemptionAnalytics.recentFeed.length === 0 ? (
                <div className="text-sm text-muted-foreground">No redemptions yet.</div>
              ) : (
                redemptionAnalytics.recentFeed.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border/60 bg-muted/30 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <div className="font-medium text-foreground">{item.rewardName}</div>
                      <span className="text-xs text-muted-foreground">{item.label}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{item.consumer || "Unknown consumer"}</span>
                      <span className="font-semibold text-amber-600">-{formatNumber(item.points)} pts</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-dashed border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg text-primary">
                <ChevronRight className="h-4 w-4" /> Next recommended action
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-primary">
              <p>
                {summaryStats.lowStock > 0
                  ? `Replenish inventory for ${summaryStats.lowStock} low-stock reward${summaryStats.lowStock === 1 ? "" : "s"} to keep shops engaged.`
                  : "All rewards look healthy right now—consider launching a limited-time reward to boost engagement."}
              </p>
              <Button asChild size="sm" variant="outline" className="gap-2 border-primary text-primary hover:bg-primary/10">
                <Link href="/engagement/catalog/admin/new">
                  <Sparkles className="h-4 w-4" /> Launch limited reward
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>

        {/* MANAGE USERS TAB */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Users className="h-4 w-4" /> Shop Users & Points
                  </CardTitle>
                  <CardDescription>Manage point balances for shop users. Transfer points from old system.</CardDescription>
                </div>
                <div className="relative sm:min-w-[280px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={userSearchTerm}
                    onChange={(e) => setUserSearchTerm(e.target.value)}
                    placeholder="Search by phone or email..."
                    className="pl-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading shop users…
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  {shopUsers.length === 0 
                    ? "No shop users with points activity yet."
                    : "No users match your search."}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Consumer</th>
                        <th className="px-4 py-3">Current Balance</th>
                        <th className="px-4 py-3">Total Earned</th>
                        <th className="px-4 py-3">Total Redeemed</th>
                        <th className="px-4 py-3">Transactions</th>
                        <th className="px-4 py-3">Last Activity</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {filteredUsers.map((user) => (
                        <tr key={user.consumer_phone} className="hover:bg-muted/40">
                          <td className="px-4 py-4">
                            <div className="font-medium text-foreground">{user.consumer_phone}</div>
                            {user.consumer_email && (
                              <div className="text-xs text-muted-foreground">{user.consumer_email}</div>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <Trophy className="h-4 w-4 text-blue-500" />
                              <span className="text-lg font-semibold text-blue-600">
                                {formatNumber(user.current_balance)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-emerald-600">
                            +{formatNumber(user.total_earned)}
                          </td>
                          <td className="px-4 py-4 text-amber-600">
                            -{formatNumber(user.total_redeemed)}
                          </td>
                          <td className="px-4 py-4 text-muted-foreground">
                            {user.transaction_count}
                          </td>
                          <td className="px-4 py-4 text-xs text-muted-foreground">
                            {user.last_transaction_date 
                              ? formatRelative(new Date(user.last_transaction_date))
                              : 'Never'}
                          </td>
                          <td className="px-4 py-4">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => {
                                setSelectedUser(user)
                                setShowAdjustPointsModal(true)
                              }}
                            >
                              <Edit className="h-4 w-4" /> Adjust Points
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ADJUST POINTS MODAL */}
      <Dialog open={showAdjustPointsModal} onOpenChange={setShowAdjustPointsModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Points Balance</DialogTitle>
            <DialogDescription>
              Modify point balance for {selectedUser?.consumer_phone}. Current balance: {formatNumber(selectedUser?.current_balance ?? 0)} points
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Adjustment Type</Label>
              <Select 
                value={pointsAdjustment.type} 
                onValueChange={(value) => setPointsAdjustment(prev => ({ ...prev, type: value as 'add' | 'subtract' }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Add Points</SelectItem>
                  <SelectItem value="subtract">Subtract Points</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                min="0"
                value={pointsAdjustment.amount || ''}
                onChange={(e) => setPointsAdjustment(prev => ({ ...prev, amount: parseInt(e.target.value) || 0 }))}
                placeholder="e.g., 100"
              />
            </div>

            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Input
                value={pointsAdjustment.description}
                onChange={(e) => setPointsAdjustment(prev => ({ ...prev, description: e.target.value }))}
                placeholder="e.g., Transfer from old system"
              />
            </div>

            {pointsAdjustment.amount > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
                <p className="font-medium text-blue-900">
                  New Balance: {formatNumber(
                    (selectedUser?.current_balance ?? 0) + 
                    (pointsAdjustment.type === 'add' ? pointsAdjustment.amount : -pointsAdjustment.amount)
                  )} points
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowAdjustPointsModal(false)
              setSelectedUser(null)
              setPointsAdjustment({ amount: 0, type: 'add', description: '' })
            }}>
              Cancel
            </Button>
            <Button onClick={handleAdjustPoints} disabled={pointsAdjustment.amount === 0}>
              <Save className="h-4 w-4 mr-2" />
              {pointsAdjustment.type === 'add' ? 'Add' : 'Subtract'} Points
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
