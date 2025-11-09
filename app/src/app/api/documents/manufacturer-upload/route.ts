import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || ''
    let documentId: string | null = null
    let companyId: string | null = null
    let replaceExisting = false
    let existingFileUrl: string | null = null
    let displayFileName: string | null = null
    let fileToUpload: File | null = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      fileToUpload = formData.get('file') as File | null
      documentId = (formData.get('documentId') as string) || null
      companyId = (formData.get('companyId') as string) || null
      displayFileName = (formData.get('fileName') as string) || fileToUpload?.name || null
      replaceExisting = (formData.get('replaceExisting') as string) === 'true'
      const existingValue = (formData.get('existingFileUrl') as string) || null
      existingFileUrl = existingValue && existingValue !== 'null' && existingValue !== 'undefined' && existingValue.trim() !== ''
        ? existingValue
        : null
    } else {
      const body = await request.json()
      documentId = body?.documentId ?? null
      companyId = body?.companyId ?? null
      replaceExisting = Boolean(body?.replaceExisting)
      const existingFromBody = body?.existingFileUrl ?? null
      existingFileUrl = existingFromBody && existingFromBody !== 'null' && existingFromBody !== 'undefined'
        ? existingFromBody
        : null
      displayFileName = body?.fileName ?? null
      fileToUpload = null
    }

    if (!documentId) {
      return NextResponse.json({ error: 'Missing documentId' }, { status: 400 })
    }

    if (!fileToUpload) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch user organization details
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    if (!(profile as any)?.organization_id) {
      return NextResponse.json({ error: 'User organization not found' }, { status: 403 })
    }

    // Fetch document to validate access
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, issued_by_org_id, issued_to_org_id, company_id')
      .eq('id', documentId)
      .maybeSingle()

    if (docError) {
      return NextResponse.json({ error: docError.message }, { status: 500 })
    }

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    const userOrg = (profile as any).organization_id
    const isAllowed =
      (document as any).issued_by_org_id === userOrg ||
      (document as any).issued_to_org_id === userOrg

    if (!isAllowed) {
      return NextResponse.json({ error: 'You do not have access to modify this document' }, { status: 403 })
    }

    const resolvedCompanyId = companyId || (document as any).company_id

    if (!resolvedCompanyId) {
      return NextResponse.json({ error: 'Unable to determine company for this document' }, { status: 400 })
    }

    const admin = createAdminClient() as SupabaseClient<any>

    const fileArrayBuffer = await fileToUpload.arrayBuffer()
    const fileBuffer = Buffer.from(fileArrayBuffer)
    const fileExtension = fileToUpload.name.includes('.')
      ? fileToUpload.name.split('.').pop()
      : undefined
    const generatedFileName = `manufacturer-doc-${documentId}-${Date.now()}-${randomUUID()}${
      fileExtension ? `.${fileExtension}` : ''
    }`

    const { data: uploadData, error: uploadError } = await admin.storage
      .from('order-documents')
      .upload(generatedFileName, fileBuffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: fileToUpload.type || 'application/octet-stream'
      })

    if (uploadError || !uploadData) {
      throw uploadError || new Error('Failed to upload file to storage')
    }

    const { error: insertError } = await admin
      .from('document_files')
      .insert({
        document_id: documentId,
        file_url: uploadData.path,
        file_name: displayFileName || fileToUpload.name,
        file_size: fileToUpload.size,
        mime_type: fileToUpload.type,
        company_id: resolvedCompanyId,
        uploaded_by: user.id
      })

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    if (replaceExisting) {
      if (existingFileUrl) {
        const { error: removeError } = await admin.storage
          .from('order-documents')
          .remove([existingFileUrl])

        if (removeError) {
          console.warn('Warning: Could not remove existing storage object', removeError)
        }
      }

      let cleanupQuery = admin
        .from('document_files')
        .delete()
        .eq('document_id', documentId)

      if (uploadData.path) {
        cleanupQuery = cleanupQuery.neq('file_url', uploadData.path)
      }

      const { error: cleanupError } = await cleanupQuery

      if (cleanupError) {
        console.warn('Warning: Could not remove previous document metadata', cleanupError)
      }
    }

    return NextResponse.json({ success: true, fileUrl: uploadData.path })
  } catch (error: any) {
    console.error('Manufacturer document upload error:', error)
    const message = error?.message || 'Failed to save manufacturer document metadata'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
