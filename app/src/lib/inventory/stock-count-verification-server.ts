import { createHmac, randomInt } from 'node:crypto'

export function generateStockCountCode(): string {
    return randomInt(0, 100_000_000).toString().padStart(8, '0')
}

export function hashStockCountCode(code: string, orgId: string, sessionId: string, userId: string): string {
    const secret = process.env.STOCK_COUNT_VERIFICATION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
    if (!secret) throw new Error('Stock Count verification secret is not configured.')
    return createHmac('sha256', secret).update(`${orgId}:${sessionId}:${userId}:${code}`).digest('hex')
}

export function maskEmail(email: string): string {
    const [local, domain = ''] = email.split('@')
    const visible = local.slice(0, Math.min(2, local.length))
    return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`
}

export async function finalizeStockCountVerificationDelivery(supabase: any, requestId: string, delivered: boolean) {
    const { error } = await supabase.rpc('finalize_stock_count_verification_delivery', {
        p_request_id: requestId,
        p_success: delivered,
    })
    if (error) throw error
}
