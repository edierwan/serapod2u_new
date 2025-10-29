import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'

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

    // Create workbook
    const workbook = XLSX.utils.book_new()

    // Sheet 1: Summary
    const summaryData = [
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
    ]

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
    summarySheet['!cols'] = [{ wch: 30 }, { wch: 40 }]
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

    // Sheet 2: All QR Codes with Tracking URLs
    const qrData = codes.map((code: any, index: number) => {
      const masterCodeData = Array.isArray(code.qr_master_codes) ? code.qr_master_codes[0] : code.qr_master_codes
      const isScanned = ['opened', 'shipped_distributor', 'received_warehouse', 'packed'].includes(code.status)
      
      return {
        '#': index + 1,
        'QR Code': code.code,
        'Tracking URL': generateTrackingURL(code.code),
        'Status': code.status,
        'Is Scanned': isScanned ? 'Yes' : 'No',
        'Product': code.products?.product_name || 'N/A',
        'Variant': code.product_variants?.variant_name || 'N/A',
        'Sequence': code.sequence_number,
        'Case Number': masterCodeData?.case_number || 'Unassigned',
        'Master Code': masterCodeData?.master_code || 'Unassigned',
        'Last Scanned': code.last_scanned_at ? new Date(code.last_scanned_at).toLocaleString() : 'Never',
        'Blocked': code.is_blocked ? 'Yes' : 'No'
      }
    })

    const qrSheet = XLSX.utils.json_to_sheet(qrData)
    qrSheet['!cols'] = [
      { wch: 5 },   // #
      { wch: 50 },  // QR Code
      { wch: 70 },  // Tracking URL
      { wch: 15 },  // Status
      { wch: 12 },  // Is Scanned
      { wch: 25 },  // Product
      { wch: 20 },  // Variant
      { wch: 10 },  // Sequence
      { wch: 12 },  // Case Number
      { wch: 35 },  // Master Code
      { wch: 20 },  // Last Scanned
      { wch: 10 }   // Blocked
    ]
    XLSX.utils.book_append_sheet(workbook, qrSheet, 'QR Codes & URLs')

    // Sheet 3: Valid Links Only (for consumer distribution)
    const validLinks = codes
      .filter(c => !c.is_blocked && c.status !== 'void')
      .map((code: any, index: number) => ({
        '#': index + 1,
        'QR Code': code.code,
        'Consumer Tracking URL': generateTrackingURL(code.code),
        'Product': code.products?.product_name || 'N/A',
        'Variant': code.product_variants?.variant_name || 'N/A'
      }))

    const validLinksSheet = XLSX.utils.json_to_sheet(validLinks)
    validLinksSheet['!cols'] = [
      { wch: 5 },   // #
      { wch: 50 },  // QR Code
      { wch: 70 },  // Tracking URL
      { wch: 25 },  // Product
      { wch: 20 }   // Variant
    ]
    XLSX.utils.book_append_sheet(workbook, validLinksSheet, 'Valid Links')

    // Generate Excel file
    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true
    })

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
