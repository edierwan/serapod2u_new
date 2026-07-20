import { describe, expect, it, vi } from 'vitest'
import { loadActiveHqReturnWarehouses, validateReturnWarehouse } from './server'

function query(result: { data: any; error: any }) {
    const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        in: vi.fn(() => builder),
        order: vi.fn(() => builder),
        maybeSingle: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: any) => unknown, reject: (reason: any) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
    }
    return builder
}

describe('Return Warehouse master-data query', () => {
    it('loads only active warehouses whose parent is an active HQ', async () => {
        const headquarters = query({ data: [{ id: 'hq-1' }, { id: 'hq-2' }], error: null })
        const warehouses = query({ data: [{ id: 'wh-1', org_name: 'Warehouse One' }], error: null })
        const admin = { from: vi.fn().mockReturnValueOnce(headquarters).mockReturnValueOnce(warehouses) }

        const result = await loadActiveHqReturnWarehouses(admin as any, 'id, org_name')

        expect(result).toEqual({ data: [{ id: 'wh-1', org_name: 'Warehouse One' }], error: null })
        expect(headquarters.eq).toHaveBeenCalledWith('org_type_code', 'HQ')
        expect(headquarters.eq).toHaveBeenCalledWith('is_active', true)
        expect(warehouses.eq).toHaveBeenCalledWith('org_type_code', 'WH')
        expect(warehouses.eq).toHaveBeenCalledWith('is_active', true)
        expect(warehouses.in).toHaveBeenCalledWith('parent_org_id', ['hq-1', 'hq-2'])
        expect(warehouses.order).toHaveBeenCalledWith('org_name', { ascending: true })
    })

    it('returns no options and does not issue a warehouse query when no active HQ exists', async () => {
        const headquarters = query({ data: [], error: null })
        const admin = { from: vi.fn().mockReturnValueOnce(headquarters) }

        await expect(loadActiveHqReturnWarehouses(admin as any)).resolves.toEqual({ data: [], error: null })
        expect(admin.from).toHaveBeenCalledTimes(1)
    })
})

describe('Return Warehouse server validation', () => {
    function context(org: any, parent: any) {
        const orgQuery = query({ data: org, error: null })
        const parentQuery = query({ data: parent, error: null })
        return {
            ctx: { admin: { from: vi.fn().mockReturnValueOnce(orgQuery).mockReturnValueOnce(parentQuery) } } as any,
            orgQuery,
            parentQuery,
        }
    }

    it('accepts an active warehouse managed by an active HQ', async () => {
        const { ctx } = context(
            { id: 'wh-1', org_type_code: 'WH', is_active: true, parent_org_id: 'hq-1' },
            { id: 'hq-1', org_type_code: 'HQ', is_active: true },
        )

        await expect(validateReturnWarehouse(ctx, 'wh-1')).resolves.toEqual({ ok: true })
    })

    it.each([
        ['distributor organization', { id: 'dist-1', org_type_code: 'DIST', is_active: true, parent_org_id: 'hq-1' }],
        ['inactive warehouse', { id: 'wh-1', org_type_code: 'WH', is_active: false, parent_org_id: 'hq-1' }],
        ['warehouse without a parent', { id: 'wh-1', org_type_code: 'WH', is_active: true, parent_org_id: null }],
    ])('rejects a %s', async (_label, org) => {
        const { ctx } = context(org, { id: 'hq-1', org_type_code: 'HQ', is_active: true })
        await expect(validateReturnWarehouse(ctx, org.id)).resolves.toMatchObject({ ok: false })
    })

    it.each([
        ['distributor-managed warehouse', { id: 'dist-1', org_type_code: 'DIST', is_active: true }],
        ['warehouse under an inactive HQ', { id: 'hq-1', org_type_code: 'HQ', is_active: false }],
    ])('rejects a %s', async (_label, parent) => {
        const { ctx } = context(
            { id: 'wh-1', org_type_code: 'WH', is_active: true, parent_org_id: parent.id },
            parent,
        )
        await expect(validateReturnWarehouse(ctx, 'wh-1')).resolves.toMatchObject({ ok: false })
    })
})
