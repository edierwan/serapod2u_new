import { NextRequest, NextResponse } from 'next/server'
import { generatePdfForOrderDocument, type DocumentGenerateType } from '@/lib/documents/pdf-generation'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const orderId = searchParams.get('orderId')
    const type = searchParams.get('type') as DocumentGenerateType
  const documentId = searchParams.get('documentId') ?? undefined

    if (!orderId || !type) {
      return NextResponse.json(
        { error: 'Missing orderId or type parameter' },
        { status: 400 }
      )
    }

    const { buffer, filename } = await generatePdfForOrderDocument(orderId, type, {
      documentId
    })

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
