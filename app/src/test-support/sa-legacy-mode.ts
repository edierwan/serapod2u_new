/**
 * Test-only Security & Access doubles with LEGACY_ENFORCED/SHADOW semantics:
 * the route's legacy evaluator decides, exactly as in production before a
 * permission is cut over. Business-logic route tests use these so they keep
 * testing their own rules; S&A behaviour itself is covered by
 * src/lib/security-access/*.test.ts and supabase/tests/security/sa_final_wave.
 *
 *   vi.mock('@/lib/security-access/operation', async () => (await import('@/test-support/sa-legacy-mode')).operationModule)
 *   vi.mock('@/lib/security-access/resource-context', async () => (await import('@/test-support/sa-legacy-mode')).resourceContextModule)
 */
import { NextResponse } from 'next/server'

type Req = { legacy?: () => boolean | Promise<boolean>; permission?: string }

async function legacyAllows(req: Req) {
  return req.legacy ? Boolean(await req.legacy()) : true
}

export const operationModule = {
  authorizeOperation: async (req: Req) => ({ decision: (await legacyAllows(req)) ? 'ALLOW' : 'DENY', decisionId: 'test', reasonCode: 'LEGACY_ALLOWED' }),
  guardOperation: async (req: Req) =>
    (await legacyAllows(req)) ? null : NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }),
  guardUserOperation: async (_userId: string, _permission: string, options: Req = {}) =>
    (await legacyAllows(options)) ? null : NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }),
  userAllowed: async (_userId: string, _permission: string, legacy: () => boolean | Promise<boolean>) => Boolean(await legacy()),
  organizationResource: (type: string, organizationId: string | null | undefined, extra = {}) => ({ type, organizationId: organizationId ?? null, ...extra }),
  warehouseResource: (type: string, warehouseId: string, extra = {}) => ({ type, organizationId: warehouseId, warehouseId, ...extra }),
}

export const resourceContextModule = {
  resolveWarehouseResourceContext: async (_actorOrg: string | null | undefined, warehouseId: string) => ({ organizationId: warehouseId, warehouseId }),
  organizationContextForWarehouse: (_a: string | null | undefined, ancestry: string[], warehouseId: string) => ancestry[ancestry.length - 1] ?? warehouseId,
}
