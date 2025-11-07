import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import ExcelJS from 'exceljs'

/**
 * Get the base URL for QR code tracking
 */
function getBaseURL(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://www.serapod2u.com'
}

/**
 * Generate tracking URL for a QR code
 */
function generateTrackingURL(code: string): string {
  const baseUrl = getBaseURL()
  return `${baseUrl}/track/product/${code}`
}

/**
 * Download Excel with all QR codes and tracking URLs for a specific order
 * GET /api/journey/download-qr-excel?order_id=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams
    const orderId = searchParams.get('order_id')

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        organizations!orders_buyer_org_id_fkey (
          org_name
        )
      `)
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Get batches for this order
    const { data: batches, error: batchError } = await supabase
      .from('qr_batches')
      .select('*')
      .eq('order_id', orderId)

    if (batchError) {
      throw batchError
    }

    if (!batches || batches.length === 0) {
      return NextResponse.json(
        { error: 'No QR codes found for this order' },
        { status: 404 }
      )
    }

    const batchIds = batches.map(b => b.id)

    // Get all QR codes for these batches
    const { data: qrCodes, error: qrError } = await supabase
      .from('qr_codes')
      .select(`
        *,
        products (
          product_name,
          product_code
        ),
        product_variants (
          variant_name
        ),
        qr_master_codes (
          case_number,
          master_code
        )
      `)
      .in('batch_id', batchIds)
      .order('sequence_number', { ascending: true })

    if (qrError) {
      throw qrError
    }

    const codes = qrCodes || []
    const orgData = Array.isArray(order.organizations) ? order.organizations[0] : order.organizations

    // Create workbook with ExcelJS
    const workbook = new ExcelJS.Workbook()

    // Sheet 1: Summary
    const summarySheet = workbook.addWorksheet('Summary')
    summarySheet.columns = [
      { key: 'label', width: 30 },
      { key: 'value', width: 40 }
    ]
    
    summarySheet.addRows([
      ['Journey QR Codes Report'],
      ['Generated:', new Date().toLocaleString()],
      [],
      ['Order Information'],
      ['Order Number:', order.order_no || 'N/A'],
      ['Buyer:', orgData?.org_name || 'N/A'],
      ['Order Date:', order.created_at ? new Date(order.created_at).toLocaleDateString() : 'N/A'],
      [],
      ['QR Code Statistics'],
      ['Total QR Codes:', codes.length],
      ['Scanned Codes:', codes.filter(c => ['opened', 'shipped_distributor', 'received_warehouse', 'packed'].includes(c.status)).length],
      ['Generated Codes:', codes.filter(c => c.status === 'generated').length]
    ])

    // Sheet 2: All QR Codes with Tracking URLs
    const qrSheet = workbook.addWorksheet('QR Codes & URLs')
    qrSheet.columns = [
      { header: '#', key: 'index', width: 5 },
      { header: 'QR Code', key: 'code', width: 50 },
      { header: 'Tracking URL', key: 'url', width: 70 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Is Scanned', key: 'scanned', width: 12 },
      { header: 'Product', key: 'product', width: 25 },
      { header: 'Variant', key: 'variant', width: 20 },
      { header: 'Sequence', key: 'sequence', width: 10 },
      { header: 'Case Number', key: 'caseNum', width: 12 },
      { header: 'Master Code', key: 'master', width: 35 },
      { header: 'Last Scanned', key: 'lastScanned', width: 20 },
      { header: 'Blocked', key: 'blocked', width: 10 }
    ]

    codes.forEach((code: any, index: number) => {
      const masterCodeData = Array.isArray(code.qr_master_codes) ? code.qr_master_codes[0] : code.qr_master_codes
      const isScanned = ['opened', 'shipped_distributor', 'received_warehouse', 'packed'].includes(code.status)
      
      qrSheet.addRow({
        index: index + 1,
        code: code.code,
        url: generateTrackingURL(code.code),
        status: code.status,
        scanned: isScanned ? 'Yes' : 'No',
        product: code.products?.product_name || 'N/A',
        variant: code.product_variants?.variant_name || 'N/A',
        sequence: code.sequence_number,
        caseNum: masterCodeData?.case_number || 'Unassigned',
        master: masterCodeData?.master_code || 'Unassigned',
        lastScanned: code.last_scanned_at ? new Date(code.last_scanned_at).toLocaleString() : 'Never',
        blocked: code.is_blocked ? 'Yes' : 'No'
      })
    })

    // Sheet 3: Valid Links Only (for consumer distribution)
    const validLinksSheet = workbook.addWorksheet('Valid Links')
    validLinksSheet.columns = [
      { header: '#', key: 'index', width: 5 },
      { header: 'QR Code', key: 'code', width: 50 },
      { header: 'Consumer Tracking URL', key: 'url', width: 70 },
      { header: 'Product', key: 'product', width: 25 },
      { header: 'Variant', key: 'variant', width: 20 }
    ]

    const validCodes = codes.filter(c => !c.is_blocked && c.status !== 'void')
    validCodes.forEach((code: any, index: number) => {
      validLinksSheet.addRow({
        index: index + 1,
        code: code.code,
        url: generateTrackingURL(code.code),
        product: code.products?.product_name || 'N/A',
        variant: code.product_variants?.variant_name || 'N/A'
      })
    })

    // Generate Excel file buffer
    const excelBuffer = await workbook.xlsx.writeBuffer()

    const fileName = `Journey_QR_Codes_${order.order_no || orderId.substring(0, 8)}_${new Date().toISOString().slice(0, 10)}.xlsx`

    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`
      }
    })
  } catch (error: any) {
    console.error('Error generating Journey QR Excel:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate Excel' },
      { status: 500 }
    )
  }
}
