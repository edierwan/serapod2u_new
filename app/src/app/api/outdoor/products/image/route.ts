import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'

const MAX_BYTES = 5 * 1024 * 1024

function extensionFor(type: string) {
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/gif') return 'gif'
  return 'jpg'
}

/** POST — staff uploads a product photo. Saving the product is what emails subscribers. */
export async function POST(request: NextRequest) {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Choose a photo.' }, { status: 400 })
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Choose an image file.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Photo must be 5 MB or smaller.' }, { status: 400 })
    }

    const path = `outdoor/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extensionFor(file.type)}`
    const admin: any = createAdminClient()
    const { error } = await admin.storage.from('product-images').upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: false,
    })
    if (error) {
      console.error('[outdoor/products/image]', error)
      return NextResponse.json({ error: 'Could not upload the photo.' }, { status: 500 })
    }

    const { data } = admin.storage.from('product-images').getPublicUrl(path)
    if (!data?.publicUrl) {
      return NextResponse.json({ error: 'Could not upload the photo.' }, { status: 500 })
    }
    return NextResponse.json({ url: data.publicUrl })
  } catch (err) {
    console.error('[outdoor/products/image]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
