import { describe, expect, it } from 'vitest'

import { summarizeShopUserPointsReporting } from './shop-user-points'

describe('shop-user-points reporting', () => {
    it('tracks shop reporting as the sum of attached user wallets', () => {
        const before = summarizeShopUserPointsReporting([
            {
                userId: 'user-a',
                currentBalance: 50,
                totalCollectedSystem: 50,
                totalCollectedManual: 0,
                totalMigration: 0,
                totalRedeemed: 0,
                totalBonusPoints: 0,
                transactionCount: 1,
                lastActivity: '2026-05-20T00:00:00.000Z',
            },
            {
                userId: 'user-b',
                currentBalance: 60,
                totalCollectedSystem: 60,
                totalCollectedManual: 0,
                totalMigration: 0,
                totalRedeemed: 0,
                totalBonusPoints: 0,
                transactionCount: 1,
                lastActivity: '2026-05-20T00:00:00.000Z',
            },
            {
                userId: 'user-c',
                currentBalance: 90,
                totalCollectedSystem: 90,
                totalCollectedManual: 0,
                totalMigration: 0,
                totalRedeemed: 0,
                totalBonusPoints: 0,
                transactionCount: 1,
                lastActivity: '2026-05-20T00:00:00.000Z',
            },
        ])

        const after = summarizeShopUserPointsReporting([
            {
                userId: 'user-a',
                currentBalance: 0,
                totalCollectedSystem: 50,
                totalCollectedManual: 0,
                totalMigration: 0,
                totalRedeemed: 50,
                totalBonusPoints: 0,
                transactionCount: 2,
                lastActivity: '2026-05-20T01:00:00.000Z',
            },
            {
                userId: 'user-b',
                currentBalance: 60,
                totalCollectedSystem: 60,
                totalCollectedManual: 0,
                totalMigration: 0,
                totalRedeemed: 0,
                totalBonusPoints: 0,
                transactionCount: 1,
                lastActivity: '2026-05-20T00:00:00.000Z',
            },
            {
                userId: 'user-c',
                currentBalance: 90,
                totalCollectedSystem: 90,
                totalCollectedManual: 0,
                totalMigration: 0,
                totalRedeemed: 0,
                totalBonusPoints: 0,
                transactionCount: 1,
                lastActivity: '2026-05-20T00:00:00.000Z',
            },
        ])

        expect(before.shopCurrentUserBalance).toBe(200)
        expect(after.shopCurrentUserBalance).toBe(150)
        expect(after.totalRedeemedByAttachedUsers).toBe(50)
        expect(after.totalAttachedUsers).toBe(3)
    })
})