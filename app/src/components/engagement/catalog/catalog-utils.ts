import type { Database } from "@/types/database"

export type RedeemItemRow = Database["public"]["Tables"]["redeem_items"]["Row"]

export type RewardCategory =
  | "device"
  | "liquid"
  | "merch"
  | "voucher"
  | "cashback"
  | "mystery_box"
  | "point"
  | "other"

export type RewardStatus = "available" | "scheduled" | "expired" | "soldOut" | "paused"

export interface EnrichedReward extends RedeemItemRow {
  category: RewardCategory
  status: RewardStatus
  requiresVerification: boolean
  isAvailable: boolean
  lowStock: boolean
  startsInDays: number | null
  endsInDays: number | null
}

export const CATEGORY_LABELS: Record<RewardCategory, string> = {
  device: "Devices",
  liquid: "Liquids",
  merch: "Merch",
  voucher: "Vouchers",
  cashback: "Cashback",
  mystery_box: "Mystery Box",
  point: "Point",
  other: "Other"
}

export function deriveCategory(item: RedeemItemRow): RewardCategory {
  const candidate = `${item.item_code ?? ""} ${item.item_name ?? ""}`.toLowerCase()
  if (candidate.includes("device") || candidate.includes("gadget")) return "device"
  if (candidate.includes("liquid") || candidate.includes("beverage")) return "liquid"
  if (candidate.includes("voucher") || candidate.includes("gift")) return "voucher"
  if (candidate.includes("cash")) return "cashback"
  if (candidate.includes("mystery")) return "mystery_box"
  if (candidate.includes("merch") || candidate.includes("shirt") || candidate.includes("cap")) return "merch"
  if (candidate.includes("point-reward") || candidate.includes("bonus point")) return "point"
  return "other"
}

export function determineStatus(item: RedeemItemRow, now: Date): RewardStatus {
  if (!item.is_active) return "paused"
  const startsAt = item.valid_from ? new Date(item.valid_from) : null
  const endsAt = item.valid_until ? new Date(item.valid_until) : null
  if (startsAt && startsAt.getTime() > now.getTime()) return "scheduled"
  if (endsAt && endsAt.getTime() < now.getTime()) return "expired"
  if (typeof item.stock_quantity === "number" && item.stock_quantity <= 0) return "soldOut"
  return "available"
}

export function requiresVerification(item: RedeemItemRow, category: RewardCategory): boolean {
  if (item.max_redemptions_per_consumer && item.max_redemptions_per_consumer <= 1) return true
  if (item.points_required >= 1500) return true
  if (["device", "cashback"].includes(category)) return true
  return false
}

export function addDays(base: Date, days: number): Date {
  const clone = new Date(base)
  clone.setDate(clone.getDate() + days)
  return clone
}

export function formatDateLabel(value: string | null): string {
  if (!value) return "No date"
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value))
}

export function getStatusBadgeClass(status: RewardStatus): string {
  switch (status) {
    case "available":
      return "bg-emerald-100 text-emerald-700 border border-emerald-200"
    case "scheduled":
      return "bg-blue-100 text-blue-700 border border-blue-200"
    case "expired":
      return "bg-red-100 text-red-700 border border-red-200"
    case "soldOut":
      return "bg-amber-100 text-amber-700 border border-amber-200"
    case "paused":
      return "bg-gray-100 text-gray-600 border border-gray-200"
    default:
      return "bg-gray-100 text-gray-600 border border-gray-200"
  }
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-MY").format(value)
}

export function enrichReward(item: RedeemItemRow, referenceDate = new Date()): EnrichedReward {
  const category = deriveCategory(item)
  const status = determineStatus(item, referenceDate)
  const startsAt = item.valid_from ? new Date(item.valid_from) : null
  const endsAt = item.valid_until ? new Date(item.valid_until) : null
  const startsInDays = startsAt ? Math.ceil((startsAt.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24)) : null
  const endsInDays = endsAt ? Math.floor((endsAt.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24)) : null
  const quantity = typeof item.stock_quantity === "number" ? item.stock_quantity : null

  return {
    ...item,
    category,
    status,
    requiresVerification: requiresVerification(item, category),
    isAvailable: status === "available",
    lowStock: quantity !== null && quantity > 0 && quantity <= 10,
    startsInDays,
    endsInDays
  }
}
