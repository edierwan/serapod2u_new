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

    // Get master codes that have been scanned (even if no units yet OR have units linked)
    const { data: masterCodesRaw, error: masterError } = await supabase
      .from('qr_master_codes')
      .select('*')
      .eq('batch_id', batchId)
      .order('case_number', { ascending: true })

    if (masterError) {
      throw masterError
    }

    // Include master codes that have been scanned (status = 'packed' or 'generated') OR have units linked
    const masterCodes = (masterCodesRaw || []).filter((master: any) => 
      ['packed', 'generated', 'ready_to_ship'].includes(master.status) || Number(master.actual_unit_count || 0) > 0
    )

    // Get ALL unique codes for this batch (regardless of status)
    // This ensures we see the complete picture: printed, packed, buffer_used, spoiled, etc.
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
      .order('sequence_number', { ascending: true })
      .order('sequence_number', { ascending: true })

    if (uniqueError) {
      throw uniqueError
    }

    const uniqueCodes = uniqueCodesRaw || []
    
    // Buffer codes used = codes with sequence > planned that are linked to masters
    const bufferCodeEntries = uniqueCodes.filter((code: any) => {
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

    // Calculate statistics
    const packedCodes = uniqueCodes.filter((c: any) => c.status === 'packed' || c.status === 'buffer_used').length
    const linkedCodes = uniqueCodes.filter((c: any) => c.master_code_id !== null).length
    
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
      ['QR Code Statistics', ''],
      ['Total QR Codes in Batch:', uniqueCodes.length.toString()],
      ['Codes Linked to Master Cases:', linkedCodes.toString()],
      ['Master Cases Created:', masterCodes.length.toString()],
      ['Buffer Codes Used:', bufferCodeEntries.length.toString()],
      ['', ''],
      ['Production Statistics', ''],
      ['Total Codes Packed/Used:', packedCodes.toString()],
      ['Planned Unique Codes:', plannedUniqueCodes.toString()],
      ['Buffer Codes Available:', (totalUniqueWithBuffer - plannedUniqueCodes).toString()]
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

    // Sheet 3: Child QR Codes by Master (showing actual codes in the case)
    const childData: any[] = []
    
    for (const master of masterCodes) {
      // Calculate sequence range for this case based on expected units per case
      const caseNumber = master.case_number
      const unitsPerCase = Number(master.expected_unit_count || 100)
      const startSeq = (caseNumber - 1) * unitsPerCase + 1
      const endSeq = caseNumber * unitsPerCase
      
      // Get codes in this case's sequence range (exclude spoiled codes)
      const normalCodes = uniqueCodes.filter((c: any) => {
        const sequenceNumber = Number(c.sequence_number || 0)
        const inRange = sequenceNumber >= startSeq && sequenceNumber <= endSeq
        // Exclude spoiled codes - they will be replaced by buffer codes
        return inRange && c.status !== 'spoiled'
      })
      
      // Get buffer codes that replaced spoiled codes in THIS case
      // These are buffer codes where replaces_sequence_no is in this case's range
      const bufferCodesForCase = uniqueCodes.filter((c: any) => {
        const sequenceNumber = Number(c.sequence_number || 0)
        const isBufferCode = plannedUniqueCodes > 0 && sequenceNumber > plannedUniqueCodes
        const replacesSeq = Number(c.replaces_sequence_no || 0)
        const replacesInThisCase = replacesSeq >= startSeq && replacesSeq <= endSeq
        // Only include buffer_used codes (not buffer_available)
        return isBufferCode && replacesInThisCase && c.status === 'buffer_used'
      })
      
      // Combine normal codes and buffer codes for this case
      const allCodesInCase = [...normalCodes, ...bufferCodesForCase].sort((a, b) => {
        // Sort by original sequence (for buffers, use replaces_sequence_no)
        const seqA = a.replaces_sequence_no ? Number(a.replaces_sequence_no) : Number(a.sequence_number)
        const seqB = b.replaces_sequence_no ? Number(b.replaces_sequence_no) : Number(b.sequence_number)
        return seqA - seqB
      })
      
      if (allCodesInCase.length > 0) {
        childData.push({
          'Master Code': master.master_code,
          'Case Number': master.case_number,
          'Child Code': '',
          'Product': '',
          'Variant': '',
          'Sequence': '',
          'Is Buffer': '',
          'Replaces Seq': '',
          'Status': '=== CASE SUMMARY ===',
          'Scanned At': `${allCodesInCase.length} codes`
        })

        allCodesInCase.forEach((child: any) => {
          const sequenceNumber = Number(child.sequence_number || 0)
          const isBuffer = plannedUniqueCodes > 0 && sequenceNumber > plannedUniqueCodes
          
          childData.push({
            'Master Code': '',
            'Case Number': '',
            'Child Code': child.code,
            'Product': child.products?.product_name || 'N/A',
            'Variant': child.product_variants?.variant_name || 'N/A',
            'Sequence': child.sequence_number,
            'Is Buffer': isBuffer ? 'YES' : 'No',
            'Replaces Seq': child.replaces_sequence_no || '',
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
          'Is Buffer': '',
          'Replaces Seq': '',
          'Status': '',
          'Scanned At': ''
        })
      }
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
        { header: 'Is Buffer', key: 'isBuffer', width: 10 },
        { header: 'Replaces Seq', key: 'replacesSeq', width: 12 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Scanned At', key: 'scannedAt', width: 20 }
      ]

      childData.forEach((row: any) => {
        const addedRow = childSheet.addRow({
          masterCode: row['Master Code'],
          caseNumber: row['Case Number'],
          childCode: row['Child Code'],
          product: row['Product'],
          variant: row['Variant'],
          sequence: row['Sequence'],
          isBuffer: row['Is Buffer'],
          replacesSeq: row['Replaces Seq'],
          status: row['Status'],
          scannedAt: row['Scanned At']
        })
        
        // Highlight buffer rows with yellow background
        if (row['Is Buffer'] === 'YES') {
          addedRow.eachCell((cell) => {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFD966' } // Light yellow
            }
          })
        }
      })
    } else {
      childSheet.addRow(['Info', 'No child codes linked yet for this batch.'])
    }

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
