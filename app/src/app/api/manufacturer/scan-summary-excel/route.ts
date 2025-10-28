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
    const workbook = XLSX.utils.book_new()

    // Sheet 1: Summary
    const summaryData = [
      ['Scan Summary Report'],
      ['Generated:', new Date().toLocaleString()],
      [],
      ['Batch Information'],
      ['Batch ID:', batch.id],
      ['Order Number:', orderData?.order_no || 'N/A'],
      ['Buyer:', orgData?.org_name || 'N/A'],
      ['Order Date:', orderData?.created_at ? new Date(orderData.created_at).toLocaleDateString() : 'N/A'],
      [],
      ['Scan Statistics'],
      ['Total Master Cases Scanned:', masterCodes.length],
      ['Total Unique Codes Scanned:', uniqueCodes.length],
      ['Buffer Codes Used:', bufferCodeEntries.length]
    ]

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
    summarySheet['!cols'] = [{ wch: 30 }, { wch: 40 }]
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

    // Sheet 2: Master Cases
    const masterData = masterCodes.map((master: any, index: number) => ({
      '#': index + 1,
      'Master Code': master.master_code,
      'Case Number': master.case_number,
      'Expected Units': master.expected_unit_count,
      'Actual Units': master.actual_unit_count || 0,
      'Status': master.status,
      'Scanned At': master.scanned_at ? new Date(master.scanned_at).toLocaleString() : 'N/A',
      'Scanned By': master.scanned_by_user || 'N/A'
    }))

    const masterSheet = masterData.length
      ? XLSX.utils.json_to_sheet(masterData)
      : XLSX.utils.aoa_to_sheet([[ 'Info', 'No master cases with scanned units yet for this batch.' ]])
    masterSheet['!cols'] = [
      { wch: 5 },
      { wch: 35 },
      { wch: 12 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 20 },
      { wch: 25 }
    ]
    XLSX.utils.book_append_sheet(workbook, masterSheet, 'Master Cases')

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

    const childSheet = childData.length
      ? XLSX.utils.json_to_sheet(childData)
      : XLSX.utils.aoa_to_sheet([[ 'Info', 'No child codes linked yet for this batch.' ]])
    childSheet['!cols'] = [
      { wch: 35 },
      { wch: 12 },
      { wch: 50 },
      { wch: 25 },
      { wch: 20 },
      { wch: 10 },
      { wch: 12 },
      { wch: 20 }
    ]
    XLSX.utils.book_append_sheet(workbook, childSheet, 'Child Codes by Master')

    // Sheet 4: All Child Codes (flat list)
    const allChildData = uniqueCodes.map((code: any, index: number) => {
      const masterCodeData = Array.isArray(code.qr_master_codes) ? code.qr_master_codes[0] : code.qr_master_codes
      const sequenceNumber = Number(code.sequence_number || 0)
      const isBuffer = plannedUniqueCodes > 0 && sequenceNumber > plannedUniqueCodes
      
      return {
        '#': index + 1,
        'Individual QR Code': code.code,
        'Tracking URL': generateTrackingURL(code.code, 'product'),
        'Sequence': code.sequence_number,
        'Product': code.products?.product_name || 'N/A',
        'Variant': code.product_variants?.variant_name || 'N/A',
        'Case Number': isBuffer 
          ? (masterCodeData?.case_number ? `${masterCodeData.case_number} (Buffer)` : 'Buffer') 
          : (masterCodeData?.case_number || 'Unassigned'),
        'Master Code': isBuffer 
          ? (masterCodeData?.master_code ? `${masterCodeData.master_code} (Buffer)` : 'Buffer - Unassigned')
          : (masterCodeData?.master_code || 'Unassigned'),
        'Status': code.status,
        'Scanned At': code.last_scanned_at ? new Date(code.last_scanned_at).toLocaleString() : 'N/A'
      }
    })

    const allChildSheet = XLSX.utils.json_to_sheet(allChildData)
    allChildSheet['!cols'] = [
      { wch: 5 },
      { wch: 50 },
      { wch: 60 },  // Tracking URL column
      { wch: 10 },
      { wch: 25 },
      { wch: 20 },
      { wch: 12 },
      { wch: 35 },
      { wch: 12 },
      { wch: 20 }
    ]
    XLSX.utils.book_append_sheet(workbook, allChildSheet, 'All Child Codes')

    // Generate Excel file
    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true
    })

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
