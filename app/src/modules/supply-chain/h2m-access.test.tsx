import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { canCreateH2MOrder, canOpenOrderEditor } from './h2m-access'
import { canAccessSupplyChainView, resolveSupplyChainDeepLink } from './supplyChainNav'

describe('H2M access', () => {
    it.each([1, 10, 20, 30, 40])('allows HQ role level %s to create H2M', (roleLevel) => {
        expect(canCreateH2MOrder('HQ', roleLevel)).toBe(true)
    })

    it('allows level 40 to open the internal order editor', () => {
        expect(canOpenOrderEditor(40)).toBe(true)
        expect(canAccessSupplyChainView('create-order', 'HQ', 40)).toBe(true)
    })

    it.each(['DIST', 'SHOP', 'WH', 'MFG', undefined])('rejects H2M creation for non-HQ org %s', (orgType) => {
        expect(canCreateH2MOrder(orgType, 40)).toBe(false)
    })

    it('rejects role levels below the creation entitlement', () => {
        expect(canCreateH2MOrder('HQ', 50)).toBe(false)
        expect(canOpenOrderEditor(50)).toBe(false)
    })

    it('allows a Manufacturer to enter order details without granting unrelated Supply Chain pages', () => {
        expect(canAccessSupplyChainView('view-order', 'MFG', 30)).toBe(true)
        expect(canAccessSupplyChainView('track-order', 'MFG', 30)).toBe(true)
        expect(canAccessSupplyChainView('inventory-list', 'MFG', 30)).toBe(false)
        expect(canAccessSupplyChainView('warehouse-receive-2', 'MFG', 30)).toBe(false)
    })

    it('restores an authorized order detail route on direct refresh', () => {
        expect(resolveSupplyChainDeepLink('view-order', 'order-123')).toEqual({
            initialView: 'view-order',
            initialOrderId: 'order-123',
        })
        expect(resolveSupplyChainDeepLink('view-order', '')).toEqual({
            initialView: 'supply-chain',
            initialOrderId: undefined,
        })
    })

    it('adds an H2M-only server-side RLS condition without changing D2H/S2D branches', () => {
        const migration = fs.readFileSync(
            path.resolve(process.cwd(), '../supabase/migrations/20260621_h2m_hq_access_level_40.sql'),
            'utf8',
        )
        expect(migration).toContain("order_type <> 'H2M'")
        expect(migration).toContain("public.get_org_type(public.current_user_org_id()) = 'HQ'")
        expect(migration).toContain('public.current_user_role_level() <= 40')
        expect(migration).not.toContain("order_type = 'D2H'")
        expect(migration).not.toContain("order_type = 'S2D'")
    })
})
