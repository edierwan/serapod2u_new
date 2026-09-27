import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { guardUserOperation } from '@/lib/security-access/operation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

function safeExtension(file: File) {
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : null
  return extension && /^[a-z0-9]{1,8}$/.test(extension) ? `.${extension}` : ''
}

/**
 * Upload quality evidence with the service role only after authenticating and
 * authorizing the actor. The response is a stable object path, not a public or
 * generic signed URL; display remains behind the issue-specific evidence GET.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const saDenied = await guardUserOperation(user.id, 'manufacturing.adjustment.manage')
    if (saDenied) return saDenied

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Evidence must be between 1 byte and 10MB' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Only PDF and supported image evidence is allowed' }, { status: 400 })
    }

    const path = `quality_issues/${user.id}/${randomUUID()}${safeExtension(file)}`
    const admin = createAdminClient()
    const bytes = Buffer.from(await file.arrayBuffer())
    const { error: uploadError } = await admin.storage.from('documents').upload(path, bytes, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    })

    if (uploadError) {
      console.error('Quality evidence upload failed', { userId: user.id, error: uploadError.message })
      return NextResponse.json({ error: 'Unable to upload evidence' }, { status: 500 })
    }

    return NextResponse.json({ path }, { status: 201 })
  } catch (error) {
    console.error('POST /api/manufacturer/adjustments/evidence error', error)
    return NextResponse.json({ error: 'Unable to upload evidence' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
