import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeManufacturerWorkflowStatus } from '@/lib/quality-issues'

/**
 * GET /api/manufacturer/adjustments/[id]
 * POST /api/manufacturer/adjustments/[id] (manufacture acknowledges -> set acknowledged fields via RPC)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const { id } = await params

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // fetch user profile
    const { data: userProfile } = await supabase.from('users').select('organization_id, role_code').eq('id', user.id).single()

    // find the adjustment
    const { data: adjustment, error } = await supabase
      .from('stock_adjustments')
      .select('*, stock_adjustment_items (*), stock_adjustment_reasons (reason_code, reason_name)')
      .eq('id', id)
      .single()

    if (error || !adjustment) return NextResponse.json({ error: 'Adjustment not found' }, { status: 404 })

    // authorization: manufacturers see assigned to their org OR SA can see all
    if (userProfile.role_code !== 'SA') {
      if (adjustment.target_manufacturer_org_id !== userProfile.organization_id) {
        return NextResponse.json({ error: 'Not allowed to view this adjustment' }, { status: 403 })
      }
    }

    return NextResponse.json({ data: adjustment })
  } catch (err: any) {
    console.error('GET adjustment detail error', err)
    return NextResponse.json({ error: err.message || 'Unknown' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const body = await request.json()
    const { id } = await params

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userProfile } = await supabase.from('users').select('id, organization_id, role_code').eq('id', user.id).single()
    if (!userProfile) return NextResponse.json({ error: 'User profile not found' }, { status: 400 })

    const { data: adjustment } = await admin
      .from('stock_adjustments')
      .select('id, target_manufacturer_org_id, manufacturer_status')
      .eq('id', id)
      .single()

    if (!adjustment) return NextResponse.json({ error: 'Adjustment not found' }, { status: 404 })

    if (userProfile.role_code !== 'SA' && adjustment.target_manufacturer_org_id !== userProfile.organization_id) {
      return NextResponse.json({ error: 'Not allowed to acknowledge this adjustment' }, { status: 403 })
    }

    const workflowStatus = normalizeManufacturerWorkflowStatus(adjustment.manufacturer_status)
    if (workflowStatus !== 'pending_manufacturer') {
      return NextResponse.json({ error: 'Only issues sent to the manufacturer can be acknowledged' }, { status: 400 })
    }

    // Call RPC to acknowledge as manufacturer
    const { data, error } = await supabase.rpc('manufacturer_acknowledge_adjustment', { p_adjustment_id: id, p_notes: body.notes || null })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ data })
  } catch (err: any) {
    console.error('POST acknowledge adjustment error', err)
    return NextResponse.json({ error: err.message || 'Unknown' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const body = await request.json().catch(() => null) as any
    const { id } = await params

    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userProfile } = await supabase
      .from('users')
      .select('id, organization_id, role_code')
      .eq('id', user.id)
      .single()

    if (!userProfile) return NextResponse.json({ error: 'User profile not found' }, { status: 400 })

    const { data: adjustment } = await admin
      .from('stock_adjustments')
      .select('id, organization_id, target_manufacturer_org_id, manufacturer_status, stock_adjustment_items(id)')
      .eq('id', id)
      .single()

    if (!adjustment) return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
    if (userProfile.role_code !== 'SA' && userProfile.organization_id !== adjustment.organization_id) {
      return NextResponse.json({ error: 'Not allowed to edit this issue' }, { status: 403 })
    }
    if (normalizeManufacturerWorkflowStatus(adjustment.manufacturer_status) !== 'draft') {
      return NextResponse.json({ error: 'Only draft issues can be edited' }, { status: 400 })
    }

    const reasonCode = String(body.reason_code || '').trim()
    const variantId = String(body.variant_id || '').trim()
    const quantity = Number(body.quantity_affected || 0)
    const notes = String(body.notes || '').trim()
    const unitCost = body.unit_cost != null ? Number(body.unit_cost) : null
    const proofImages = Array.isArray(body.proof_images) ? body.proof_images.filter((url: any) => typeof url === 'string' && url.trim()) : []

    if (!['quality_issue', 'return_to_supplier', 'damaged_goods'].includes(reasonCode)) {
      return NextResponse.json({ error: 'Invalid reason_code' }, { status: 400 })
    }
    if (!variantId) return NextResponse.json({ error: 'variant_id is required' }, { status: 400 })
    if (!notes) return NextResponse.json({ error: 'notes is required' }, { status: 400 })
    if (!quantity || quantity <= 0) return NextResponse.json({ error: 'quantity_affected must be > 0' }, { status: 400 })
    if (proofImages.length === 0) {
      return NextResponse.json({ error: 'At least one evidence attachment is required' }, { status: 400 })
    }

    const { data: reason } = await admin
      .from('stock_adjustment_reasons')
      .select('id')
      .eq('reason_code', reasonCode)
      .single()

    if (!reason) return NextResponse.json({ error: `Reason ${reasonCode} not found` }, { status: 400 })

    let manufacturerOrgId = body.target_manufacturer_org_id || null
    if (!manufacturerOrgId) {
      const { data: variant } = await admin
        .from('product_variants')
        .select('product_id')
        .eq('id', variantId)
        .single()
      if (!variant?.product_id) {
        return NextResponse.json({ error: 'Selected product variant could not be found' }, { status: 400 })
      }

      const { data: product } = await admin
        .from('products')
        .select('manufacturer_id')
        .eq('id', variant.product_id)
        .single()

      manufacturerOrgId = product?.manufacturer_id || null
    }

    const affectedQuantity = Math.abs(quantity)
    const { data: inventorySnapshot } = await admin
      .from('product_inventory')
      .select('quantity_on_hand')
      .eq('organization_id', adjustment.organization_id)
      .eq('variant_id', variantId)
      .maybeSingle()

    const systemQuantity = Math.max(Number((inventorySnapshot as any)?.quantity_on_hand ?? affectedQuantity), affectedQuantity)
    const physicalQuantity = Math.max(systemQuantity - affectedQuantity, 0)

    const { error: adjustmentUpdateError } = await admin
      .from('stock_adjustments')
      .update({
        reason_id: (reason as any).id,
        notes,
        proof_images: proofImages,
        status: 'draft',
        target_manufacturer_org_id: manufacturerOrgId,
        manufacturer_status: 'draft',
        manufacturer_assigned_at: null,
        manufacturer_acknowledged_by: null,
        manufacturer_acknowledged_at: null,
        manufacturer_notes: null,
      })
      .eq('id', id)

    if (adjustmentUpdateError) {
      return NextResponse.json({ error: adjustmentUpdateError.message }, { status: 500 })
    }

    const [firstItem, ...extraItems] = adjustment.stock_adjustment_items || []

    if (firstItem?.id) {
      const { error: itemUpdateError } = await admin
        .from('stock_adjustment_items')
        .update({
          variant_id: variantId,
          system_quantity: systemQuantity,
          physical_quantity: physicalQuantity,
          adjustment_quantity: -affectedQuantity,
          unit_cost: unitCost,
        })
        .eq('id', firstItem.id)

      if (itemUpdateError) {
        return NextResponse.json({ error: itemUpdateError.message }, { status: 500 })
      }
    } else {
      const { error: itemInsertError } = await admin
        .from('stock_adjustment_items')
        .insert({
          adjustment_id: id,
          variant_id: variantId,
          system_quantity: systemQuantity,
          physical_quantity: physicalQuantity,
          adjustment_quantity: -affectedQuantity,
          unit_cost: unitCost,
        })

      if (itemInsertError) {
        return NextResponse.json({ error: itemInsertError.message }, { status: 500 })
      }
    }

    if (extraItems.length > 0) {
      await admin
        .from('stock_adjustment_items')
        .delete()
        .in('id', extraItems.map((item: any) => item.id))
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('PATCH adjustment error', err)
    return NextResponse.json({ error: err.message || 'Unable to update the issue' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const { id } = await params

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userProfile } = await supabase
      .from('users')
      .select('organization_id, role_code')
      .eq('id', user.id)
      .single()

    if (!userProfile) return NextResponse.json({ error: 'User profile not found' }, { status: 400 })

    const { data: adjustment } = await admin
      .from('stock_adjustments')
      .select('id, organization_id, manufacturer_status')
      .eq('id', id)
      .single()

    if (!adjustment) return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
    if (userProfile.role_code !== 'SA' && userProfile.organization_id !== adjustment.organization_id) {
      return NextResponse.json({ error: 'Not allowed to delete this issue' }, { status: 403 })
    }
    if (normalizeManufacturerWorkflowStatus(adjustment.manufacturer_status) !== 'draft') {
      return NextResponse.json({ error: 'Only draft issues can be deleted' }, { status: 400 })
    }

    const { error: deleteError } = await admin
      .from('stock_adjustments')
      .delete()
      .eq('id', id)

    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('DELETE adjustment error', err)
    return NextResponse.json({ error: err.message || 'Unable to delete the issue' }, { status: 500 })
  }
}
