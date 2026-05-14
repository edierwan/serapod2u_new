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

        const affectedQuantity = Math.abs(quantity)

        // Resolve manufacturer from product
        let manufacturerOrgId = body.target_manufacturer_org_id || null
        if (!manufacturerOrgId) {
            const { data: variant, error: variantErr } = await supabase
                .from('product_variants')
                .select('product_id, products!inner(manufacturer_id)')
                .eq('id', variantId)
                .single()
            if (variantErr || !variant) {
                console.error('Create issue variant lookup failed', variantErr)
                return NextResponse.json({ error: 'Selected product variant could not be found' }, { status: 400 })
            }
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
                status: 'pending',
                created_by: user.id,
                target_manufacturer_org_id: manufacturerOrgId,
                manufacturer_assigned_at: manufacturerOrgId ? new Date().toISOString() : null,
                manufacturer_status: manufacturerOrgId ? 'pending' : null,
            })
            .select()
            .single()
        if (adjErr) {
            console.error('Create issue adjustment insert failed', adjErr)
            return NextResponse.json({ error: 'Unable to create the issue right now' }, { status: 500 })
        }

        // stock_adjustment_items requires non-null quantity fields, even for
        // complaint-only records that do not post an actual stock movement.
        // Use the current on-hand quantity when available; otherwise fall back
        // to a minimal consistent snapshot for the affected units.
        const { data: inventorySnapshot, error: inventoryErr } = await supabase
            .from('product_inventory')
            .select('quantity_on_hand')
            .eq('organization_id', orgId)
            .eq('variant_id', variantId)
            .maybeSingle()

        if (inventoryErr) {
            console.warn('Create issue inventory snapshot lookup failed', inventoryErr)
        }

        const systemQuantity = Math.max(Number((inventorySnapshot as any)?.quantity_on_hand ?? affectedQuantity), affectedQuantity)
        const physicalQuantity = Math.max(systemQuantity - affectedQuantity, 0)

        // Insert item row for the affected variant.
        const { error: itemErr } = await supabase
            .from('stock_adjustment_items')
            .insert({
                adjustment_id: (adjustment as any).id,
                variant_id: variantId,
                system_quantity: systemQuantity,
                physical_quantity: physicalQuantity,
                adjustment_quantity: -affectedQuantity,
                unit_cost: unitCost,
            })
        if (itemErr) {
            // best-effort cleanup
            await supabase.from('stock_adjustments').delete().eq('id', (adjustment as any).id)
            console.error('Create issue item insert failed', itemErr)
            return NextResponse.json({ error: 'Unable to save the selected product for this issue' }, { status: 500 })
        }

        return NextResponse.json({ data: adjustment })
    } catch (err: any) {
        console.error('POST /api/manufacturer/adjustments/create error', err)
        return NextResponse.json({ error: 'Unable to create the issue right now' }, { status: 500 })
    }
}
