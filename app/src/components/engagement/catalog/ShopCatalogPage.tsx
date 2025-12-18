"use client"

import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Database } from "@/types/database"
import type { UserProfileWithRelations } from "@/lib/server/get-user-profile"
import type { ShopPointsLedgerRow, ShopPointsBalanceRow } from "@/types/shop-points"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/use-toast"
import { getStorageUrl } from "@/lib/utils"
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
  TrendingDown,
  Settings
} from "lucide-react"
import Link from "next/link"

type RedeemItemRow = Database["public"]["Tables"]["redeem_items"]["Row"]
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

export function ShopCatalogPage({ userProfile }: ShopCatalogPageProps) {
  const { toast } = useToast()
  const [rewards, setRewards] = useState<RedeemItemRow[]>([])
  const [ledgerTransactions, setLedgerTransactions] = useState<ShopPointsLedgerRow[]>([])
  const [balance, setBalance] = useState<ShopPointsBalanceRow | null>(null)
  const [activeRule, setActiveRule] = useState<PointsRuleRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<RewardCategory | "all">("all")
  const [selectedSort, setSelectedSort] = useState<string>("points-asc")
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [selectedRewardId, setSelectedRewardId] = useState<string | null>(null)
  const [productSummary, setProductSummary] = useState<{product: string, variant: string, count: number, points: number, imageUrl?: string | null}[]>([])
  const [redeeming, setRedeeming] = useState(false)
  
  // Pagination states
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(12)
  const [visibleProductCount, setVisibleProductCount] = useState(5)

  const shopOrgId = userProfile.organization_id

  useEffect(() => {
    let cancelled = false
    const supabaseClient = createClient()

    async function loadData() {
      setLoading(true)
      setError(null)

      const now = new Date().toISOString()
      
      // First, get the shop's parent company ID
      const { data: shopOrg, error: shopOrgError } = await supabaseClient
        .from('organizations')
        .select('id, org_name, org_type_code, parent_org_id')
        .eq('id', shopOrgId)
        .single()

      if (shopOrgError || !shopOrg) {
        console.error('Failed to load shop organization:', shopOrgError)
        setError('Unable to load your organization details.')
        setLoading(false)
        return
      }

      // Use parent_org_id as company_id, or fall back to shop's own id if no parent
      const companyId = shopOrg.parent_org_id || shopOrg.id
      
      // Load rewards - try multiple strategies to find matching rewards
      // Strategy 1: Query with the calculated company_id
      let rewardRes = await supabaseClient
        .from("redeem_items")
        .select("*")
        .eq("company_id", companyId)
        .order("points_required", { ascending: true })

      // If no rewards found and we used parent_org_id, also try shop's own ID
      if ((!rewardRes.data || rewardRes.data.length === 0) && shopOrg.parent_org_id) {
        const fallbackRes = await supabaseClient
          .from("redeem_items")
          .select("*")
          .eq("company_id", shopOrg.id)
          .order("points_required", { ascending: true })
        
        if (fallbackRes.data && fallbackRes.data.length > 0) {
          rewardRes = fallbackRes
        }
      }

      // If still no rewards, query ALL rewards (fallback for misconfigured company_id)
      if (!rewardRes.data || rewardRes.data.length === 0) {
        const allRewardsRes = await supabaseClient
          .from("redeem_items")
          .select("*")
        
        if (allRewardsRes.data && allRewardsRes.data.length > 0) {
          rewardRes = allRewardsRes
        }
      }
      
      // Shop balance from view (using any to bypass type checking for views)
      const balanceRes = await (supabaseClient as any)
        .from("v_shop_points_balance")
        .select("*")
        .eq("shop_id", shopOrgId)
        .maybeSingle()
      
      // Ledger transactions from view (using any to bypass type checking)
      const ledgerRes = await (supabaseClient as any)
        .from("shop_points_ledger")
        .select("*")
        .eq("shop_id", shopOrgId)
        .order("occurred_at", { ascending: false })
        .limit(500)
      
      // Active points rule
      const ruleRes = await supabaseClient
        .from("points_rules")
        .select("*")
        .eq("org_id", companyId)
        .eq("is_active", true)
        .lte("effective_from", now)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cancelled) return

      if (rewardRes.error) {
        console.error("Failed to load rewards", rewardRes.error)
        setError("Unable to load rewards right now. Please try again shortly.")
      } else {
        setRewards(rewardRes.data ?? [])
      }

      if (balanceRes.error) {
        console.error("Failed to load balance", balanceRes.error)
      } else {
        setBalance(balanceRes.data as ShopPointsBalanceRow | null)
      }

      if (ledgerRes.error) {
        console.error("Failed to load ledger", ledgerRes.error)
      } else {
        
        if (ledgerRes.data && ledgerRes.data.length > 0) {
          // Enrich ledger data with images
          const enrichedLedger = await Promise.all(ledgerRes.data.map(async (entry: any) => {
            let imageUrl = null
            
            // Fetch variant image for QR scans
            if (entry.variant_id) {
              const { data: variantData } = await supabaseClient
                .from('product_variants')
                .select('image_url')
                .eq('id', entry.variant_id)
                .single()
              imageUrl = variantData?.image_url
            }
            
            // Fetch reward image for redemptions
            if (entry.redeem_item_id) {
              const { data: rewardData } = await supabaseClient
                .from('redeem_items')
                .select('item_image_url')
                .eq('id', entry.redeem_item_id)
                .single()
              imageUrl = rewardData?.item_image_url
            }
            
            return { ...entry, imageUrl }
          }))
          
          setLedgerTransactions(enrichedLedger as any)
          
          // Log first transaction for debugging
          console.log('📊 First ledger entry:', enrichedLedger[0])
          
          // Calculate product summary from scan transactions
          const productMap = new Map<string, {product: string, variant: string, count: number, points: number, imageUrl?: string | null}>()
          
          enrichedLedger.forEach((entry: any) => {
            if (entry.transaction_type === 'scan' && entry.product_name) {
              const productName = entry.product_name || 'Unknown Product'
              const variantName = entry.variant_name || 'Unknown Variant'
              const key = `${productName}|${variantName}`
              
              const existing = productMap.get(key)
              if (existing) {
                existing.count += 1
                existing.points += entry.points_change
              } else {
                productMap.set(key, {
                  product: productName,
                  variant: variantName,
                  count: 1,
                  points: entry.points_change,
                  imageUrl: entry.imageUrl
                })
              }
            }
          })
          
          const summary = Array.from(productMap.values()).sort((a, b) => b.count - a.count)
          console.log('📊 Product summary:', summary)
          setProductSummary(summary)
        } else {
          setLedgerTransactions([])
          setProductSummary([])
        }
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
  }, [shopOrgId, userProfile.organization_id])

  const handleRedeemReward = async (reward: EnrichedReward) => {
    if (!reward.isAvailable || currentBalance < reward.points_required || redeeming) {
      return
    }

    const confirmed = window.confirm(
      `Confirm Redemption\n\n` +
      `Reward: ${reward.item_name}\n` +
      `Points Required: ${reward.points_required}\n` +
      `Current Balance: ${currentBalance}\n` +
      `Balance After: ${currentBalance - reward.points_required}\n\n` +
      `Are you sure you want to redeem this reward?`
    )

    if (!confirmed) return

    setRedeeming(true)

    try {
      const supabase = createClient()
      
      // Get shop organization details to find company_id and contact info
      const { data: shopOrg } = await supabase
        .from('organizations')
        .select('id, parent_org_id, contact_phone, contact_email')
        .eq('id', shopOrgId)
        .single()

      // company_id should be the shop's ID, NOT the parent company ID
      // The ledger view uses company_id as shop_id
      const companyId = shopOrgId
      
      // Use shop org contact info or user profile info
      const consumerPhone = shopOrg?.contact_phone || userProfile.phone || 'SHOP-' + shopOrgId.slice(0, 8)
      const consumerEmail = shopOrg?.contact_email || userProfile.email || null

      console.log('Redemption data:', {
        company_id: companyId,
        consumer_phone: consumerPhone,
        consumer_email: consumerEmail,
        points_amount: -reward.points_required,
        balance_after: currentBalance - reward.points_required
      })

      // Record redemption in points_transactions table (feeds into shop_points_ledger view)
      const { data: txnData, error: txnError } = await supabase
        .from('points_transactions')
        .insert({
          company_id: companyId,
          consumer_phone: consumerPhone,
          consumer_email: consumerEmail,
          transaction_type: 'redeem',
          points_amount: -reward.points_required,
          balance_after: currentBalance - reward.points_required,
          redeem_item_id: reward.id,
          description: `Redeemed: ${reward.item_name}`,
          transaction_date: new Date().toISOString()
        })
        .select()

      console.log('Transaction result:', { data: txnData, error: txnError })

      if (txnError) {
        console.error('Redemption error details:', JSON.stringify(txnError, null, 2))
        toast({
          title: "Redemption Failed",
          description: txnError.message || txnError.hint || "Unable to process redemption. Please try again.",
          variant: "destructive"
        })
        return
      }

      // Update stock quantity if applicable
      if (typeof reward.stock_quantity === 'number' && reward.stock_quantity > 0) {
        const { error: stockError } = await supabase
          .from('redeem_items')
          .update({ stock_quantity: reward.stock_quantity - 1 })
          .eq('id', reward.id)

        if (stockError) {
          console.warn('Failed to update stock:', stockError)
        }
      }

      // Reload data to refresh balance and ledger
      const [balanceRes, ledgerRes, rewardRes] = await Promise.all([
        (supabase as any)
          .from('v_shop_points_balance')
          .select('*')
          .eq('shop_id', shopOrgId)
          .maybeSingle(),
        (supabase as any)
          .from('shop_points_ledger')
          .select('*')
          .eq('shop_id', shopOrgId)
          .order('occurred_at', { ascending: false })
          .limit(500),
        supabase
          .from('redeem_items')
          .select('*')
      ])

      if (!balanceRes.error) {
        setBalance(balanceRes.data as ShopPointsBalanceRow | null)
      }
      if (!ledgerRes.error) {
        setLedgerTransactions(ledgerRes.data as ShopPointsLedgerRow[])
      }
      if (!rewardRes.error && rewardRes.data) {
        setRewards(rewardRes.data)
      }

      toast({
        title: "Redemption Successful! 🎉",
        description: `You've redeemed ${reward.item_name} for ${reward.points_required} points. Your new balance is ${currentBalance - reward.points_required} points.`,
      })

      setSelectedRewardId(null)
    } catch (error: any) {
      console.error('Redemption error:', error)
      toast({
        title: "Redemption Failed",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive"
      })
    } finally {
      setRedeeming(false)
    }
  }

  const enrichedRewards = useMemo<EnrichedReward[]>(() => {
    const now = new Date()
    return rewards.map((reward) => enrichReward(reward, now))
  }, [rewards])

  const currentBalance = balance?.current_balance ?? 0
  const totalScans = balance?.scan_count ?? 0
  const totalRedemptions = balance?.redemption_count ?? 0

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
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        case "ending-soon":
          return (a.endsInDays ?? Number.MAX_SAFE_INTEGER) - (b.endsInDays ?? Number.MAX_SAFE_INTEGER)
        case "points-asc":
        default:
          return a.points_required - b.points_required
      }
    })
  }, [enrichedRewards, onlyAvailable, searchTerm, selectedCategory, selectedSort])

  const latestTransactionDate = ledgerTransactions[0]?.occurred_at ?? null
  const latestTransactionLabel = latestTransactionDate ? formatRelative(new Date(latestTransactionDate)) : "just now"

  const pointsEarnedThisMonth = useMemo(() => {
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    return ledgerTransactions
      .filter((txn) => txn.transaction_type === "scan" && txn.points_change > 0)
      .filter((txn) => {
        const date = new Date(txn.occurred_at)
        return date.getMonth() === currentMonth && date.getFullYear() === currentYear
      })
      .reduce((total, txn) => total + txn.points_change, 0)
  }, [ledgerTransactions])

  const pointsRedeemedThisMonth = useMemo(() => {
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    return ledgerTransactions
      .filter((txn) => txn.transaction_type === "redeem")
      .filter((txn) => {
        const date = new Date(txn.occurred_at)
        return date.getMonth() === currentMonth && date.getFullYear() === currentYear
      })
      .reduce((total, txn) => total + Math.abs(txn.points_change), 0)
  }, [ledgerTransactions])

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
            View your shop&apos;s point balance earned by scanning QR codes. Redeem rewards from the catalog with your accumulated points.
          </p>
        </div>
        <div className="flex gap-2">
          {/* Only show Admin View button for HQ/admin users, not for shop users */}
          {userProfile.organizations.org_type_code !== 'SHOP' && (
            <Button asChild variant="default" className="gap-2">
              <Link href="/engagement/catalog/admin">
                <Settings className="h-4 w-4" /> Admin View
              </Link>
            </Button>
          )}
          <Button variant="outline" className="gap-2" onClick={() => setOnlyAvailable(true)}>
            <Sparkles className="h-4 w-4" /> Highlight Available
          </Button>
          <Button 
            variant="outline" 
            className="gap-2" 
            onClick={() => {
              setSelectedRewardId(null)
              setSearchTerm("")
              setSelectedCategory("all")
              setSelectedSort("points-asc")
              setOnlyAvailable(true)
            }}
          >
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
            <CardDescription>Your shop&apos;s total points ready to redeem</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-blue-600">{formatNumber(currentBalance)}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {totalScans} {totalScans === 1 ? 'scan' : 'scans'} • Last {latestTransactionLabel}
            </p>
          </CardContent>
        </Card>

        <Card className="border border-emerald-200 bg-emerald-50/60 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-medium text-emerald-700">
              <TrendingUp className="h-5 w-5" /> Earned This Month
            </CardTitle>
            <CardDescription className="text-emerald-700/80">Points you collected this month</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-emerald-700">{formatNumber(pointsEarnedThisMonth)}</p>
            <p className="mt-2 text-xs text-emerald-800/70">Redeemed {formatNumber(pointsRedeemedThisMonth)} points this month</p>
          </CardContent>
        </Card>

        <Card className="border border-purple-200 bg-purple-50/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-medium text-purple-700">
              <Trophy className="h-5 w-5" /> Total Scans
            </CardTitle>
            <CardDescription className="text-purple-700/80">
              QR codes scanned by your shop
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-purple-700">{formatNumber(totalScans)}</p>
            <p className="mt-2 text-xs text-purple-800/70">
              {activeRule?.points_per_scan 
                ? `${formatNumber(activeRule.points_per_scan)} points per scan`
                : "Keep scanning to earn more points"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Product Summary Section */}
      {productSummary.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Gift className="h-5 w-5" /> Products Scanned
            </CardTitle>
            <CardDescription>
              Summary of products you scanned to collect points
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {/* Mobile View (Cards) */}
              <div className="block md:hidden divide-y divide-slate-100">
                {productSummary.slice(0, visibleProductCount).map((item, idx) => (
                  <div key={idx} className="p-4 flex items-start gap-3">
                    <div className="flex-shrink-0 w-12 h-12 bg-slate-100 rounded-md overflow-hidden flex items-center justify-center">
                      {item.imageUrl ? (
                        <Image
                          src={item.imageUrl}
                          alt={item.variant}
                          width={48}
                          height={48}
                          className="object-cover w-full h-full"
                        />
                      ) : (
                        <Gift className="h-6 w-6 text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-slate-900 line-clamp-2">{item.product}</div>
                      <div className="text-xs text-slate-600 line-clamp-2 mt-0.5">{item.variant}</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0">
                          {item.count} {item.count === 1 ? 'scan' : 'scans'}
                        </Badge>
                        <span className="text-xs font-semibold text-emerald-600">
                          +{formatNumber(item.points)} pts
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {productSummary.length > visibleProductCount && (
                  <div className="p-3 text-center border-t border-slate-50">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full text-xs text-muted-foreground h-8"
                      onClick={() => setVisibleProductCount(prev => prev + 5)}
                    >
                      Show more products ({productSummary.length - visibleProductCount} remaining)
                    </Button>
                  </div>
                )}
              </div>

              {/* Desktop View (Table) */}
              <table className="hidden md:table w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Variant</th>
                    <th className="px-4 py-3 text-center">Scans</th>
                    <th className="px-4 py-3 text-right">Points Earned</th>
                  </tr>
                </thead>
                <tbody>
                  {productSummary.map((item, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{item.product}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 w-10 h-10 bg-slate-100 rounded-md overflow-hidden flex items-center justify-center">
                            {item.imageUrl ? (
                              <Image
                                src={item.imageUrl}
                                alt={item.variant}
                                width={40}
                                height={40}
                                className="object-cover w-full h-full"
                              />
                            ) : (
                              <Gift className="h-5 w-5 text-slate-400" />
                            )}
                          </div>
                          <span>{item.variant}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          {item.count} {item.count === 1 ? 'scan' : 'scans'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                        +{formatNumber(item.points)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="catalog" className="space-y-6" suppressHydrationWarning>
        <div className="w-full overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
          <TabsList className="w-auto inline-flex justify-start h-auto p-1">
            <TabsTrigger value="catalog" className="gap-2 py-2 px-4 whitespace-nowrap">
              <Gift className="h-4 w-4" /> Rewards Catalog
            </TabsTrigger>
            <TabsTrigger value="points-history" className="gap-2 py-2 px-4 whitespace-nowrap">
              <Clock className="h-4 w-4" /> Points History
            </TabsTrigger>
            <TabsTrigger value="redemption-history" className="gap-2 py-2 px-4 whitespace-nowrap">
              <History className="h-4 w-4" /> Redemption History
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="catalog" className="space-y-4">
          {/* Mobile-friendly Filter Section */}
          <div className="space-y-4">
            <div className="flex flex-col gap-3">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search rewards..."
                  className="pl-9 bg-white"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
              
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
                <Button
                  size="sm"
                  variant={selectedCategory === "all" ? "default" : "outline"}
                  className="whitespace-nowrap rounded-full"
                  onClick={() => setSelectedCategory("all")}
                >
                  All ({enrichedRewards.length})
                </Button>
                {(Object.keys(CATEGORY_LABELS) as RewardCategory[])
                  .filter(category => (categoriesWithCounts.get(category) ?? 0) > 0)
                  .map((category) => (
                  <Button
                    key={category}
                    size="sm"
                    variant={selectedCategory === category ? "default" : "outline"}
                    className="whitespace-nowrap rounded-full"
                    onClick={() => setSelectedCategory(category)}
                  >
                    {CATEGORY_LABELS[category]}
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {categoriesWithCounts.get(category) ?? 0}
                    </span>
                  </Button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2">
                <Select value={selectedSort} onValueChange={setSelectedSort}>
                  <SelectTrigger className="w-[160px] h-9 text-xs bg-white">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-white px-3 py-2 rounded-md border shadow-sm">
                  <Switch 
                    id="available-mode"
                    checked={onlyAvailable} 
                    onCheckedChange={setOnlyAvailable} 
                    className="scale-75 data-[state=checked]:bg-green-600"
                  />
                  <label htmlFor="available-mode" className="whitespace-nowrap">Available only</label>
                </div>
              </div>
            </div>
          </div>

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
                        src={getStorageUrl(reward.item_image_url) || reward.item_image_url}
                        alt={reward.item_name}
                        fill
                        className="object-contain p-2"
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
                        {(reward as any).point_offer && (reward as any).point_offer > 0 ? (
                          <div className="flex flex-col items-start leading-none">
                            <span className="text-xs text-muted-foreground line-through decoration-red-500/50">
                              {formatNumber(reward.points_required)}
                            </span>
                            <div className="flex items-baseline gap-1">
                              <span className="text-2xl font-bold text-red-600">
                                {formatNumber((reward as any).point_offer)}
                              </span>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-red-600">
                                PROMO
                              </span>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className="text-2xl font-semibold">{formatNumber(reward.points_required)}</span>
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">Points</span>
                          </>
                        )}
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
                        {currentBalance >= ((reward as any).point_offer || reward.points_required) ? (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <TrendingUp className="h-4 w-4" /> Can redeem
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600">
                            <TrendingDown className="h-4 w-4" /> Need {formatNumber(((reward as any).point_offer || reward.points_required) - currentBalance)} pts
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

        <TabsContent value="points-history">
          <Card className="border-none shadow-none bg-transparent">
            <div className="flex items-center justify-between mb-4 px-1">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" /> 
                History
              </h3>
              <span className="text-xs text-muted-foreground bg-slate-100 px-2 py-1 rounded-full">
                Showing {Math.min(visibleHistoryCount, ledgerTransactions.length)} of {ledgerTransactions.length}
              </span>
            </div>
            
            <CardContent className="p-0">
              {ledgerTransactions.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground bg-white rounded-lg border border-slate-200">
                  <Gift className="h-10 w-10" />
                  <p className="text-sm">No points collected yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {ledgerTransactions.slice(0, visibleHistoryCount).map((txn, index) => {
                    const runningBalance = currentBalance - ledgerTransactions
                      .slice(0, index)
                      .reduce((sum, t) => sum + t.points_change, 0)
                    
                    const isPositive = txn.points_change > 0;
                    
                    return (
                      <div key={txn.id} className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm flex gap-4 items-start">
                        {/* Icon/Image Section */}
                        <div className="flex-shrink-0">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden ${isPositive ? 'bg-emerald-50' : 'bg-red-50'}`}>
                            {(txn as any).imageUrl ? (
                              <Image
                                src={(txn as any).imageUrl}
                                alt="Product"
                                width={48}
                                height={48}
                                className="object-cover w-full h-full"
                              />
                            ) : isPositive ? (
                              <Gift className="h-6 w-6 text-emerald-500" />
                            ) : (
                              <Gift className="h-6 w-6 text-red-500" />
                            )}
                          </div>
                        </div>

                        {/* Content Section */}
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start mb-1">
                            <h4 className="font-medium text-sm text-slate-900 line-clamp-1">
                              {txn.product_name || txn.reward_name || txn.description || 'Transaction'}
                            </h4>
                            <span className={`font-bold text-sm ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                              {isPositive ? '+' : ''}{formatNumber(txn.points_change)}
                            </span>
                          </div>
                          
                          <div className="flex justify-between items-center text-xs text-muted-foreground">
                            <div className="flex flex-col gap-0.5">
                              <span>{txn.variant_name || (txn.transaction_type === 'redeem' ? 'Redemption' : 'Standard')}</span>
                              <span className="text-[10px] opacity-70">{formatDateLabel(txn.occurred_at)}</span>
                            </div>
                            <div className="text-right">
                              <span className="block text-[10px] uppercase tracking-wider opacity-70">Balance</span>
                              <span className="font-medium text-slate-700">{formatNumber(runningBalance)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  
                  {ledgerTransactions.length > visibleHistoryCount && (
                    <div className="pt-2 text-center">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={() => setVisibleHistoryCount(prev => prev + 10)}
                      >
                        Load more history
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Redemption History Tab - Shows only redemptions */}
        <TabsContent value="redemption-history">
          <Card className="border-none shadow-none bg-transparent">
            <div className="flex items-center justify-between mb-4 px-1">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Gift className="h-5 w-5 text-muted-foreground" /> 
                Redemptions
              </h3>
              <span className="text-xs text-muted-foreground bg-slate-100 px-2 py-1 rounded-full">
                {ledgerTransactions.filter(t => t.transaction_type === 'redeem').length} items
              </span>
            </div>
            
            <CardContent className="p-0">
              {ledgerTransactions.filter(t => t.transaction_type === 'redeem').length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground bg-white rounded-lg border border-slate-200">
                  <Gift className="h-10 w-10" />
                  <p className="text-sm">No redemptions yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {ledgerTransactions.filter(t => t.transaction_type === 'redeem').slice(0, 50).map((txn) => {
                    return (
                      <div key={txn.id} className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm flex gap-4 items-start">
                        {/* Icon/Image Section */}
                        <div className="flex-shrink-0">
                          <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden bg-red-50">
                            {(txn as any).imageUrl ? (
                              <Image
                                src={(txn as any).imageUrl}
                                alt={txn.reward_name || 'Reward'}
                                width={48}
                                height={48}
                                className="object-cover w-full h-full"
                              />
                            ) : (
                              <Gift className="h-6 w-6 text-red-500" />
                            )}
                          </div>
                        </div>

                        {/* Content Section */}
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start mb-1">
                            <h4 className="font-medium text-sm text-slate-900 line-clamp-1">
                              {txn.reward_name || txn.description || 'Reward Redemption'}
                            </h4>
                            <span className="font-bold text-sm text-red-600">
                              {formatNumber(Math.abs(txn.points_change))}
                            </span>
                          </div>
                          
                          <div className="flex justify-between items-center text-xs text-muted-foreground">
                            <div className="flex flex-col gap-0.5">
                              <span>Reward redemption</span>
                              <span className="text-[10px] opacity-70">{formatDateLabel(txn.occurred_at)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(selectedReward)} onOpenChange={(open) => !open && setSelectedRewardId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
          {selectedReward && (
            <div className="grid gap-0 md:grid-cols-[1fr_1.5fr]">
              <div className="relative h-80 w-full bg-muted md:h-auto md:min-h-[500px]">
                {selectedReward.item_image_url ? (
                  <Image
                    src={getStorageUrl(selectedReward.item_image_url) || selectedReward.item_image_url}
                    alt={selectedReward.item_name}
                    fill
                    className="object-contain p-4"
                    priority
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                    <Gift className="h-16 w-16 text-slate-400" />
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
                  <Button variant="outline" onClick={() => setSelectedRewardId(null)} disabled={redeeming}>
                    Close
                  </Button>
                  <Button 
                    disabled={!selectedReward.isAvailable || currentBalance < selectedReward.points_required || redeeming} 
                    className="gap-2"
                    onClick={() => handleRedeemReward(selectedReward)}
                  >
                    {redeeming ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Gift className="h-4 w-4" />
                        {!selectedReward.isAvailable 
                          ? "Not available" 
                          : currentBalance >= selectedReward.points_required 
                            ? "Redeem now" 
                            : "Need more points"}
                      </>
                    )}
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
