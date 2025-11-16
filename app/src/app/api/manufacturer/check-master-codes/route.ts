import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Check Master Codes Status
 * 
 * Pre-validate master codes to determine which are already marked perfect
 * before attempting to process them. Provides better UX by warning users upfront.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { master_codes, manufacturer_org_id } = body

    if (!master_codes || !Array.isArray(master_codes)) {
      return NextResponse.json(
        { error: 'master_codes array is required' },
        { status: 400 }
      )
    }

    // Extract clean codes from URLs if needed
    const cleanCodes = master_codes.map(code => {
      let cleanCode = code.trim()
      if (cleanCode.includes('/track/')) {
        const parts = cleanCode.split('/')
        cleanCode = parts[parts.length - 1]
      }
      return cleanCode
    })

    // Query database for all codes
    const { data: masterRecords, error: queryError } = await supabase
      .from('qr_master_codes')
      .select('master_code, status, actual_unit_count, expected_unit_count')
      .in('master_code', cleanCodes)

    if (queryError) {
      console.error('Error checking master codes:', queryError)
      return NextResponse.json(
        { error: 'Failed to check master codes' },
        { status: 500 }
      )
    }

    // Categorize codes
    const alreadyComplete: string[] = []
    const notFound: string[] = []
    const available: string[] = []

    for (const code of cleanCodes) {
      const record = masterRecords?.find(r => r.master_code === code)
      
      if (!record) {
        notFound.push(code)
      } else if (
        record.status === 'packed' && 
        (record.actual_unit_count ?? 0) >= record.expected_unit_count
      ) {
        alreadyComplete.push(code)
      } else {
        available.push(code)
      }
    }

    return NextResponse.json({
      total_checked: cleanCodes.length,
      already_complete: alreadyComplete,
      not_found: notFound,
      available: available
    })

  } catch (error: any) {
    console.error('Error in check-master-codes:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to check master codes' },
      { status: 500 }
    )
  }
}
