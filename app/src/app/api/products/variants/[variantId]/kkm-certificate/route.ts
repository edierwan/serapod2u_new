import { NextRequest, NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import {
  KKM_CERTIFICATE_BUCKET,
  normalizeKkmCertificateStoragePath,
} from '@/lib/products/kkm-certificate'

export const dynamic = 'force-dynamic'

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ variantId: string }> },
) {
  const context = await getStockConfigAdminContext()
  if (!context.ok) return errorResponse(context.error, context.status)

  const { variantId } = await params
  if (!variantId) return errorResponse('Invalid product variant', 400)

  const { data: certificate, error: metadataError } = await context.admin
    .from('variant_kkm_certificates')
    .select('product_variant_id, storage_path, file_name, mime_type')
    .eq('product_variant_id', variantId)
    .maybeSingle()
  if (metadataError) return errorResponse('Certificate metadata is unavailable', 500)
  if (!certificate) return errorResponse('Certificate not found', 404)

  const storagePath = normalizeKkmCertificateStoragePath(certificate.storage_path, variantId)
  if (!storagePath || certificate.product_variant_id !== variantId) {
    return errorResponse('Certificate storage reference is invalid', 400)
  }

  const { data: file, error: downloadError } = await context.admin.storage
    .from(KKM_CERTIFICATE_BUCKET)
    .download(storagePath)
  if (downloadError || !file) return errorResponse('Certificate file is unavailable', 404)

  const contentType = ALLOWED_MIME_TYPES.has(certificate.mime_type)
    ? certificate.mime_type
    : ALLOWED_MIME_TYPES.has(file.type) ? file.type : 'application/octet-stream'
  const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'
  const body = await file.arrayBuffer()

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(certificate.file_name)}`,
      'Content-Length': String(body.byteLength),
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
