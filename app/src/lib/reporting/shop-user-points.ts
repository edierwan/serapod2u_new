export interface ShopUserReportingMember {
  userId: string
  currentBalance: number
  totalCollectedSystem: number
  totalCollectedManual: number
  totalMigration: number
  totalRedeemed: number
  totalBonusPoints: number
  transactionCount: number
  lastActivity: string | null
}

export interface ShopAnonymousScanMetrics {
  anonymousShopScanPoints?: number
  anonymousShopScanCount?: number
}

export interface ShopUserPointsReportingSummary {
  totalAttachedUsers: number
  shopCurrentUserBalance: number
  totalCollectedSystem: number
  totalCollectedManual: number
  totalMigrationPoints: number
  totalRedeemedByAttachedUsers: number
  totalBonusPoints: number
  totalEarnedByAttachedUsers: number
  totalTransactions: number
  lastActivity: string | null
  anonymousShopScanPoints: number
  anonymousShopScanCount: number
}

export function summarizeShopUserPointsReporting(
  members: ShopUserReportingMember[],
  anonymousMetrics: ShopAnonymousScanMetrics = {}
): ShopUserPointsReportingSummary {
  const lastActivity = members
    .map((member) => member.lastActivity)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || null

  const totals = members.reduce((acc, member) => {
    acc.totalAttachedUsers += 1
    acc.shopCurrentUserBalance += Number(member.currentBalance || 0)
    acc.totalCollectedSystem += Number(member.totalCollectedSystem || 0)
    acc.totalCollectedManual += Number(member.totalCollectedManual || 0)
    acc.totalMigrationPoints += Number(member.totalMigration || 0)
    acc.totalRedeemedByAttachedUsers += Number(member.totalRedeemed || 0)
    acc.totalBonusPoints += Number(member.totalBonusPoints || 0)
    acc.totalTransactions += Number(member.transactionCount || 0)
    return acc
  }, {
    totalAttachedUsers: 0,
    shopCurrentUserBalance: 0,
    totalCollectedSystem: 0,
    totalCollectedManual: 0,
    totalMigrationPoints: 0,
    totalRedeemedByAttachedUsers: 0,
    totalBonusPoints: 0,
    totalTransactions: 0,
  })

  return {
    ...totals,
    totalEarnedByAttachedUsers:
      totals.totalCollectedSystem +
      totals.totalCollectedManual +
      totals.totalMigrationPoints +
      totals.totalBonusPoints,
    lastActivity,
    anonymousShopScanPoints: Number(anonymousMetrics.anonymousShopScanPoints || 0),
    anonymousShopScanCount: Number(anonymousMetrics.anonymousShopScanCount || 0),
  }
}