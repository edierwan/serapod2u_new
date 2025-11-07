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
function generateTrackingURL(code: string, type: 'product' | 'master'): string {
  const baseUrl = getBaseURL()
  return `${baseUrl}/track/${type}/${code}`
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams
    const batchId = searchParams.get('batch_id')

    if (!batchId) {
      return NextResponse.json(
        { error: 'Batch ID is required' },
        { status: 400 }
      )
    }

    // Get batch details
    const { data: batch, error: batchError } = await supabase
      .from('qr_batches')
      .select(`
        *,
        orders (
          order_no,
          order_type,
          created_at,
          organizations!orders_buyer_org_id_fkey (
            org_name
          )
        )
      `)
      .eq('id', batchId)
      .single()

    if (batchError || !batch) {
      return NextResponse.json(
        { error: 'Batch not found' },
        { status: 404 }
      )
    }

    const totalUniqueWithBuffer = Number(batch.total_unique_codes || 0)
    const bufferPercent = Number(batch.buffer_percent ?? 0)
    const plannedUniqueCodes = bufferPercent > 0
      ? Math.round(totalUniqueWithBuffer / (1 + bufferPercent / 100))
      : totalUniqueWithBuffer
    const trackedStatuses = ['packed', 'received_warehouse', 'shipped_distributor', 'opened']

    // Get master codes that have been scanned (even if no units yet OR have units linked)
    const { data: masterCodesRaw, error: masterError } = await supabase
      .from('qr_master_codes')
      .select('*')
      .eq('batch_id', batchId)
      .order('case_number', { ascending: true })

    if (masterError) {
      throw masterError
    }

    // Include master codes that have been scanned (status = 'packed') OR have units linked
    const masterCodes = (masterCodesRaw || []).filter((master: any) => 
      master.status === 'packed' || Number(master.actual_unit_count || 0) > 0
    )

    // Get all scanned unique codes with their master case information
    const { data: uniqueCodesRaw, error: uniqueError } = await supabase
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
      .eq('batch_id', batchId)
      .in('status', trackedStatuses)
      .order('sequence_number', { ascending: true })

    if (uniqueError) {
      throw uniqueError
    }

    const uniqueCodes = uniqueCodesRaw || []
    
    // Buffer codes are scanned codes that:
    // 1. Have sequence number beyond planned codes (from buffer range)
    // 2. Are scanned but NOT linked to any master case (master_code_id is null)
    // Get all scanned codes including those not linked to master
    const { data: allScannedCodes, error: allScannedError } = await supabase
      .from('qr_codes')
      .select('sequence_number, master_code_id, status')
      .eq('batch_id', batchId)
      .in('status', trackedStatuses)

    if (allScannedError) {
      throw allScannedError
    }

    // Buffer codes used = scanned codes with sequence > planned that are linked to masters
    const bufferCodeEntries = (allScannedCodes || []).filter((code: any) => {
      const sequenceNumber = Number(code.sequence_number || 0)
      return plannedUniqueCodes > 0 && sequenceNumber > plannedUniqueCodes && code.master_code_id !== null
    })
    
    // Also get buffer codes details for the detailed sheets
    const bufferCodeDetails = uniqueCodes.filter((code: any) => {
      const sequenceNumber = Number(code.sequence_number || 0)
      return plannedUniqueCodes > 0 && sequenceNumber > plannedUniqueCodes
    })

    const orderData = Array.isArray(batch.orders) ? batch.orders[0] : batch.orders
    const orgData = orderData ? (Array.isArray(orderData.organizations) ? orderData.organizations[0] : orderData.organizations) : null

    // Create workbook
    const workbook = new ExcelJS.Workbook()

    // Sheet 1: Summary
    const summarySheet = workbook.addWorksheet('Summary')
    summarySheet.columns = [
      { width: 30 },
      { width: 40 }
    ]

    const summaryData = [
      ['Scan Summary Report', ''],
      ['Generated:', new Date().toLocaleString()],
      ['', ''],
      ['Batch Information', ''],
      ['Batch ID:', batch.id],
      ['Order Number:', orderData?.order_no || 'N/A'],
      ['Buyer:', orgData?.org_name || 'N/A'],
      ['Order Date:', orderData?.created_at ? new Date(orderData.created_at).toLocaleDateString() : 'N/A'],
      ['', ''],
      ['Scan Statistics', ''],
      ['Total Master Cases Scanned:', masterCodes.length.toString()],
      ['Total Unique Codes Scanned:', uniqueCodes.length.toString()],
      ['Buffer Codes Used:', bufferCodeEntries.length.toString()]
    ]

    summaryData.forEach(row => {
      summarySheet.addRow(row)
    })

    // Sheet 2: Master Cases
    const masterSheet = workbook.addWorksheet('Master Cases')
    
    if (masterCodes.length > 0) {
      masterSheet.columns = [
        { header: '#', key: 'index', width: 5 },
        { header: 'Master Code', key: 'masterCode', width: 35 },
        { header: 'Case Number', key: 'caseNumber', width: 12 },
        { header: 'Expected Units', key: 'expectedUnits', width: 15 },
        { header: 'Actual Units', key: 'actualUnits', width: 12 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Scanned At', key: 'scannedAt', width: 20 },
        { header: 'Scanned By', key: 'scannedBy', width: 25 }
      ]

      masterCodes.forEach((master: any, index: number) => {
        masterSheet.addRow({
          index: index + 1,
          masterCode: master.master_code,
          caseNumber: master.case_number,
          expectedUnits: master.expected_unit_count,
          actualUnits: master.actual_unit_count || 0,
          status: master.status,
          scannedAt: master.scanned_at ? new Date(master.scanned_at).toLocaleString() : 'N/A',
          scannedBy: master.scanned_by_user || 'N/A'
        })
      })
    } else {
      masterSheet.addRow(['Info', 'No master cases with scanned units yet for this batch.'])
    }

    // Sheet 3: Child QR Codes by Master
    const childData: any[] = []
    
    for (const master of masterCodes) {
      const childCodes = uniqueCodes.filter((c: any) => {
        const masterCodeData = Array.isArray(c.qr_master_codes) ? c.qr_master_codes[0] : c.qr_master_codes
        return masterCodeData && masterCodeData.case_number === master.case_number
      })
      
      if (childCodes.length > 0) {
        childData.push({
          'Master Code': master.master_code,
          'Case Number': master.case_number,
          'Child Code': '',
          'Product': '',
          'Variant': '',
          'Sequence': '',
          'Status': '=== CASE SUMMARY ===',
          'Scanned At': `${childCodes.length} codes`
        })

        childCodes.forEach((child: any) => {
          childData.push({
            'Master Code': '',
            'Case Number': '',
            'Child Code': child.code,
            'Product': child.products?.product_name || 'N/A',
            'Variant': child.product_variants?.variant_name || 'N/A',
            'Sequence': child.sequence_number,
            'Status': child.status,
            'Scanned At': child.last_scanned_at ? new Date(child.last_scanned_at).toLocaleString() : 'N/A'
          })
        })

        // Add separator
        childData.push({
          'Master Code': '',
          'Case Number': '',
          'Child Code': '',
          'Product': '',
          'Variant': '',
          'Sequence': '',
          'Status': '',
          'Scanned At': ''
        })
      }
    }

    // Add buffer codes section
    if (bufferCodeDetails.length > 0) {
      childData.push({
        'Master Code': '=== BUFFER CODES (LINKED) ===',
        'Case Number': '',
        'Child Code': '',
        'Product': '',
        'Variant': '',
        'Sequence': '',
        'Status': '',
        'Scanned At': `${bufferCodeDetails.length} codes used from buffer`
      })

      bufferCodeDetails.forEach((child: any) => {
        childData.push({
          'Master Code': '',
          'Case Number': 'Buffer',
          'Child Code': child.code,
          'Product': child.products?.product_name || 'N/A',
          'Variant': child.product_variants?.variant_name || 'N/A',
          'Sequence': child.sequence_number,
          'Status': child.status,
          'Scanned At': child.last_scanned_at ? new Date(child.last_scanned_at).toLocaleString() : 'N/A'
        })
      })
    }

    // Sheet 3: Child Codes by Master
    const childSheet = workbook.addWorksheet('Child Codes by Master')
    
    if (childData.length > 0) {
      childSheet.columns = [
        { header: 'Master Code', key: 'masterCode', width: 35 },
        { header: 'Case Number', key: 'caseNumber', width: 12 },
        { header: 'Child Code', key: 'childCode', width: 50 },
        { header: 'Product', key: 'product', width: 25 },
        { header: 'Variant', key: 'variant', width: 20 },
        { header: 'Sequence', key: 'sequence', width: 10 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Scanned At', key: 'scannedAt', width: 20 }
      ]

      childData.forEach((row: any) => {
        childSheet.addRow({
          masterCode: row['Master Code'],
          caseNumber: row['Case Number'],
          childCode: row['Child Code'],
          product: row['Product'],
          variant: row['Variant'],
          sequence: row['Sequence'],
          status: row['Status'],
          scannedAt: row['Scanned At']
        })
      })
    } else {
      childSheet.addRow(['Info', 'No child codes linked yet for this batch.'])
    }

    // Sheet 4: All Child Codes (flat list)
    const allChildData = uniqueCodes.map((code: any, index: number) => {
      const masterCodeData = Array.isArray(code.qr_master_codes) ? code.qr_master_codes[0] : code.qr_master_codes
      const sequenceNumber = Number(code.sequence_number || 0)
      const isBuffer = plannedUniqueCodes > 0 && sequenceNumber > plannedUniqueCodes
      
      return {
        '#': index + 1,
        'Individual QR Code': code.code,
        'Product': code.products?.product_name || 'N/A',
        'Variant': code.product_variants?.variant_name || 'N/A',
        'Tracking URL': generateTrackingURL(code.code, 'product'),
        'Sequence': code.sequence_number,
        'Master Code': isBuffer 
          ? (masterCodeData?.master_code ? `${masterCodeData.master_code} (Buffer)` : 'Buffer - Unassigned')
          : (masterCodeData?.master_code || 'Unassigned'),
        'Case Number': isBuffer 
          ? (masterCodeData?.case_number ? `${masterCodeData.case_number} (Buffer)` : 'Buffer') 
          : (masterCodeData?.case_number || 'Unassigned'),
        'Master Tracking URL': generateTrackingURL(masterCodeData?.master_code || '', 'master'),
        'Status': code.status,
        'Scanned At': code.last_scanned_at ? new Date(code.last_scanned_at).toLocaleString() : 'N/A'
      }
    })

    // Sheet 4: All Child Codes (flat list)
    const allChildSheet = workbook.addWorksheet('All Child Codes')
    allChildSheet.columns = [
      { header: '#', key: 'index', width: 5 },
      { header: 'Individual QR Code', key: 'code', width: 50 },
      { header: 'Product', key: 'product', width: 25 },
      { header: 'Variant', key: 'variant', width: 20 },
      { header: 'Tracking URL', key: 'trackingUrl', width: 60 },
      { header: 'Sequence', key: 'sequence', width: 10 },
      { header: 'Master Code', key: 'masterCode', width: 35 },
      { header: 'Case Number', key: 'caseNumber', width: 12 },
      { header: 'Master Tracking URL', key: 'masterTrackingUrl', width: 60 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Scanned At', key: 'scannedAt', width: 20 }
    ]

    allChildData.forEach((row: any) => {
      allChildSheet.addRow({
        index: row['#'],
        code: row['Individual QR Code'],
        product: row['Product'],
        variant: row['Variant'],
        trackingUrl: row['Tracking URL'],
        sequence: row['Sequence'],
        masterCode: row['Master Code'],
        caseNumber: row['Case Number'],
        masterTrackingUrl: row['Master Tracking URL'],
        status: row['Status'],
        scannedAt: row['Scanned At']
      })
    })

    // Generate Excel file
    const excelBuffer = await workbook.xlsx.writeBuffer()

    const fileName = `Scan_Summary_${orderData?.order_no || batch.id.substring(0, 8)}_${new Date().toISOString().slice(0, 10)}.xlsx`

    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`
      }
    })
  } catch (error: any) {
    console.error('Error generating scan summary Excel:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate Excel' },
      { status: 500 }
    )
  }
}
