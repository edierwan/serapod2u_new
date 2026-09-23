import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import { resolveOutdoorCatalogScope } from '@/lib/outdoor/catalog'
import { emailOutdoorSubscribers } from '@/lib/outdoor/notify-subscribers'
import { outdoorStaticImage } from '@/lib/outdoor/merch'

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]!))
}

const PRODUCT_SELECT = `
  id,
  product_name,
  product_description,
  category_id,
  brand_id,
  product_variants (
    id,
    variant_name,
    suggested_retail_price,
    is_default,
    sort_order,
    attributes
  )
`

function pickVariant(variants: any[] | null | undefined) {
  const rows = variants || []
  return rows.find((row) => row.is_default) || [...rows].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))[0] || null
}

function colorOf(variant: any) {
  const fromAttributes = variant?.attributes && typeof variant.attributes === 'object' ? String(variant.attributes.color || '').trim() : ''
  if (fromAttributes) return fromAttributes
  const name = String(variant?.variant_name || '').trim()
  return name && name.toLowerCase() !== 'default' ? name : ''
}

function savedImage(variant: any) {
  const custom = variant?.attributes && typeof variant.attributes === 'object'
    ? String(variant.attributes.outdoor_image || '').trim()
    : ''
  return custom
}

function previewImage(name: string, variant: any) {
  return savedImage(variant) || outdoorStaticImage(name, colorOf(variant) || '#76232F') || ''
}

function allowedImage(url: string) {
  if (!url) return true
  if (url.startsWith('/outdoor/products/')) return true
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.pathname.includes('/product-images/')
  } catch {
    return false
  }
}

async function rememberProductImage(admin: any, productId: string, imageUrl: string) {
  if (!imageUrl || imageUrl.startsWith('/outdoor/')) return
  const { error } = await admin.from('product_images').insert({
    product_id: productId,
    image_url: imageUrl,
    image_type: 'PRODUCT',
    is_primary: true,
  })
  if (error) console.error('[outdoor/products] image row', error)
}

function toEditorProduct(row: any) {
  const variant = pickVariant(row.product_variants)
  return {
    id: row.id,
    name: row.product_name || '',
    description: row.product_description || '',
    price: Number(variant?.suggested_retail_price || 0),
    color: colorOf(variant),
    imageUrl: previewImage(row.product_name || '', variant),
  }
}

function inOutdoorScope(row: { category_id?: string | null; brand_id?: string | null; outdoor_only?: boolean }, scope: { categoryIds: string[]; brandId: string | null }) {
  if (row.outdoor_only) return true
  if (row.category_id && scope.categoryIds.includes(String(row.category_id))) return true
  return Boolean(scope.brandId && row.brand_id && String(row.brand_id) === scope.brandId)
}

async function loadOutdoorProducts(admin: any, scope: { categoryIds: string[]; brandId: string | null }) {
  const queries = []
  if (scope.categoryIds.length > 0) {
    queries.push(admin.from('products').select(PRODUCT_SELECT).in('category_id', scope.categoryIds).eq('is_active', true).order('product_name').limit(80))
  }
  if (scope.brandId) {
    queries.push(admin.from('products').select(PRODUCT_SELECT).eq('brand_id', scope.brandId).eq('is_active', true).order('product_name').limit(80))
  }
  queries.push(admin.from('products').select(`${PRODUCT_SELECT}, outdoor_only`).eq('outdoor_only', true).eq('is_active', true).order('product_name').limit(80))

  const results = await Promise.all(queries)
  const byId = new Map<string, any>()
  let sawRows = false
  let lastError: { message?: string } | null = null
  for (const result of results) {
    if (result.error) {
      if (/outdoor_only/i.test(result.error.message || '')) continue
      lastError = result.error
      continue
    }
    sawRows = true
    for (const row of result.data || []) byId.set(row.id, row)
  }
  if (!sawRows && lastError) throw lastError
  return [...byId.values()].map(toEditorProduct)
}

/** GET — outdoor products the staff can edit. */
export async function GET() {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin: any = createAdminClient()
    const scope = await resolveOutdoorCatalogScope()
    const [{ count }, products] = await Promise.all([
      admin.from('outdoor_newsletter_subscribers').select('id', { count: 'exact', head: true }),
      loadOutdoorProducts(admin, scope),
    ])
    return NextResponse.json({ products, subscribers: count || 0 })
  } catch (err) {
    console.error('[outdoor/products GET]', err)
    return NextResponse.json({ error: 'Could not load products.' }, { status: 500 })
  }
}

/** PATCH — staff edits an outdoor product. Subscribers are emailed automatically. */
export async function PATCH(request: NextRequest) {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const id = String(body.id || '').trim()
    const name = String(body.name || '').trim().slice(0, 140)
    const color = String(body.color || '').trim().slice(0, 80)
    const description = String(body.description || '').trim().slice(0, 2000)
    const imageUrl = String(body.imageUrl || '').trim().slice(0, 500)
    const price = Number(body.price)
    if (!id || !name || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: 'Enter a product name and a price above 0.' }, { status: 400 })
    }
    if (!allowedImage(imageUrl)) {
      return NextResponse.json({ error: 'That photo could not be saved.' }, { status: 400 })
    }

    const admin: any = createAdminClient()
    const scope = await resolveOutdoorCatalogScope()
    let existingQuery = await admin.from('products').select('id, category_id, brand_id, outdoor_only, product_variants(id, is_default, sort_order, attributes)').eq('id', id).maybeSingle()
    if (existingQuery.error && /outdoor_only/i.test(existingQuery.error.message || '')) {
      existingQuery = await admin.from('products').select('id, category_id, brand_id, product_variants(id, is_default, sort_order, attributes)').eq('id', id).maybeSingle()
    }
    const existing = existingQuery.data
    if (existingQuery.error || !existing || !inOutdoorScope(existing, scope)) {
      return NextResponse.json({ error: 'That product is not on the outdoor shop.' }, { status: 404 })
    }

    const { error: productError } = await admin.from('products').update({
      product_name: name,
      product_description: description || null,
      short_description: description.slice(0, 180) || null,
    }).eq('id', id)
    if (productError) {
      console.error('[outdoor/products] update', productError)
      return NextResponse.json({ error: 'Could not save the product.' }, { status: 500 })
    }

    const variant = pickVariant(existing.product_variants)
    const attributes = { ...(variant?.attributes && typeof variant.attributes === 'object' ? variant.attributes : {}) }
    if (color) attributes.color = color
    else delete attributes.color
    const customPhoto = imageUrl && !imageUrl.startsWith('/outdoor/') ? imageUrl : ''
    if (customPhoto) attributes.outdoor_image = customPhoto
    const variantPatch: Record<string, unknown> = {
      variant_name: color || 'Default',
      suggested_retail_price: Math.round(price * 100) / 100,
      attributes,
    }
    if (customPhoto) variantPatch.image_url = customPhoto
    const variantWrite = variant
      ? await admin.from('product_variants').update(variantPatch).eq('id', variant.id)
      : await admin.from('product_variants').insert({
          product_id: id,
          ...variantPatch,
          variant_code: `OUT-${Date.now().toString(36).toUpperCase()}-1`,
          is_active: true,
          is_default: true,
          sort_order: 0,
        })
    if (variantWrite.error) {
      console.error('[outdoor/products] variant update', variantWrite.error)
      return NextResponse.json({ error: 'Could not save the product price.' }, { status: 500 })
    }
    if (customPhoto) await rememberProductImage(admin, id, customPhoto)

    const text = [`Updated: ${name}`, color ? `Color: ${color}` : '', `Price: RM ${price.toFixed(2)}`, description].filter(Boolean).join('\n')
    const html = `<p><strong>Product update</strong></p><p>${escapeHtml(name)}${color ? `<br>Color: ${escapeHtml(color)}` : ''}<br>RM ${price.toFixed(2)}</p>${description ? `<p>${escapeHtml(description)}</p>` : ''}`
    const mailed = await emailOutdoorSubscribers(admin, {
      subject: `SeraOutdoor update: ${name}`,
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

    return NextResponse.json({ ok: true, emailed: mailed.emailed })
  } catch (err) {
    console.error('[outdoor/products PATCH]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** POST — staff adds a new Outdoor-only product and emails newsletter subscribers. */
export async function POST(request: NextRequest) {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const name = String(body.name || '').trim().slice(0, 140)
    const color = String(body.color || '').trim().slice(0, 80)
    const description = String(body.description || '').trim().slice(0, 2000)
    const imageUrl = String(body.imageUrl || '').trim().slice(0, 500)
    const price = Number(body.price)
    if (!allowedImage(imageUrl)) {
      return NextResponse.json({ error: 'That photo could not be saved.' }, { status: 400 })
    }
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
      ...(imageUrl && !imageUrl.startsWith('/outdoor/') ? { image_url: imageUrl } : {}),
      attributes: {
        ...(color ? { color } : {}),
        ...(imageUrl && !imageUrl.startsWith('/outdoor/') ? { outdoor_image: imageUrl } : {}),
      },
    })

    if (variantError) {
      console.error('[outdoor/products] variant', variantError)
      await admin.from('products').delete().eq('id', product.id)
      return NextResponse.json({ error: 'Could not add the product price.' }, { status: 500 })
    }
    if (imageUrl && !imageUrl.startsWith('/outdoor/')) await rememberProductImage(admin, product.id, imageUrl)

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
