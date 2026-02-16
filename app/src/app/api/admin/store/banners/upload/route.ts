import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/store/banners/upload
 * Upload a banner image to 'store-banners' bucket.
 * Returns the public URL.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size must be under 5MB' }, { status: 400 })
    }

    // Generate unique filename
    const ext = file.name.split('.').pop() || 'jpg'
    const fileName = `banners/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

    const adminClient = createAdminClient()

    const { data: uploadData, error: uploadErr } = await adminClient.storage
      .from('store-banners')
      .upload(fileName, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      })

    if (uploadErr) {
      console.error('[banner/upload] Upload error:', uploadErr)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    const { data: { publicUrl } } = adminClient.storage
      .from('store-banners')
      .getPublicUrl(uploadData.path)

    return NextResponse.json({ url: publicUrl })
  } catch (err) {
    console.error('[banner/upload] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
