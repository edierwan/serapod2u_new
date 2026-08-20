import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSerappActor } from '@/lib/serapp/chat-auth'
import { getAccessibleConversation } from '@/lib/serapp/conversation-service'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf']
const STORAGE_BUCKET = 'documents'

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSerappActor()
    if (!actor.ok) return actor.error

    const { id } = await context.params
    const admin = createAdminClient()
    const conversation = await getAccessibleConversation(admin, id, {
      userId: actor.userId,
      orgId: actor.orgId,
      isHqSupport: actor.access.isHqSupport,
    })
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required.' }, { status: 400 })
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Attachment must be between 1 byte and 10MB.' }, { status: 400 })
    }

    const mimeType = file.type || 'application/octet-stream'
    const allowed = ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
    if (!allowed) {
      return NextResponse.json({ error: 'Only images and PDF attachments are allowed.' }, { status: 400 })
    }

    const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : ''
    const base = sanitizeFileName(file.name.replace(/\.[^.]+$/, ''))
    const filename = `${Date.now()}-${randomUUID().slice(0, 8)}-${base}${ext}`
    const path = `serapp-chat/${id}/${filename}`

    const bytes = Buffer.from(await file.arrayBuffer())
    const { error: uploadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(path, bytes, {
        upsert: false,
        contentType: mimeType,
        cacheControl: '3600',
      })

    if (uploadError) {
      throw uploadError
    }

    const { data: signed, error: signError } = await admin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24)

    if (signError) throw signError

    return NextResponse.json({
      ok: true,
      attachment: {
        bucket: STORAGE_BUCKET,
        path,
        name: file.name,
        size: file.size,
        mimeType,
        url: signed?.signedUrl || null,
      },
    })
  } catch (error) {
    console.error('[serapp/conversations/:id/attachments POST]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to upload attachment.',
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
