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

    // Query database - use parallel batching for large arrays
    console.log(`🔍 Checking ${cleanCodes.length} master codes`)
    
    let masterRecords: any[] = []
    const BATCH_SIZE = 300 // Smaller batches to avoid network timeouts
    
    try {
      if (cleanCodes.length <= BATCH_SIZE) {
        // Single query for small batches (fast path)
        const { data, error: queryError } = await supabase
          .from('qr_master_codes')
          .select('master_code, status, actual_unit_count, expected_unit_count')
          .in('master_code', cleanCodes)

        if (queryError) throw queryError
        masterRecords = data || []
        console.log(`✅ Found ${masterRecords.length} records`)
      } else {
        // Parallel batch processing for large arrays (>300 codes)
        console.log(`📦 Large batch detected, processing in parallel chunks of ${BATCH_SIZE}`)
        
        // Split into batches
        const batchPromises: Promise<any>[] = []
        for (let i = 0; i < cleanCodes.length; i += BATCH_SIZE) {
          const batch = cleanCodes.slice(i, i + BATCH_SIZE)
          const batchNum = Math.floor(i / BATCH_SIZE) + 1
          
          const promise = supabase
            .from('qr_master_codes')
            .select('master_code, status, actual_unit_count, expected_unit_count')
            .in('master_code', batch)
            .then(({ data, error }) => {
              if (error) throw error
              console.log(`✅ Batch ${batchNum}: ${data?.length || 0} records`)
              return data || []
            })
          
          batchPromises.push(promise)
        }
        
        // Execute all batches in parallel
        const results = await Promise.all(batchPromises)
        masterRecords = results.flat()
        console.log(`✅ Total found: ${masterRecords.length} records`)
      }
    } catch (queryError: any) {
      console.error('❌ Error checking master codes:', {
        error: queryError,
        message: queryError.message,
        details: queryError.details,
        hint: queryError.hint,
        code: queryError.code,
        codesCount: cleanCodes.length,
        sampleCodes: cleanCodes.slice(0, 3)
      })
      return NextResponse.json(
        { error: `Failed to check master codes: ${queryError.message || 'Database error'}` },
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
