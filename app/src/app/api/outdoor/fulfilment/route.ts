import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { easyParcelSubmitOrder, isEasyParcelConfigured } from '@/lib/shipping/easyparcel'
import { toEasyParcelState } from '@/lib/shipping/malaysia-states'

async function requireOutdoorStaff(supabase: any) {
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return null

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('users')
    .select('id, organization_id, organizations!fk_users_organization(id, org_type_code), roles(role_level, role_code)')
    .eq('id', user.id)
    .single()

  if (!profile) return null
  const orgType = (profile.organizations as any)?.org_type_code
  const role = (profile.roles as any) || {}
  const roleLevel = Number(role.role_level ?? 99)
  const roleCode = String(role.role_code || '').toLowerCase()
  const allowed =
    orgType === 'HQ' &&
    (roleLevel <= 30 || ['super_admin', 'admin', 'org_admin', 'warehouse', 'fulfilment'].includes(roleCode))

  if (!allowed) return null
  return { userId: user.id, orgId: profile.organization_id }
}

/** GET — Outdoor paid/processing orders for fulfilment desk. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const staff = await requireOutdoorStaff(supabase)
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'fulfilment'
    const search = searchParams.get('search') || ''

    const admin: any = createAdminClient()
    let query = admin
      .from('storefront_orders')
      .select(
        'id, order_ref, status, customer_name, customer_email, customer_phone, shipping_address, total_amount, shipping_amount, shipping_courier_name, shipping_service_id, shipping_tracking_no, easyparcel_order_no, paid_at, created_at, storefront_order_items(id, product_name, variant_name, quantity, unit_price, subtotal)',
      )
      .eq('sales_channel', 'outdoor')
      .order('created_at', { ascending: false })
      .limit(100)

    if (status === 'fulfilment') {
      query = query.in('status', ['paid', 'processing', 'shipped'])
    } else if (status !== 'all') {
      query = query.eq('status', status)
    }

    if (search) {
      query = query.or(
        `order_ref.ilike.%${search}%,customer_name.ilike.%${search}%,customer_email.ilike.%${search}%,shipping_tracking_no.ilike.%${search}%`,
      )
    }

    const { data, error } = await query
    if (error) {
      console.error('[outdoor/fulfilment] GET', error)
      return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 })
    }

    return NextResponse.json({
      orders: data || [],
      easyParcelConfigured: isEasyParcelConfigured(),
    })
  } catch (err) {
    console.error('[outdoor/fulfilment] GET', err)
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 })
  }
}

/** PUT — update status and/or create EasyParcel shipment. */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const staff = await requireOutdoorStaff(supabase)
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const id = String(body.id || '').trim()
    const action = String(body.action || '').trim()
    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 })
    }

    const admin: any = createAdminClient()
    const { data: order, error: loadErr } = await admin
      .from('storefront_orders')
      .select('*, storefront_order_items(product_name, quantity)')
      .eq('id', id)
      .eq('sales_channel', 'outdoor')
      .single()

    if (loadErr || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (action === 'mark_processing') {
      if (!['paid', 'processing'].includes(order.status)) {
        return NextResponse.json({ error: 'Order must be paid first' }, { status: 400 })
      }
      const { data, error } = await admin
        .from('storefront_orders')
        .update({ status: 'processing' })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return NextResponse.json({ order: data })
    }

    if (action === 'set_tracking') {
      const tracking = String(body.trackingNo || '').trim()
      const courier = String(body.courierName || order.shipping_courier_name || '').trim()
      if (!tracking) {
        return NextResponse.json({ error: 'Tracking number required' }, { status: 400 })
      }
      const { data, error } = await admin
        .from('storefront_orders')
        .update({
          status: 'shipped',
          shipping_tracking_no: tracking,
          shipping_courier_name: courier || null,
        })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return NextResponse.json({ order: data })
    }

    if (action === 'ship_easyparcel') {
      if (!['paid', 'processing'].includes(order.status)) {
        return NextResponse.json({ error: 'Order must be paid or processing' }, { status: 400 })
      }
      const serviceId = String(body.serviceId || order.shipping_service_id || '').trim()
      if (!serviceId) {
        return NextResponse.json({ error: 'No shipping service selected on this order' }, { status: 400 })
      }
      if (!isEasyParcelConfigured()) {
        return NextResponse.json({ error: 'EasyParcel is not configured' }, { status: 503 })
      }

      const addr = order.shipping_address || {}
      const items = order.storefront_order_items || []
      const content = items
        .map((i: any) => `${i.product_name}×${i.quantity}`)
        .join(', ')
        .slice(0, 35) || 'Outdoor order'

      const submitted = await easyParcelSubmitOrder({
        serviceId,
        content,
        value: Number(order.total_amount) || 0,
        reference: order.order_ref,
        receiver: {
          name: order.customer_name,
          phone: order.customer_phone,
          email: order.customer_email,
          addr1: String(addr.line1 || ''),
          addr2: String(addr.line2 || ''),
          city: String(addr.city || ''),
          state: toEasyParcelState(String(addr.state || '')),
          postcode: String(addr.postcode || ''),
          country: 'MY',
        },
      })

      if (!submitted.ok) {
        return NextResponse.json({ error: submitted.error }, { status: 502 })
      }

      const { data, error } = await admin
        .from('storefront_orders')
        .update({
          status: 'shipped',
          easyparcel_order_no: submitted.orderNo,
          shipping_tracking_no: submitted.awb || order.shipping_tracking_no,
          shipping_service_id: serviceId,
        })
        .eq('id', id)
        .select('*')
        .single()

      if (error) throw error
      return NextResponse.json({
        order: data,
        easyparcel: { orderNo: submitted.orderNo, awb: submitted.awb },
      })
    }

    if (action === 'mark_delivered') {
      if (order.status !== 'shipped') {
        return NextResponse.json({ error: 'Order must be shipped first' }, { status: 400 })
      }
      const { data, error } = await admin
        .from('storefront_orders')
        .update({ status: 'delivered' })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return NextResponse.json({ order: data })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[outdoor/fulfilment] PUT', err)
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
  }
}
