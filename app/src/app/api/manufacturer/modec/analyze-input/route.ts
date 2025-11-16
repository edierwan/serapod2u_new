import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseSpoiledEntries } from '@/lib/qr-parser'

/**
 * Analyze input to classify spoiled vs buffer codes
 * Returns summary for UI display before submission
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()

        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { order_id, batch_id, spoiled_input } = body

        if (!order_id || !batch_id || !spoiled_input) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const { entries } = parseSpoiledEntries(spoiled_input)

        if (entries.length === 0) {
            return NextResponse.json({ 
                analysis: {
                    spoiledCount: 0,
                    bufferProvidedCount: 0,
                    autoAllocateCount: 0,
                    excessBufferCount: 0,
                    ignoredBuffers: null,
                    wrongOrderCodes: null,
                    insufficientBuffers: null
                }
            })
        }

        // Get batch info to calculate cases and validate order
        const { data: batch } = await supabase
            .from('qr_batches')
            .select('qr_master_codes!inner(expected_unit_count), orders!inner(order_no)')
            .eq('id', batch_id)
            .single()

        const unitsPerCase = batch?.qr_master_codes?.[0]?.expected_unit_count || 100
        const currentOrderNo = (batch?.orders as any)?.order_no || order_id

        // Filter entries: separate valid entries from wrong-order entries
        const validEntries: typeof entries = []
        const wrongOrderEntries: Array<{ sequence: number, orderNo: string }> = []

        for (const entry of entries) {
            if (entry.parsed?.orderNo && entry.parsed.orderNo !== currentOrderNo) {
                // Wrong order - collect for warning
                wrongOrderEntries.push({
                    sequence: entry.parsed.sequenceNumber || 0,
                    orderNo: entry.parsed.orderNo
                })
            } else {
                // Valid or no orderNo parsed - include for processing
                validEntries.push(entry)
            }
        }

        // Group by case number and classify (only valid entries)
        // CRITICAL: Query database for case_number instead of calculating
        const casesMap = new Map<number, { spoiled: number, buffers: number }>()

        for (const entry of validEntries) {
            const sequenceNumber = entry.parsed?.sequenceNumber
            if (!sequenceNumber) continue

            // Query database for actual case_number (don't calculate - buffer codes have different case_number)
            const { data: qrCode } = await supabase
                .from('qr_codes')
                .select('is_buffer, case_number')
                .eq('batch_id', batch_id)
                .eq('sequence_number', sequenceNumber)
                .maybeSingle()

            if (!qrCode || !qrCode.case_number) continue

            const caseNumber = qrCode.case_number

            if (!casesMap.has(caseNumber)) {
                casesMap.set(caseNumber, { spoiled: 0, buffers: 0 })
            }

            const caseData = casesMap.get(caseNumber)!
            if (qrCode.is_buffer === true) {
                caseData.buffers++
            } else {
                caseData.spoiled++
            }
        }

        // Check if buffer codes are from different cases than spoiled codes
        const casesWithSpoiled = Array.from(casesMap.entries()).filter(([_, data]) => data.spoiled > 0)
        
        const ignoredBuffers: Array<{ sequence: number, fromCase: number, forCase: number }> = []
        
        if (casesWithSpoiled.length === 1) {
            const [spoiledCase, _] = casesWithSpoiled[0]
            // Find all buffer codes from other cases (only check validEntries)
            const allCases = Array.from(casesMap.entries())
            for (const [bufferCase, data] of allCases) {
                if (bufferCase !== spoiledCase && data.buffers > 0) {
                    // Find all buffer sequences from wrong case (query DB for case_number)
                    for (const entry of validEntries) {
                        const seq = entry.parsed?.sequenceNumber
                        if (!seq) continue
                        
                        const { data: qrCode } = await supabase
                            .from('qr_codes')
                            .select('is_buffer, case_number')
                            .eq('batch_id', batch_id)
                            .eq('sequence_number', seq)
                            .maybeSingle()
                        
                        if (qrCode?.is_buffer === true && qrCode.case_number === bufferCase) {
                            ignoredBuffers.push({ 
                                sequence: seq, 
                                fromCase: bufferCase, 
                                forCase: spoiledCase 
                            })
                        }
                    }
                }
            }
        }

        // Calculate totals only from cases with spoiled codes
        let spoiledCount = 0
        let bufferProvidedCount = 0

        for (const [caseNum, data] of casesWithSpoiled) {
            spoiledCount += data.spoiled
            bufferProvidedCount += data.buffers
        }

        // Calculate auto-allocate and excess
        let autoAllocateCount = 0
        let excessBufferCount = 0
        let insufficientBuffersWarning: { needed: number, available: number, caseNumber: number } | null = null

        if (bufferProvidedCount < spoiledCount) {
            // Need to auto-allocate more buffers
            autoAllocateCount = spoiledCount - bufferProvidedCount
            console.log(`[Analyze Input] Need to auto-allocate ${autoAllocateCount} buffers`)
            
            // Check if enough buffers are actually available in the case's buffer pool
            if (casesWithSpoiled.length === 1) {
                const [caseNumber, _] = casesWithSpoiled[0]
                
                const { count: availableBufferCount } = await supabase
                    .from('qr_codes')
                    .select('id', { count: 'exact', head: true })
                    .eq('order_id', order_id)
                    .eq('batch_id', batch_id)
                    .eq('case_number', caseNumber)
                    .eq('is_buffer', true)
                    .in('status', ['available', 'buffer_available'])
                
                console.log(`[Analyze Input] Case #${caseNumber}: Need ${autoAllocateCount}, Available ${availableBufferCount}`)
                
                if (availableBufferCount !== null && autoAllocateCount > availableBufferCount) {
                    // NOT ENOUGH BUFFERS AVAILABLE!
                    insufficientBuffersWarning = {
                        needed: autoAllocateCount,
                        available: availableBufferCount,
                        caseNumber: caseNumber
                    }
                    console.log(`[Analyze Input] ⚠️ INSUFFICIENT BUFFERS WARNING:`, insufficientBuffersWarning)
                }
            }
        } else if (bufferProvidedCount > spoiledCount) {
            // Excess buffer codes provided
            excessBufferCount = bufferProvidedCount - spoiledCount
        }

        const analysisResult = {
            spoiledCount,
            bufferProvidedCount,
            autoAllocateCount,
            excessBufferCount,
            ignoredBuffers: ignoredBuffers.length > 0 ? ignoredBuffers : null,
            wrongOrderCodes: wrongOrderEntries.length > 0 ? wrongOrderEntries : null,
            insufficientBuffers: insufficientBuffersWarning
        }

        console.log(`[Analyze Input] Final analysis result:`, JSON.stringify(analysisResult, null, 2))

        return NextResponse.json({
            analysis: analysisResult
        })

    } catch (error: any) {
        console.error('Error analyzing input:', error)
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        )
    }
}
