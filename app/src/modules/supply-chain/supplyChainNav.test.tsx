import { describe, expect, it } from 'vitest'

import { canAccessSupplyChainView } from './supplyChainNav'

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
})
