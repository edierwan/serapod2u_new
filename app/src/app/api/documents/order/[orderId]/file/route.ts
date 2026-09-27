import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { guardUserOperation } from '@/lib/security-access/operation'
import {
  ORDER_DOCUMENT_MAX_BYTES,
  ORDER_DOCUMENTS_BUCKET,
  orderDocumentPath,
  safeOrderDocumentFileName,
} from '@/lib/storage/order-documents-bucket'

interface RouteContext { params: Promise<{ orderId: string }> }

async function authorizedDocument(supabase: any, documentId: string, orderId: string) {
  const { data, error } = await supabase
    .from('documents')
    .select('id, order_id, company_id')
    .eq('id', documentId)
    .eq('order_id', orderId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { orderId } = await context.params
    const requestedPath = request.nextUrl.searchParams.get('path') || ''
    const path = orderDocumentPath(requestedPath, orderId)
    if (!path) return NextResponse.json({ error: 'Invalid document path' }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = await guardUserOperation(user.id, 'supply_chain.document.manage')
    if (denied) return denied

    const admin = createAdminClient()
    const { data: file, error: fileError } = await admin
      .from('document_files')
      .select('document_id, file_name, mime_type')
      .eq('file_url', path)
      .maybeSingle()
    if (fileError) throw fileError
    if (!file) return NextResponse.json({ error: 'Document file not found' }, { status: 404 })

    const document = await authorizedDocument(supabase, file.document_id, orderId)
    if (!document) return NextResponse.json({ error: 'Document file not found' }, { status: 404 })

    const { data: blob, error: downloadError } = await admin.storage
      .from(ORDER_DOCUMENTS_BUCKET)
      .download(path)
    if (downloadError || !blob) return NextResponse.json({ error: 'Document file not found' }, { status: 404 })

    return new NextResponse(await blob.arrayBuffer(), {
      headers: {
        'Content-Type': file.mime_type || blob.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeOrderDocumentFileName(file.file_name || path.split('/').pop() || 'document')}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error: any) {
    console.error('Order document download failed:', error)
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { orderId } = await context.params
    const form = await request.formData()
    const file = form.get('file') as File | null
    const documentId = String(form.get('documentId') || '')
    const kind = safeOrderDocumentFileName(String(form.get('kind') || 'attachment')).replace(/\.[^.]+$/, '')
    const existingReference = String(form.get('existingFileUrl') || '')
    if (!file || !documentId) return NextResponse.json({ error: 'File and documentId are required' }, { status: 400 })
    if (file.size > ORDER_DOCUMENT_MAX_BYTES) return NextResponse.json({ error: 'File exceeds the 10MB limit' }, { status: 413 })
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return NextResponse.json({ error: 'Only PDF and image files are allowed' }, { status: 415 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = await guardUserOperation(user.id, 'supply_chain.document.manage')
    if (denied) return denied
    const document = await authorizedDocument(supabase, documentId, orderId)
    if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    const extension = safeOrderDocumentFileName(file.name).split('.').pop()?.toLowerCase() || 'bin'
    const path = `${orderId}/${kind}-${randomUUID()}.${extension}`
    const admin = createAdminClient()
    const { error: uploadError } = await admin.storage.from(ORDER_DOCUMENTS_BUCKET).upload(
      path,
      Buffer.from(await file.arrayBuffer()),
      { contentType: file.type, cacheControl: '3600', upsert: false }
    )
    if (uploadError) throw uploadError

    const { error: insertError } = await admin.from('document_files').insert({
      document_id: documentId,
      file_url: path,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      company_id: document.company_id,
      uploaded_by: user.id,
    })
    if (insertError) {
      await admin.storage.from(ORDER_DOCUMENTS_BUCKET).remove([path])
      throw insertError
    }

    const oldPath = orderDocumentPath(existingReference, orderId)
    if (oldPath && oldPath !== path) {
      const { data: oldFile } = await admin.from('document_files')
        .select('document_id').eq('file_url', oldPath).eq('document_id', documentId).maybeSingle()
      if (oldFile) {
        await admin.from('document_files').delete().eq('file_url', oldPath).eq('document_id', documentId)
        await admin.storage.from(ORDER_DOCUMENTS_BUCKET).remove([oldPath])
      }
    }

    return NextResponse.json({ success: true, fileUrl: path })
  } catch (error: any) {
    console.error('Order document upload failed:', error)
    return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 })
  }
}
