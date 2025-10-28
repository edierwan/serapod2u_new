"use client"

import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Database } from "@/types/database"
import type { UserProfileWithRelations } from "@/lib/server/get-user-profile"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
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
  DialogTitle
} from "@/components/ui/dialog"
import {
  CATEGORY_LABELS,
  EnrichedReward,
  RewardCategory,
  addDays,
  enrichReward,
  formatDateLabel,
  formatNumber,
  getStatusBadgeClass
} from "./catalog-utils"
import {
  Sparkles,
  LayoutGrid,
  Filter,
  CalendarClock,
  Trophy,
  Gift,
  AlertTriangle,
  Loader2,
  Search,
  ShieldCheck,
  Clock,
  History,
  TrendingUp,
  TrendingDown
} from "lucide-react"

type RedeemItemRow = Database["public"]["Tables"]["redeem_items"]["Row"]
type PointsTransactionRow = Database["public"]["Tables"]["points_transactions"]["Row"]
type PointsRuleRow = Database["public"]["Tables"]["points_rules"]["Row"]

interface ShopCatalogPageProps {
  userProfile: UserProfileWithRelations
}

const SORT_OPTIONS = [
  { value: "points-asc", label: "Points: Low to High" },
  { value: "points-desc", label: "Points: High to Low" },
  { value: "newest", label: "Recently Added" },
  { value: "ending-soon", label: "Ending Soon" }
]

function formatRelative(date: Date): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return "Today"
  const absDays = Math.abs(diffDays)
  if (diffDays > 0) {
    return absDays === 1 ? "Tomorrow" : `In ${absDays} days`
  }
  return absDays === 1 ? "Yesterday" : `${absDays} days ago`
}

function getTransactionDate(txn: PointsTransactionRow): Date {
  const raw = txn.transaction_date ?? txn.created_at
  return raw ? new Date(raw) : new Date()
}

export function ShopCatalogPage({ userProfile }: ShopCatalogPageProps) {
  const [rewards, setRewards] = useState<RedeemItemRow[]>([])
  const [transactions, setTransactions] = useState<PointsTransactionRow[]>([])
  const [activeRule, setActiveRule] = useState<PointsRuleRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<RewardCategory | "all">("all")
  const [selectedSort, setSelectedSort] = useState<string>("points-asc")
  const [onlyAvailable, setOnlyAvailable] = useState(true)
  const [selectedRewardId, setSelectedRewardId] = useState<string | null>(null)

  const companyId = userProfile.organizations.id

  useEffect(() => {
    let cancelled = false
    const supabaseClient = createClient()

    async function loadData() {
      setLoading(true)
      setError(null)

      const now = new Date().toISOString()

      const [rewardRes, transactionRes, ruleRes] = await Promise.all([
        supabaseClient
          .from("redeem_items")
          .select("*")
          .eq("company_id", companyId)
          .order("points_required", { ascending: true }),
        supabaseClient
          .from("points_transactions")
          .select("*")
          .eq("company_id", companyId)
          .order("transaction_date", { ascending: false }),
        supabaseClient
          .from("points_rules")
          .select("*")
          .eq("org_id", companyId)
          .eq("is_active", true)
          .lte("effective_from", now)
          .order("effective_from", { ascending: false })
          .limit(1)
          .maybeSingle()
      ])

      if (cancelled) return

      if (rewardRes.error) {
        console.error("Failed to load rewards", rewardRes.error)
        setError("Unable to load rewards right now. Please try again shortly.")
      } else {
        setRewards(rewardRes.data ?? [])
      }

      if (transactionRes.error) {
        console.error("Failed to load points transactions", transactionRes.error)
      } else {
        setTransactions(transactionRes.data ?? [])
      }

      if (ruleRes.error) {
        console.warn("No active points rule found", ruleRes.error)
        setActiveRule(null)
      } else {
        setActiveRule(ruleRes.data ?? null)
      }

      setLoading(false)
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [companyId])

  const enrichedRewards = useMemo<EnrichedReward[]>(() => {
    const now = new Date()
    return rewards.map((reward) => enrichReward(reward, now))
  }, [rewards])

  const rewardMap = useMemo(() => {
    const map = new Map<string, EnrichedReward>()
    enrichedRewards.forEach((reward) => map.set(reward.id, reward))
    return map
  }, [enrichedRewards])

  const filteredRewards = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const base = enrichedRewards.filter((reward) => {
      if (onlyAvailable && !reward.isAvailable) return false
      if (selectedCategory !== "all" && reward.category !== selectedCategory) return false
      if (!term) return true
      return (
        reward.item_name.toLowerCase().includes(term) ||
        (reward.item_description ?? "").toLowerCase().includes(term) ||
        (reward.item_code ?? "").toLowerCase().includes(term)
      )
    })

    return base.sort((a, b) => {
      switch (selectedSort) {
        case "points-desc":
          return b.points_required - a.points_required
        case "newest":
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        case "ending-soon":
          return (a.endsInDays ?? Number.MAX_SAFE_INTEGER) - (b.endsInDays ?? Number.MAX_SAFE_INTEGER)
        case "points-asc":
        default:
          return a.points_required - b.points_required
      }
    })
  }, [enrichedRewards, onlyAvailable, searchTerm, selectedCategory, selectedSort])

  const latestBalance = transactions[0]?.balance_after ?? 0
  const latestTransactionDate = transactions[0]?.transaction_date ?? transactions[0]?.created_at ?? null
  const latestTransactionLabel = latestTransactionDate ? formatRelative(new Date(latestTransactionDate)) : "just now"

  const pointsEarnedThisMonth = useMemo(() => {
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    return transactions
      .filter((txn) => txn.transaction_type === "earn")
      .filter((txn) => {
        const date = getTransactionDate(txn)
        return date.getMonth() === currentMonth && date.getFullYear() === currentYear
      })
      .reduce((total, txn) => total + Math.max(txn.points_amount, 0), 0)
  }, [transactions])

  const pointsRedeemedThisMonth = useMemo(() => {
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    return transactions
      .filter((txn) => txn.transaction_type === "redeem")
      .filter((txn) => {
        const date = getTransactionDate(txn)
        return date.getMonth() === currentMonth && date.getFullYear() === currentYear
      })
      .reduce((total, txn) => total + Math.abs(txn.points_amount), 0)
  }, [transactions])

  const expiringPointsInfo = useMemo(() => {
    if (!activeRule?.expires_after_days || activeRule.expires_after_days <= 0) {
      return { total: 0, earliest: null as Date | null }
    }

    const now = new Date()
    const threshold = addDays(now, 30)
    let total = 0
    let earliest: Date | null = null

    transactions
      .filter((txn) => txn.transaction_type === "earn")
      .forEach((txn) => {
        const baseDate = getTransactionDate(txn)
        const expiryDate = addDays(baseDate, activeRule.expires_after_days ?? 0)
        if (expiryDate <= threshold && expiryDate > now) {
          total += Math.max(txn.points_amount, 0)
          if (!earliest || expiryDate < earliest) {
            earliest = expiryDate
          }
        }
      })

    return { total, earliest }
  }, [activeRule, transactions])

  const redemptionHistory = useMemo(() => {
    return transactions
      .filter((txn) => txn.transaction_type === "redeem")
      .slice(0, 50)
      .map((txn) => {
        const reward = txn.redeem_item_id ? rewardMap.get(txn.redeem_item_id) : undefined
        const dateValue = txn.transaction_date ?? txn.created_at
        return {
          id: txn.id,
          rewardName: reward?.item_name ?? "Reward redemption",
          points: Math.abs(txn.points_amount),
          consumer: txn.consumer_phone,
          date: dateValue,
          balanceAfter: txn.balance_after,
          status: reward?.status ?? "available"
        }
      })
  }, [rewardMap, transactions])

  const selectedReward = selectedRewardId ? rewardMap.get(selectedRewardId) ?? null : null

  const categoriesWithCounts = useMemo(() => {
    const counts = new Map<RewardCategory, number>()
    enrichedRewards.forEach((reward) => {
      counts.set(reward.category, (counts.get(reward.category) ?? 0) + 1)
    })
    return counts
  }, [enrichedRewards])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Consumer Engagement • Shop View</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">My Points & Rewards Catalog</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Explore rewards curated for your shop. Track your point growth, keep an eye on expiring points,
            and redeem premium items with confidence.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setOnlyAvailable(true)}>
            <Sparkles className="h-4 w-4" /> Highlight Available
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setSelectedRewardId(null)}>
            <LayoutGrid className="h-4 w-4" /> Reset View
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="relative overflow-hidden border border-slate-200 shadow-sm">
          <div className="absolute -right-4 -top-6 h-24 w-24 rounded-full bg-blue-100" />
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <Trophy className="h-5 w-5 text-blue-500" /> Current Balance
            </CardTitle>
            <CardDescription>Total points ready to spend</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-blue-600">{formatNumber(latestBalance)}</p>
            <p className="mt-2 text-xs text-muted-foreground">Updated {latestTransactionLabel}</p>
          </CardContent>
        </Card>

        <Card className="border border-emerald-200 bg-emerald-50/60 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-medium text-emerald-700">
              <TrendingUp className="h-5 w-5" /> Earned This Month
            </CardTitle>
            <CardDescription className="text-emerald-700/80">Great job keeping consumers engaged</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-emerald-700">{formatNumber(pointsEarnedThisMonth)}</p>
            <p className="mt-2 text-xs text-emerald-800/70">Redeemed {formatNumber(pointsRedeemedThisMonth)} points this month</p>
          </CardContent>
        </Card>

        <Card className="border border-amber-200 bg-amber-50/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-medium text-amber-700">
              <AlertTriangle className="h-5 w-5" /> Points Expiring Soon
            </CardTitle>
            <CardDescription className="text-amber-700/80">
              {activeRule?.expires_after_days
                ? `Points expire ${activeRule.expires_after_days} days after earning`
                : "No expiry policy found for your org"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{formatNumber(expiringPointsInfo.total)}</p>
            <p className="mt-2 text-xs text-amber-800/70">
              {expiringPointsInfo.earliest
                ? `Earliest expiry ${formatRelative(expiringPointsInfo.earliest)} (${formatDateLabel(expiringPointsInfo.earliest.toISOString())})`
                : "No points expiring in the next 30 days"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="catalog" className="space-y-6">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="catalog" className="gap-2">
            <Gift className="h-4 w-4" /> Rewards Catalog
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" /> Redemption History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Filter className="h-4 w-4" /> Tailor the catalog
                </CardTitle>
                <CardDescription>Search, filter, and sort rewards to suit your shop&apos;s priorities.</CardDescription>
              </div>
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <div className="relative md:w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search rewards or categories"
                    className="pl-9"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </div>
                <Select value={selectedSort} onValueChange={setSelectedSort}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Sort by" />
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
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={selectedCategory === "all" ? "default" : "outline"}
                  onClick={() => setSelectedCategory("all")}
                >
                  All ({enrichedRewards.length})
                </Button>
                {(Object.keys(CATEGORY_LABELS) as RewardCategory[]).map((category) => (
                  <Button
                    key={category}
                    size="sm"
                    variant={selectedCategory === category ? "default" : "outline"}
                    onClick={() => setSelectedCategory(category)}
                  >
                    {CATEGORY_LABELS[category]}
                    <span className="ml-2 rounded-full bg-muted px-2 text-xs text-muted-foreground">
                      {categoriesWithCounts.get(category) ?? 0}
                    </span>
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-muted-foreground/20 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                <div className="flex-1">
                  Show only rewards that can be redeemed immediately
                </div>
                <Switch checked={onlyAvailable} onCheckedChange={setOnlyAvailable} />
              </div>
            </CardContent>
          </Card>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p>Loading your catalog…</p>
              </div>
            </div>
          ) : error ? (
            <Card className="border border-destructive/40 bg-destructive/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Something went wrong
                </CardTitle>
                <CardDescription className="text-destructive/80">{error}</CardDescription>
              </CardHeader>
            </Card>
          ) : filteredRewards.length === 0 ? (
            <Card className="py-16 text-center">
              <CardContent className="flex flex-col items-center gap-3">
                <Gift className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No rewards found with your current filters.</p>
                <Button variant="outline" size="sm" onClick={() => setSelectedCategory("all")}>
                  Reset filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredRewards.map((reward) => (
                <Card
                  key={reward.id}
                  className="flex h-full flex-col overflow-hidden border border-slate-200 shadow-sm transition hover:shadow-md"
                >
                  <div className="relative h-48 w-full bg-muted">
                    {reward.item_image_url ? (
                      <Image
                        src={reward.item_image_url}
                        alt={reward.item_name}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                        <Gift className="h-12 w-12 text-slate-400" />
                      </div>
                    )}
                    <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                      <Badge className="bg-white/90 text-xs text-slate-700 shadow-sm">
                        {CATEGORY_LABELS[reward.category]}
                      </Badge>
                      <Badge className={getStatusBadgeClass(reward.status)}>{reward.status}</Badge>
                    </div>
                    {reward.lowStock && (
                      <Badge className="absolute bottom-3 left-3 bg-amber-500 text-white shadow-md">
                        Low stock
                      </Badge>
                    )}
                    {reward.requiresVerification && (
                      <Badge className="absolute bottom-3 right-3 bg-slate-900 text-white shadow-md">
                        Requires verification
                      </Badge>
                    )}
                  </div>

                  <CardContent className="flex flex-1 flex-col gap-4 p-4">
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold leading-tight">{reward.item_name}</h3>
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {reward.item_description ?? "No description provided."}
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-blue-600">
                        <Trophy className="h-5 w-5" />
                        <span className="text-2xl font-semibold">{formatNumber(reward.points_required)}</span>
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">Points</span>
                      </div>
                      {typeof reward.stock_quantity === "number" ? (
                        <Badge variant="outline" className="border-slate-200 text-xs">
                          {reward.stock_quantity > 0 ? `${reward.stock_quantity} left` : "Out of stock"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-slate-200 text-xs">
                          Unlimited
                        </Badge>
                      )}
                    </div>

                    <div className="border-t border-dashed border-muted-foreground/20 pt-3 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <CalendarClock className="h-3.5 w-3.5" />
                          {reward.valid_from ? `Starts ${formatDateLabel(reward.valid_from)}` : "Available immediately"}
                        </span>
                        <span>{reward.valid_until ? `Ends ${formatDateLabel(reward.valid_until)}` : "No end date"}</span>
                      </div>
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-muted-foreground">
                        {latestBalance >= reward.points_required ? (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <TrendingUp className="h-4 w-4" /> Eligible to redeem
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600">
                            <TrendingDown className="h-4 w-4" /> Need {formatNumber(reward.points_required - latestBalance)} pts
                          </span>
                        )}
                      </div>
                      <Button size="sm" onClick={() => setSelectedRewardId(reward.id)}>
                        View details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-4 w-4" /> Recent redemptions
              </CardTitle>
              <CardDescription>
                A live view of your last {redemptionHistory.length} redemption activities.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {redemptionHistory.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                  <Gift className="h-10 w-10" />
                  <p className="text-sm">No redemptions recorded yet. Redeem a reward to see it here.</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Reward</th>
                        <th className="px-4 py-3">Points used</th>
                        <th className="px-4 py-3">Consumer</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Balance after</th>
                      </tr>
                    </thead>
                    <tbody>
                      {redemptionHistory.map((entry) => (
                        <tr key={entry.id} className="border-t border-slate-100">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-800">{entry.rewardName}</div>
                            <div className="text-xs text-muted-foreground capitalize">{entry.status}</div>
                          </td>
                          <td className="px-4 py-3 font-semibold text-amber-600">{formatNumber(entry.points)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{entry.consumer}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateLabel(entry.date)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{formatNumber(entry.balanceAfter)}</td>
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

      <Dialog open={Boolean(selectedReward)} onOpenChange={(open) => !open && setSelectedRewardId(null)}>
        <DialogContent className="max-w-3xl overflow-hidden p-0">
          {selectedReward && (
            <div className="grid gap-0 md:grid-cols-[2fr_3fr]">
              <div className="relative h-64 w-full bg-muted md:h-full">
                {selectedReward.item_image_url ? (
                  <Image
                    src={selectedReward.item_image_url}
                    alt={selectedReward.item_name}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                    <Gift className="h-12 w-12 text-slate-400" />
                  </div>
                )}
                <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                  <Badge className="bg-white/90 text-xs text-slate-700 shadow-sm">
                    {CATEGORY_LABELS[selectedReward.category]}
                  </Badge>
                  <Badge className={getStatusBadgeClass(selectedReward.status)}>{selectedReward.status}</Badge>
                </div>
              </div>

              <div className="space-y-4 p-6">
                <DialogHeader className="space-y-2">
                  <DialogTitle className="text-2xl font-semibold leading-tight">
                    {selectedReward.item_name}
                  </DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground">
                    {selectedReward.item_description ?? "No description provided."}
                  </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Points required</p>
                    <p className="mt-1 text-xl font-semibold text-blue-600">
                      {formatNumber(selectedReward.points_required)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Stock</p>
                    <p className="mt-1 text-base font-medium text-slate-700">
                      {typeof selectedReward.stock_quantity === "number"
                        ? selectedReward.stock_quantity > 0
                          ? `${selectedReward.stock_quantity} units`
                          : "Out of stock"
                        : "Unlimited"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Available from</p>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {selectedReward.valid_from ? formatDateLabel(selectedReward.valid_from) : "Immediately"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Ends</p>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {selectedReward.valid_until ? formatDateLabel(selectedReward.valid_until) : "No end date"}
                    </p>
                  </div>
                </div>

                {selectedReward.terms_and_conditions && (
                  <div className="space-y-2 rounded-lg border border-dashed border-muted-foreground/20 bg-muted/30 p-4">
                    <h4 className="text-sm font-semibold text-slate-700">Terms & conditions</h4>
                    <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                      {selectedReward.terms_and_conditions}
                    </p>
                  </div>
                )}

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <ShieldCheck className="h-4 w-4" /> Redemption checklist
                  </h4>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <li>• Staff verification {selectedReward.requiresVerification ? "required" : "not required"}.</li>
                    <li>• {selectedReward.max_redemptions_per_consumer ? `Limited to ${selectedReward.max_redemptions_per_consumer} redemption(s) per consumer.` : "No per-consumer limit set."}</li>
                    <li>• Present consumer QR history to confirm eligibility.</li>
                  </ul>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <Button variant="outline" onClick={() => setSelectedRewardId(null)}>Close</Button>
                  <Button disabled={latestBalance < selectedReward.points_required} className="gap-2">
                    <Gift className="h-4 w-4" />
                    {latestBalance >= selectedReward.points_required ? "Proceed to redeem" : "Need more points"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
