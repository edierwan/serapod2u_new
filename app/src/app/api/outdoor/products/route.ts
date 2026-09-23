import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import { resolveOutdoorCatalogScope } from '@/lib/outdoor/catalog'
import { emailOutdoorSubscribers } from '@/lib/outdoor/notify-subscribers'

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]!))
}

/** POST — staff adds a new Outdoor-only product and emails newsletter subscribers. */
export async function POST(request: NextRequest) {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const name = String(body.name || '').trim().slice(0, 140)
    const color = String(body.color || '').trim().slice(0, 40)
    const description = String(body.description || '').trim().slice(0, 2000)
    const price = Number(body.price)
    if (!name || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: 'Enter a product name and a price above 0.' }, { status: 400 })
    }

    const scope = await resolveOutdoorCatalogScope()
    const categoryId = scope.categoryIds[0]
    if (!categoryId) {
      return NextResponse.json({ error: 'Outdoor category is not set, so a new product cannot be added.' }, { status: 400 })
    }

    const admin: any = createAdminClient()
    const code = `OUT-${Date.now().toString(36).toUpperCase()}`
    const { data: product, error: productError } = await admin.from('products').insert({
      product_name: name,
      product_code: code,
      product_description: description || null,
      short_description: description.slice(0, 180) || null,
      category_id: categoryId,
      brand_id: scope.brandId,
      is_active: true,
      outdoor_only: true,
      created_by: staff.userId,
    }).select('id').single()

    if (productError || !product) {
      console.error('[outdoor/products] insert', productError)
      return NextResponse.json({ error: 'Could not add the product. Apply the outdoor_only column first.' }, { status: 500 })
    }

    const { error: variantError } = await admin.from('product_variants').insert({
      product_id: product.id,
      variant_name: color || 'Default',
      variant_code: `${code}-1`,
      suggested_retail_price: Math.round(price * 100) / 100,
      is_active: true,
      is_default: true,
      sort_order: 0,
      attributes: color ? { color } : {},
    })

    if (variantError) {
      console.error('[outdoor/products] variant', variantError)
      await admin.from('products').delete().eq('id', product.id)
      return NextResponse.json({ error: 'Could not add the product price.' }, { status: 500 })
    }

    const text = [name, color ? `Color: ${color}` : '', `Price: RM ${price.toFixed(2)}`, description].filter(Boolean).join('\n')
    const html = `<p><strong>New product</strong></p><p>${escapeHtml(name)}${color ? `<br>Color: ${escapeHtml(color)}` : ''}<br>RM ${price.toFixed(2)}</p>${description ? `<p>${escapeHtml(description)}</p>` : ''}`
    const mailed = await emailOutdoorSubscribers(admin, {
      subject: `SeraOutdoor: ${name}`,
      text,
      html,
    })

    await admin.from('outdoor_admin_updates').insert({
      kind: 'product',
      title: name,
      body: text,
      created_by: staff.userId,
      emailed_count: mailed.emailed,
    })

    return NextResponse.json({ ok: true, productId: product.id, emailed: mailed.emailed })
  } catch (err) {
    console.error('[outdoor/products]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
