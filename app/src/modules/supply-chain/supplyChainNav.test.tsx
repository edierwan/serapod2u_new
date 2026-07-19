import { describe, expect, it } from 'vitest'

import {
    canAccessSupplyChainView,
    resolveSupplyChainSlug,
    supplyChainOrganizationPath,
} from './supplyChainNav'

describe('Supply Chain child-view access', () => {
    it('allows an HQ level-10 admin to open Product List', () => {
        expect(canAccessSupplyChainView('products', 'HQ', 10)).toBe(true)
    })

    it.each(['view-product', 'edit-product', 'add-product'])(
        'allows an HQ level-10 admin to open the Product List action %s',
        (viewId) => {
            expect(canAccessSupplyChainView(viewId, 'HQ', 10)).toBe(true)
        },
    )

    it.each(['HQ', 'DIST', 'WH', 'MFG', 'SHOP'])(
        'keeps product details aligned with Product List access for %s users',
        (orgType) => {
            expect(canAccessSupplyChainView('products', orgType, 50)).toBe(true)
            expect(canAccessSupplyChainView('view-product', orgType, 50)).toBe(true)
        },
    )

    it('does not grant unrelated restricted Supply Chain views', () => {
        expect(canAccessSupplyChainView('inventory-list', 'MFG', 10)).toBe(false)
        expect(canAccessSupplyChainView('organizations', 'DIST', 10)).toBe(false)
        expect(canAccessSupplyChainView('add-organization', 'HQ', 30)).toBe(false)
        expect(canAccessSupplyChainView('unknown-child-view', 'HQ', 10)).toBe(false)
    })

    it.each(['view-organization', 'edit-organization', 'edit-organization-hq'])(
        'keeps organization detail aligned with Organizations list access for %s',
        (viewId) => {
            // HQ admin who can see the Organizations list can open its details
            expect(canAccessSupplyChainView('organizations', 'HQ', 10)).toBe(true)
            expect(canAccessSupplyChainView(viewId, 'HQ', 10)).toBe(true)
            // Non-HQ users never see Organizations, so details stay blocked
            expect(canAccessSupplyChainView(viewId, 'DIST', 10)).toBe(false)
            expect(canAccessSupplyChainView(viewId, 'SHOP', 10)).toBe(false)
        },
    )
})

describe('Supply Chain organization deep links', () => {
    it('builds URL-addressable paths that carry the organization id', () => {
        expect(supplyChainOrganizationPath('organizations')).toBe('organizations')
        expect(supplyChainOrganizationPath('add-organization')).toBe('organizations/new')
        expect(supplyChainOrganizationPath('view-organization', 'abc')).toBe('organizations/abc')
        expect(supplyChainOrganizationPath('edit-organization', 'abc')).toBe('organizations/abc/edit')
        // No id → no detail path (caller falls back to in-memory navigation)
        expect(supplyChainOrganizationPath('view-organization')).toBeNull()
        expect(supplyChainOrganizationPath('edit-organization', '')).toBeNull()
        expect(supplyChainOrganizationPath('edit-organization-hq', 'abc')).toBeNull()
    })

    it('resolves organization slugs back to a view id and org id (refresh / back-forward)', () => {
        expect(resolveSupplyChainSlug(['organizations'])).toEqual({ initialView: 'organizations' })
        expect(resolveSupplyChainSlug(['organizations', 'new'])).toEqual({ initialView: 'add-organization' })
        expect(resolveSupplyChainSlug(['organizations', 'abc'])).toEqual({
            initialView: 'view-organization',
            initialOrgId: 'abc',
        })
        expect(resolveSupplyChainSlug(['organizations', 'abc', 'edit'])).toEqual({
            initialView: 'edit-organization',
            initialOrgId: 'abc',
        })
    })

    it('still resolves existing inventory paths', () => {
        expect(resolveSupplyChainSlug(['inventory'])).toEqual({ initialView: 'inventory-list' })
        expect(resolveSupplyChainSlug(['inventory', 'settings'])).toEqual({ initialView: 'inventory-settings' })
        expect(resolveSupplyChainSlug(['inventory', 'repack'])).toEqual({ initialView: 'repack-stock' })
        expect(resolveSupplyChainSlug(['something-unknown'])).toEqual({ initialView: 'supply-chain' })
    })
})
