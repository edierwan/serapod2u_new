import { NextRequest, NextResponse } from 'next/server'
import { generatePdfForOrderDocument, type DocumentGenerateType } from '@/lib/documents/pdf-generation'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const orderId = searchParams.get('orderId')
    const type = searchParams.get('type') as DocumentGenerateType
    const documentId = searchParams.get('documentId') ?? undefined
    const noCache = searchParams.get('nocache') === 'true'

    if (!orderId || !type) {
      return NextResponse.json(
        { error: 'Missing orderId or type parameter' },
        { status: 400 }
      )
    }

    // Try to serve cached PDF first (unless nocache=true)
    if (!noCache && documentId) {
      try {
        const { createClient } = await import('@/lib/supabase/server')
        const supabase = await createClient()

        // Check if cached PDF exists in document_files
        const { data: cachedPdf, error: cacheError } = await supabase
          .from('document_files')
          .select('file_url, file_name, created_at')
          .eq('document_id', documentId)
          .eq('mime_type', 'application/pdf')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!cacheError && cachedPdf) {
          // Get document's last updated timestamp
          const { data: doc } = await supabase
            .from('documents')
            .select('updated_at, acknowledged_at')
            .eq('id', documentId)
            .single()

          // Use cached PDF if it's newer than document updates
          const docLastUpdate = new Date(doc?.acknowledged_at || doc?.updated_at || 0)
          const pdfGenerated = new Date(cachedPdf.created_at)

          if (pdfGenerated >= docLastUpdate) {
            console.log('📄 Serving cached PDF:', cachedPdf.file_name)
            
            // Download from storage
            const { data: pdfBlob, error: downloadError } = await supabase.storage
              .from('order-documents')
              .download(cachedPdf.file_url)

            if (!downloadError && pdfBlob) {
              const buffer = Buffer.from(await pdfBlob.arrayBuffer())
              return new NextResponse(buffer, {
                headers: {
                  'Content-Type': 'application/pdf',
                  'Content-Disposition': `attachment; filename="${cachedPdf.file_name}"`,
                  'X-Cache-Status': 'HIT'
                },
              })
            }
          } else {
            console.log('📄 Cached PDF outdated, regenerating...')
          }
        }
      } catch (cacheErr) {
        console.warn('Cache check failed, generating new PDF:', cacheErr)
      }
    }

    // Generate new PDF
    console.log('📄 Generating new PDF...')
    const { buffer, filename } = await generatePdfForOrderDocument(orderId, type, {
      documentId
    })

    // Cache the generated PDF if documentId is provided
    if (documentId && buffer) {
      try {
        const { createClient } = await import('@/lib/supabase/server')
        const { createClient: createServiceClient } = await import('@supabase/supabase-js')
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        // Use service role client for storage operations (bypasses RLS)
        const serviceSupabase = createServiceClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          {
            auth: {
              autoRefreshToken: false,
              persistSession: false
            }
          }
        )

        // Upload PDF to storage using service role
        const pdfFileName = `generated-pdf-${documentId}-${Date.now()}.pdf`
        const { data: uploadData, error: uploadError } = await serviceSupabase.storage
          .from('order-documents')
          .upload(pdfFileName, buffer, {
            contentType: 'application/pdf',
            cacheControl: '3600',
            upsert: false
          })

        if (uploadError) {
          console.error('Error uploading generated PDF to storage:', uploadError)
        } else if (uploadData) {
          // Save reference in document_files using service role (bypasses RLS)
          const { error: insertError } = await serviceSupabase
            .from('document_files')
            .insert({
              document_id: documentId,
              file_url: uploadData.path,
              file_name: filename,
              file_size: buffer.length,
              mime_type: 'application/pdf',
              company_id: null,
              uploaded_by: user?.id
            })
          
          if (insertError) {
            console.error('Error saving PDF cache reference:', insertError)
          } else {
            console.log('📄 PDF cached successfully:', filename)
          }
        }
      } catch (cacheErr) {
        console.error('Failed to cache PDF:', cacheErr)
        // Don't fail the request if caching fails
      }
    }

  return new NextResponse(buffer as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error('Error generating PDF:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate PDF' },
      { status: 500 }
    )
  }
}
