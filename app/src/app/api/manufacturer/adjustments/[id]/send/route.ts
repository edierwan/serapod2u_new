import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from '@/app/api/settings/whatsapp/_utils'
import {
  DEFAULT_MANUFACTURER_ISSUE_TEMPLATE,
  getIssueTypeLabel,
  getVariantOrSkuLabel,
  normalizeManufacturerWorkflowStatus,
  renderQualityIssueTemplate,
} from '@/lib/quality-issues'
import { toProviderPhone } from '@/utils/phone'

function buildIssueCode(id: string, createdAt?: string | null) {
  const year = new Date(createdAt || Date.now()).getFullYear()
  return `QI-${year}-${id.slice(0, 5).toUpperCase()}`
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const body = await request.json().catch(() => ({})) as Record<string, any>
    const { id } = await params

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userProfile } = await supabase
      .from('users')
      .select('id, full_name, organization_id, role_code')
      .eq('id', user.id)
      .single()

    if (!userProfile) return NextResponse.json({ error: 'User profile not found' }, { status: 400 })

    const { data: adjustment, error: adjustmentError } = await admin
      .from('stock_adjustments')
      .select('id, organization_id, created_at, created_by, notes, status, target_manufacturer_org_id, manufacturer_status, stock_adjustment_items(id, variant_id, adjustment_quantity), stock_adjustment_reasons(reason_code, reason_name)')
      .eq('id', id)
      .single()

    if (adjustmentError || !adjustment) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
    }

    if (userProfile.role_code !== 'SA' && userProfile.organization_id !== adjustment.organization_id) {
      return NextResponse.json({ error: 'Not allowed to send this issue' }, { status: 403 })
    }

    if (normalizeManufacturerWorkflowStatus(adjustment.manufacturer_status) !== 'draft') {
      return NextResponse.json({ error: 'Only draft issues can be sent to the manufacturer' }, { status: 400 })
    }

    const firstItem = adjustment.stock_adjustment_items?.[0]
    if (!firstItem?.variant_id) {
      return NextResponse.json({ error: 'Issue item details are incomplete' }, { status: 400 })
    }

    const { data: variant } = await admin
      .from('product_variants')
      .select('id, product_id, variant_name, variant_code, manufacturer_sku')
      .eq('id', firstItem.variant_id)
      .single()

    if (!variant) {
      return NextResponse.json({ error: 'Selected product variant could not be loaded' }, { status: 400 })
    }

    const { data: product } = await admin
      .from('products')
      .select('id, product_name, product_code')
      .eq('id', variant.product_id)
      .single()

    const { data: manufacturer } = await admin
      .from('organizations')
      .select('id, org_name, contact_phone')
      .eq('id', adjustment.target_manufacturer_org_id)
      .single()

    if (!manufacturer?.contact_phone) {
      return NextResponse.json({ error: 'Manufacturer WhatsApp/phone number is not configured' }, { status: 400 })
    }

    const providerPhone = toProviderPhone(manufacturer.contact_phone)
    if (!providerPhone) {
      return NextResponse.json({ error: 'Manufacturer phone number is invalid' }, { status: 400 })
    }

    const { data: reporter } = await admin
      .from('users')
      .select('full_name, email')
      .eq('id', adjustment.created_by)
      .single()

    const issueCode = buildIssueCode(adjustment.id, adjustment.created_at)
    const issueLink = `${request.nextUrl.origin}/manufacturer/quality-issues?issueId=${adjustment.id}`
    const templateBody = DEFAULT_MANUFACTURER_ISSUE_TEMPLATE
    const text = renderQualityIssueTemplate(templateBody, {
      manufacturer_name: manufacturer.org_name || 'Manufacturer',
      product_name: product?.product_name || product?.product_code || 'Product',
      variant_name: variant.variant_name || '',
      sku: variant.manufacturer_sku || variant.variant_code || product?.product_code || '',
      variant_or_sku: getVariantOrSkuLabel({
        variantName: variant.variant_name,
        sku: variant.manufacturer_sku || variant.variant_code || product?.product_code,
      }),
      issue_type: getIssueTypeLabel((adjustment.stock_adjustment_reasons as any)?.reason_code),
      quantity_affected: Math.abs(firstItem.adjustment_quantity || 0),
      reported_by: reporter?.full_name || reporter?.email || userProfile.full_name || user.email || 'Serapod2U',
      notes: adjustment.notes || '-',
      issue_no: issueCode,
      issue_link: issueLink,
    })

    if (body.previewOnly) {
      return NextResponse.json({
        preview: {
          issueCode,
          manufacturerName: manufacturer.org_name,
          manufacturerPhone: manufacturer.contact_phone,
          templateBody,
          text,
          issueLink,
        },
      })
    }

    const sent = await sendWhatsAppMessage(admin as any, adjustment.organization_id, { to: providerPhone, text })
    const result = sent.response

    if (result?.success === false || result?.ok === false) {
      return NextResponse.json({ error: result?.error || 'WhatsApp send failed' }, { status: 502 })
    }

    const sentAt = new Date().toISOString()
    const { error: updateError } = await admin
      .from('stock_adjustments')
      .update({
        manufacturer_status: 'pending_manufacturer',
        manufacturer_assigned_at: sentAt,
      })
      .eq('id', adjustment.id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    await admin
      .from('stock_adjustment_manufacturer_actions')
      .insert({
        adjustment_id: adjustment.id,
        manufacturer_org_id: manufacturer.id,
        action_type: 'sent_to_manufacturer',
        notes: `WhatsApp sent to ${manufacturer.contact_phone}${result?.messageId || result?.message_id ? ` (message: ${result?.messageId || result?.message_id})` : ''}`,
        created_by: user.id,
        created_at: sentAt,
      })

    return NextResponse.json({
      success: true,
      sentAt,
      manufacturerStatus: 'pending_manufacturer',
      messageId: result?.messageId || result?.message_id || null,
    })
  } catch (err: any) {
    console.error('POST /api/manufacturer/adjustments/[id]/send error', err)
    return NextResponse.json({ error: err?.message || 'Unable to send the issue to the manufacturer' }, { status: 500 })
  }
}
