import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/manufacturer/adjustments/create
 *
 * Create a quality / return-to-supplier issue manually (no stock movement).
 * Used by Quality & Returns → "Create Issue" CTA.
 *
 * Body:
 *   {
 *     reason_code: 'quality_issue' | 'return_to_supplier' | 'damaged_goods',
 *     variant_id: string,                    // product variant in question
 *     organization_id?: string,              // reporter org (defaults to caller's org)
 *     target_manufacturer_org_id?: string,   // auto-derived from product if missing
 *     quantity_affected: number,
 *     unit_cost?: number,
 *     notes: string,
 *     proof_images?: string[],               // public URLs (uploaded client-side)
 *   }
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await request.json().catch(() => null) as any
        if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

        const reasonCode = String(body.reason_code || '').trim()
        const variantId = String(body.variant_id || '').trim()
        const quantity = Number(body.quantity_affected || 0)
        const notes = String(body.notes || '').trim()
        const unitCost = body.unit_cost != null ? Number(body.unit_cost) : null
        const proofImages: string[] = Array.isArray(body.proof_images) ? body.proof_images.filter((u: any) => typeof u === 'string') : []

        if (!['quality_issue', 'return_to_supplier', 'damaged_goods'].includes(reasonCode)) {
            return NextResponse.json({ error: 'Invalid reason_code' }, { status: 400 })
        }
        if (!variantId) return NextResponse.json({ error: 'variant_id is required' }, { status: 400 })
        if (!notes) return NextResponse.json({ error: 'notes is required' }, { status: 400 })
        if (!quantity || quantity <= 0) return NextResponse.json({ error: 'quantity_affected must be > 0' }, { status: 400 })

        // Fetch caller profile
        const { data: profile, error: profileErr } = await supabase
            .from('users')
            .select('id, organization_id, role_code')
            .eq('id', user.id)
            .single()
        if (profileErr || !profile) return NextResponse.json({ error: 'Profile not found' }, { status: 500 })

        const orgId = body.organization_id || profile.organization_id
        if (!orgId) return NextResponse.json({ error: 'Reporter organization required' }, { status: 400 })

        // Resolve manufacturer from product
        let manufacturerOrgId = body.target_manufacturer_org_id || null
        if (!manufacturerOrgId) {
            const { data: variant } = await supabase
                .from('product_variants')
                .select('product_id, products!inner(manufacturer_id)')
                .eq('id', variantId)
                .single()
            manufacturerOrgId = (variant as any)?.products?.manufacturer_id || null
        }

        // Find reason id
        const { data: reason } = await supabase
            .from('stock_adjustment_reasons')
            .select('id, reason_code')
            .eq('reason_code', reasonCode)
            .single()
        if (!reason) return NextResponse.json({ error: `Reason ${reasonCode} not found` }, { status: 400 })

        // Insert adjustment header
        const { data: adjustment, error: adjErr } = await supabase
            .from('stock_adjustments')
            .insert({
                organization_id: orgId,
                reason_id: (reason as any).id,
                notes,
                proof_images: proofImages.length > 0 ? proofImages : null,
                status: 'completed',
                created_by: user.id,
                target_manufacturer_org_id: manufacturerOrgId,
                manufacturer_assigned_at: manufacturerOrgId ? new Date().toISOString() : null,
                manufacturer_status: manufacturerOrgId ? 'pending' : null,
            })
            .select()
            .single()
        if (adjErr) return NextResponse.json({ error: adjErr.message }, { status: 500 })

        // Insert item row (no stock movement — system_quantity left null, this is a complaint record only)
        const { error: itemErr } = await supabase
            .from('stock_adjustment_items')
            .insert({
                adjustment_id: (adjustment as any).id,
                variant_id: variantId,
                system_quantity: null,
                physical_quantity: null,
                adjustment_quantity: -Math.abs(quantity),
                unit_cost: unitCost,
            })
        if (itemErr) {
            // best-effort cleanup
            await supabase.from('stock_adjustments').delete().eq('id', (adjustment as any).id)
            return NextResponse.json({ error: itemErr.message }, { status: 500 })
        }

        return NextResponse.json({ data: adjustment })
    } catch (err: any) {
        console.error('POST /api/manufacturer/adjustments/create error', err)
        return NextResponse.json({ error: err.message || 'Unknown' }, { status: 500 })
    }
}
