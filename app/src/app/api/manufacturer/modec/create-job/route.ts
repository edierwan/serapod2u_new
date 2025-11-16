import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseSpoiledEntries } from '@/lib/qr-parser'

export async function POST(request: NextRequest) {
    const startTime = Date.now()

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

        console.log('📥 Mode C create-job request:', { order_id, batch_id, user_id: user.id })

        // Check if input contains master case QR codes (wrong type for Mode C)
        if (spoiled_input.includes('/track/master/') || spoiled_input.includes('MASTER-ORD-')) {
            return NextResponse.json({ 
                error: 'WRONG_QR_TYPE',
                message: 'You tried to enter master case QR codes. Please enter unique product QR codes that belong to this order for damage recovery.'
            }, { status: 400 })
        }

        const { entries, errors: parseErrors } = parseSpoiledEntries(spoiled_input)

        if (parseErrors.length > 0) {
            return NextResponse.json({ error: 'Failed to parse some entries', details: parseErrors }, { status: 400 })
        }

        if (entries.length === 0) {
            return NextResponse.json({ error: 'No valid spoiled codes provided' }, { status: 400 })
        }

        console.log('✅ Parsed entries:', entries.length)

        // Get batch info first (needed for both paths)
        const { data: batch, error: batchError } = await supabase
            .from('qr_batches')
            .select('id, order_id, qr_master_codes!inner(expected_unit_count), orders!inner(order_no)')
            .eq('id', batch_id)
            .single()

        if (batchError || !batch) {
            console.error('❌ Batch not found:', batchError)
            return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
        }

        const currentOrderNo = (batch.orders as any)?.order_no || order_id
        const unitsPerCase = batch.qr_master_codes?.[0]?.expected_unit_count || 100

        // CRITICAL: Query database to get actual case_number for each sequence
        // This handles BOTH normal codes AND buffer codes correctly
        // Buffer codes have case_number assigned during generation (not calculated from sequence)
        console.log('🔍 Looking up case numbers for sequences from database...')
        
        const sequenceNumbers = entries
            .map(e => e.parsed?.sequenceNumber)
            .filter((seq): seq is number => seq !== undefined)
        
        if (sequenceNumbers.length === 0) {
            return NextResponse.json({ error: 'No valid sequence numbers found' }, { status: 400 })
        }
        
        console.log(`📊 Looking up ${sequenceNumbers.length} sequences...`)
        
        // Query database in BATCHES to avoid query size limits (max ~1000 per query)
        const BATCH_SIZE = 1000
        const allQrCodes: Array<{ sequence_number: number, case_number: number | null, is_buffer: boolean | null }> = []
        
        for (let i = 0; i < sequenceNumbers.length; i += BATCH_SIZE) {
            const batch = sequenceNumbers.slice(i, i + BATCH_SIZE)
            const batchNum = Math.floor(i / BATCH_SIZE) + 1
            const totalBatches = Math.ceil(sequenceNumbers.length / BATCH_SIZE)
            
            console.log(`   Batch ${batchNum}/${totalBatches}: Querying ${batch.length} sequences...`)
            
            const { data: qrCodes, error: qrError } = await supabase
                .from('qr_codes')
                .select('sequence_number, case_number, is_buffer')
                .eq('batch_id', batch_id)
                .in('sequence_number', batch)
            
            if (qrError) {
                console.error(`❌ Failed to lookup case numbers (batch ${batchNum}/${totalBatches}):`, qrError)
                return NextResponse.json({ error: 'Failed to lookup code information' }, { status: 500 })
            }
            
            if (qrCodes && qrCodes.length > 0) {
                allQrCodes.push(...qrCodes)
            }
        }
        
        console.log(`✅ Found ${allQrCodes.length}/${sequenceNumbers.length} codes in database`)
        
        if (allQrCodes.length === 0) {
            return NextResponse.json({ 
                error: 'No matching codes found in this batch',
                details: `Searched for ${sequenceNumbers.length} sequences but found none in batch ${batch_id}`
            }, { status: 400 })
        }
        
        // Create a map: sequence -> case_number
        const sequenceToCaseMap = new Map<number, { case_number: number, is_buffer: boolean }>()
        allQrCodes.forEach(code => {
            if (code.case_number !== null && code.is_buffer !== null) {
                sequenceToCaseMap.set(code.sequence_number, {
                    case_number: code.case_number,
                    is_buffer: code.is_buffer
                })
            }
        })
        
        console.log('✅ Found case numbers for sequences:')
        sequenceNumbers.slice(0, 10).forEach(seq => {
            const info = sequenceToCaseMap.get(seq)
            console.log(`   Seq ${seq} → Case #${info?.case_number} ${info?.is_buffer ? '(buffer)' : '(normal)'}`)
        })
        if (sequenceNumbers.length > 10) {
            console.log(`   ... and ${sequenceNumbers.length - 10} more`)
        }

        // Group entries by case number - ONE JOB PER CASE
        // This is critical: the worker expects each job to contain ONLY sequences from that specific case
        const entriesByCase = new Map<number, typeof entries>()
        const notFoundSequences: number[] = []
        
        for (const entry of entries) {
            const sequenceNumber = entry.parsed?.sequenceNumber
            if (!sequenceNumber) continue
            
            const codeInfo = sequenceToCaseMap.get(sequenceNumber)
            if (!codeInfo) {
                notFoundSequences.push(sequenceNumber)
                continue
            }
            
            const caseNumber = codeInfo.case_number
            if (!entriesByCase.has(caseNumber)) {
                entriesByCase.set(caseNumber, [])
            }
            entriesByCase.get(caseNumber)!.push(entry)
        }
        
        // Report any sequences not found
        if (notFoundSequences.length > 0) {
            console.error(`❌ Sequences not found in batch: ${notFoundSequences.join(', ')}`)
            return NextResponse.json({
                error: 'Some sequences not found in this batch',
                not_found: notFoundSequences,
                message: `${notFoundSequences.length} sequence(s) do not exist in this batch`
            }, { status: 400 })
        }

        const totalCases = entriesByCase.size
        console.log(`📦 Grouped into ${totalCases} distinct case(s)`)

        // Get user profile for organization_id
        const { data: userProfile } = await supabase
            .from('users')
            .select('id, organization_id')
            .eq('id', user.id)
            .single()

        // Create ONE JOB PER CASE
        // This ensures each job's qr_reverse_job_items contains only sequences from that case
        const createdJobs = []
        const caseNumbers = Array.from(entriesByCase.keys()).sort((a, b) => a - b)

        console.log(`⚡ Creating ${totalCases} job(s) (one per case)...`)

        for (const caseNumber of caseNumbers) {
            const caseEntries = entriesByCase.get(caseNumber) || []
            
            // CRITICAL: Separate SPOILED codes from BUFFER codes
            // User can paste both - we need to identify which is which using database info
            const spoiledSequences: number[] = []
            const bufferSequences: number[] = []
            
            // Also get current status of each code to detect already-processed codes
            const caseSequences = caseEntries
                .map(e => e.parsed?.sequenceNumber)
                .filter((seq): seq is number => seq !== undefined)
            
            const { data: codeStatuses } = await supabase
                .from('qr_codes')
                .select('sequence_number, is_buffer, status, replaces_sequence_no')
                .eq('batch_id', batch_id)
                .eq('case_number', caseNumber)
                .in('sequence_number', caseSequences)
            
            const alreadySpoiledCodes: number[] = []
            
            for (const entry of caseEntries) {
                const sequenceNumber = entry.parsed?.sequenceNumber
                if (!sequenceNumber) continue
                
                const codeInfo = sequenceToCaseMap.get(sequenceNumber)
                if (!codeInfo) continue
                
                const codeStatus = codeStatuses?.find(c => c.sequence_number === sequenceNumber)
                
                if (codeInfo.is_buffer) {
                    bufferSequences.push(sequenceNumber)
                } else {
                    // Check if this code is already marked as spoiled
                    if (codeStatus?.status === 'spoiled') {
                        alreadySpoiledCodes.push(sequenceNumber)
                        // ALLOW REPROCESSING: Add to spoiledSequences anyway (user might have deleted previous job)
                        spoiledSequences.push(sequenceNumber)
                    } else {
                        spoiledSequences.push(sequenceNumber)
                    }
                }
            }
            
            // Warn about already-spoiled codes (likely from deleted/failed jobs)
            if (alreadySpoiledCodes.length > 0) {
                console.warn(`⚠️ Case #${caseNumber}: ${alreadySpoiledCodes.length} code(s) already marked as spoiled (reprocessing allowed): ${alreadySpoiledCodes.join(', ')}`)
            }
            
            console.log(`📦 Case #${caseNumber}:`)
            console.log(`   Spoiled codes: ${spoiledSequences.length} (${spoiledSequences.length > 0 ? spoiledSequences.join(', ') : 'none'})`)
            console.log(`   Buffer codes provided: ${bufferSequences.length} (${bufferSequences.length > 0 ? bufferSequences.join(', ') : 'none'})`)
            
            // HANDLE BUFFER-ONLY CASE: Create verification job with 0 items
            // Worker will process this and mark case as complete without any replacements
            const isVerificationOnly = spoiledSequences.length === 0 && bufferSequences.length > 0
            
            if (isVerificationOnly) {
                console.log(`✅ Case #${caseNumber}: Buffer-only submission - creating verification job (0 spoiled, 0 replacements)`)
                // Clear buffers - we won't use them, just verify case is complete
                bufferSequences.length = 0
                // Don't continue - let it create an empty job below
            }
            
            // Skip if absolutely no codes
            if (spoiledSequences.length === 0 && bufferSequences.length === 0 && !isVerificationOnly) {
                console.warn(`⚠️ Case #${caseNumber}: No codes provided - skipping`)
                continue
            }
            
            // ISSUE 1 FIX: Check if this case already completed
            const { data: existingCompletedJob } = await supabase
                .from('qr_reverse_jobs')
                .select('id, status, completed_at')
                .eq('batch_id', batch_id)
                .eq('case_number', caseNumber)
                .eq('status', 'completed')
                .maybeSingle()
            
            if (existingCompletedJob) {
                console.log(`⏭️  Skipping Case #${caseNumber} - already completed (job ${existingCompletedJob.id})`)
                createdJobs.push({
                    job_id: existingCompletedJob.id,
                    case_number: caseNumber,
                    status: 'skipped',
                    message: 'Case already completed',
                    completed_at: existingCompletedJob.completed_at
                })
                continue
            }
            
            // Create job items - ONLY for SPOILED codes (empty array if verification-only job)
            const jobItems = spoiledSequences.map(seq => ({
                spoiled_sequence_no: seq,
                status: 'pending'
            }))
            
            // Handle min/max for verification-only jobs (no spoiled codes)
            const minSeq = spoiledSequences.length > 0 ? Math.min(...spoiledSequences) : 1
            const maxSeq = spoiledSequences.length > 0 ? Math.max(...spoiledSequences) : 1

            // Create job data
            const jobData: any = {
                batch_id: batch_id,
                order_id: batch.order_id,
                case_number: caseNumber,
                variant_key: null,
                status: 'queued',
                created_by: user.id
            }
            
            if (userProfile?.organization_id) {
                jobData.manufacturer_org_id = userProfile.organization_id
            }

            // Insert job
            const { data: job, error: jobError } = await supabase
                .from('qr_reverse_jobs')
                .insert(jobData)
                .select()
                .single()

            if (jobError) {
                console.error(`❌ Failed to create job for Case #${caseNumber}:`, jobError)
                continue
            }

            // ISSUE 2 FIX: Handle manual buffer assignment
            // If user provided buffer codes, pair them with spoiled codes
            const itemsToInsert = []
            
            if (bufferSequences.length > 0) {
                console.log(`🔧 User provided ${bufferSequences.length} buffer code(s) for ${spoiledSequences.length} spoiled code(s)`)
                
                // Query database to get buffer code IDs and check if already used
                const { data: bufferCodes } = await supabase
                    .from('qr_codes')
                    .select('id, sequence_number, status, replaces_sequence_no')
                    .eq('batch_id', batch_id)
                    .eq('case_number', caseNumber)
                    .eq('is_buffer', true)
                    .in('sequence_number', bufferSequences)
                
                // Validate that buffers are available (not already used)
                const alreadyUsedBuffers = bufferCodes?.filter(b => b.status === 'buffer_used') || []
                if (alreadyUsedBuffers.length > 0) {
                    const usedDetails = alreadyUsedBuffers.map(b => 
                        `Buffer ${b.sequence_number} (already replaced sequence ${b.replaces_sequence_no})`
                    ).join(', ')
                    
                    console.error(`❌ Some buffers already used: ${usedDetails}`)
                    return NextResponse.json({
                        error: 'BUFFER_ALREADY_USED',
                        message: `Cannot reuse buffers that have already been assigned. ${usedDetails}. Please use different buffer codes or delete previous jobs for this case.`,
                        already_used: alreadyUsedBuffers.map(b => ({
                            sequence: b.sequence_number,
                            replaced: b.replaces_sequence_no
                        }))
                    }, { status: 400 })
                }
                
                const bufferMap = new Map(bufferCodes?.map(b => [b.sequence_number, b.id]) || [])
                
                // Pair spoiled codes with manual buffers (up to available count)
                for (let i = 0; i < spoiledSequences.length; i++) {
                    const item: any = {
                        job_id: job.id,
                        spoiled_sequence_no: spoiledSequences[i],
                        status: 'pending'
                    }
                    
                    // If we have a manual buffer available, assign it
                    if (i < bufferSequences.length) {
                        item.replacement_code_id = bufferMap.get(bufferSequences[i])
                        item.replacement_sequence_no = bufferSequences[i]
                        console.log(`   Paired: Spoiled ${spoiledSequences[i]} → Buffer ${bufferSequences[i]}`)
                    }
                    
                    itemsToInsert.push(item)
                }
            } else {
                // No manual buffers - worker will auto-assign
                itemsToInsert.push(...jobItems.map(item => ({
                    ...item,
                    job_id: job.id
                })))
            }

            // Insert job items
            const { error: itemsError } = await supabase
                .from('qr_reverse_job_items')
                .insert(itemsToInsert)

            if (itemsError) {
                console.error(`❌ Failed to create job items for Case #${caseNumber}:`, itemsError)
                continue
            }

            // Calculate expected range for normal codes
            const startSeq = (caseNumber - 1) * unitsPerCase + 1
            const endSeq = caseNumber * unitsPerCase

            createdJobs.push({
                job_id: job.id,
                case_number: caseNumber,
                spoiled_count: spoiledSequences.length,
                buffer_provided: bufferSequences.length,
                spoiled_range: `${minSeq}-${maxSeq}`,
                expected_normal_range: `${startSeq}-${endSeq}`
            })

            console.log(`✅ Created job for Case #${caseNumber}: ${spoiledSequences.length} spoiled, ${bufferSequences.length} manual buffers`)
        }

        const duration = Date.now() - startTime
        
        return NextResponse.json({
            success: true,
            message: totalCases > 1 
                ? `Created ${totalCases} separate jobs (one per case) for better processing.`
                : `Job created for Case #${createdJobs[0]?.case_number}.`,
            jobs: createdJobs,
            total_codes: entries.length,
            total_cases: totalCases,
            is_split: totalCases > 1,
            duration_ms: duration
        })

        // OLD CODE BELOW - NO LONGER USED (keeping for reference during migration)
        // The above logic now handles ALL cases by creating one job per case
        /*
        // NORMAL PATH for small jobs (<= 50 cases): Process as before
        console.log('📊 Normal job processing:', { cases: totalCases, orderNo: currentOrderNo })

        // Filter out wrong-order entries (silently ignore them)
        const validEntries = entries.filter(entry => {
            if (entry.parsed?.orderNo && entry.parsed.orderNo !== currentOrderNo) {
                console.log(`⚠️ Ignoring wrong-order code from ${entry.parsed.orderNo}: seq ${entry.parsed.sequenceNumber}`)
                return false
            }
            return true
        })

        if (validEntries.length === 0) {
            return NextResponse.json({ 
                error: 'NO_VALID_CODES',
                message: `No valid codes from ${currentOrderNo}. All entered codes are from different orders.`
            }, { status: 400 })
        }

        // First pass: Classify all entries as spoiled or buffer by querying database
        const classifiedEntriesMap = new Map<number, {
            spoiled: typeof validEntries,
            buffers: typeof validEntries
        }>()
        
        for (const entry of validEntries) {
            const sequenceNumber = entry.parsed?.sequenceNumber
            if (!sequenceNumber) continue
            
            // Query database for ACTUAL case_number (don't calculate!)
            const { data: qrCode } = await supabase
                .from('qr_codes')
                .select('id, is_buffer, batch_id, case_number')
                .eq('batch_id', batch_id)
                .eq('sequence_number', sequenceNumber)
                .maybeSingle()
            
            if (!qrCode) continue
            
            const caseNumber = qrCode.case_number
            
            if (!classifiedEntriesMap.has(caseNumber)) {
                classifiedEntriesMap.set(caseNumber, { spoiled: [], buffers: [] })
            }
            
            const caseGroup = classifiedEntriesMap.get(caseNumber)!
            if (qrCode.is_buffer === true) {
                caseGroup.buffers.push(entry)
            } else {
                caseGroup.spoiled.push(entry)
            }
        }

        // Only process cases that have spoiled codes
        const casesWithSpoiled = Array.from(classifiedEntriesMap.entries())
            .filter(([_, group]) => group.spoiled.length > 0)
        
        console.log('📦 Multi-case grouping:', {
            totalCases: casesWithSpoiled.length,
            cases: casesWithSpoiled.map(([caseNum, group]) => ({
                caseNumber: caseNum,
                spoiledCount: group.spoiled.length,
                bufferCount: group.buffers.length
            }))
        })

        if (casesWithSpoiled.length === 0) {
            return NextResponse.json({ error: 'No valid spoiled codes found. Please enter damaged QR codes that need replacement.' }, { status: 400 })
        }

        const { data: userProfile } = await supabase
            .from('users')
            .select('id, organization_id')
            .eq('id', user.id)
            .single()

        if (!userProfile?.organization_id) {
            return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
        }

        const jobsCreated: Array<{
            job_id: string
            case_number: number
            variant_key: string | null
            total_spoiled: number
            total_buffer: number
        }> = []

        for (const [caseNumber, caseGroup] of casesWithSpoiled) {
            console.log(`🔄 Processing Case #${caseNumber}`)

            const caseEntries = [...caseGroup.spoiled, ...caseGroup.buffers]
            
            const sequenceNumbers = caseEntries
                .map((e: any) => e.parsed?.sequenceNumber)
                .filter((seq: any) => seq !== undefined) as number[]

            const classifiedSpoiled: Array<{ code_id: string; sequence_no: number; code: string }> = []
            const classifiedBuffer: Array<{ code_id: string; sequence_no: number; code: string }> = []
            const alreadyPackedCodes: Array<{ sequence_no: number; code: string }> = []
            const alreadySpoiledCodes: Array<{ sequence_no: number; code: string }> = []
            let variantKey: string | null = null

            for (const entry of caseEntries) {
                const sequenceNumber = entry.parsed?.sequenceNumber
                if (!sequenceNumber) continue

                // CRITICAL: Check if the entry has order info from the parsed QR code
                // If the QR code was pasted (not just sequence number), validate order IMMEDIATELY
                if (entry.parsed?.orderNo && entry.parsed.orderNo !== currentOrderNo) {
                    return NextResponse.json({ 
                        error: 'WRONG_ORDER',
                        message: `❌ Wrong Order! You tried to scan QR code from "${entry.parsed.orderNo}" but you are currently working on "${currentOrderNo}". Please scan unique QR codes from ${currentOrderNo} only.`,
                        details: {
                            attempted_order: entry.parsed.orderNo,
                            current_order: currentOrderNo,
                            sequence_number: sequenceNumber,
                            scanned_code: entry.value
                        }
                    }, { status: 400 })
                }

                // Also check by querying the database (for cases where only sequence number was provided)
                const { data: qrCodeCheck } = await supabase
                    .from('qr_codes')
                    .select(`
                        id, 
                        code, 
                        sequence_number, 
                        batch_id,
                        qr_batches!inner(order_id, orders!inner(order_no))
                    `)
                    .eq('sequence_number', sequenceNumber)
                    .maybeSingle()

                // If code exists but belongs to different order/batch, throw cross-order error
                if (qrCodeCheck && qrCodeCheck.batch_id !== batch_id) {
                    const wrongOrderId = (qrCodeCheck as any).qr_batches?.order_id
                    const wrongOrderNo = (qrCodeCheck as any).qr_batches?.orders?.order_no
                    
                    return NextResponse.json({ 
                        error: 'WRONG_ORDER',
                        message: `❌ Wrong Order! You tried to scan QR code from "${wrongOrderNo || 'another order'}" but you are currently working on "${currentOrderNo}". Please scan unique QR codes from ${currentOrderNo} only.`,
                        details: {
                            attempted_order: wrongOrderNo || wrongOrderId,
                            current_order: currentOrderNo,
                            sequence_number: sequenceNumber,
                            scanned_code: qrCodeCheck.code
                        }
                    }, { status: 400 })
                }

                // Now get the full QR code data for this batch
                const { data: qrCode } = await supabase
                    .from('qr_codes')
                    .select(`
                        id, 
                        code, 
                        sequence_number, 
                        status, 
                        master_code_id, 
                        is_buffer, 
                        variant_key,
                        batch_id
                    `)
                    .eq('batch_id', batch_id)
                    .eq('sequence_number', sequenceNumber)
                    .maybeSingle()

                if (!qrCode) {
                    console.warn(`⚠️ QR code not found for batch ${batch_id}, sequence ${sequenceNumber}`)
                    continue
                }

                if (!variantKey && qrCode.variant_key) {
                    variantKey = qrCode.variant_key
                }

                // Track codes that are already packed (from completed cases)
                if (qrCode.master_code_id && qrCode.status === 'packed') {
                    alreadyPackedCodes.push({ sequence_no: sequenceNumber, code: qrCode.code })
                    continue
                }
                
                // Track codes that are already marked as spoiled
                if (qrCode.status === 'spoiled') {
                    alreadySpoiledCodes.push({ sequence_no: sequenceNumber, code: qrCode.code })
                    continue
                }

                const isBuffer = qrCode.is_buffer === true

                if (isBuffer) {
                    // Filter: Only use buffer codes that belong to the same case (use DB case_number)
                    const bufferCaseNumber = qrCode.case_number
                    if (bufferCaseNumber === caseNumber) {
                        // Valid buffer from same case
                        classifiedBuffer.push({ code_id: qrCode.id, sequence_no: sequenceNumber, code: qrCode.code })
                    } else {
                        // Silently ignore buffer from different case
                        console.log(`⚠️ Ignoring buffer code from Case #${bufferCaseNumber} (seq ${sequenceNumber}) for Case #${caseNumber}`)
                    }
                } else {
                    classifiedSpoiled.push({ code_id: qrCode.id, sequence_no: sequenceNumber, code: qrCode.code })
                }
            }

            // VALIDATION: Skip if only buffer codes provided (no actual spoiled codes)
            if (classifiedSpoiled.length === 0 && classifiedBuffer.length > 0) {
                console.warn(`⚠️ Case #${caseNumber}: Only ${classifiedBuffer.length} buffer code(s) provided, no spoiled codes - skipping`)
                continue // Skip this case, don't create job
            }

            // Process cases with actual spoiled codes
            if (classifiedSpoiled.length > 0) {
                if (classifiedBuffer.length === 0) {
                    // Scenario 1: No buffer codes provided - auto-allocate all (current behavior)
                    console.log(`📦 Case #${caseNumber}: No buffer codes provided. Will auto-allocate ${classifiedSpoiled.length} buffer codes.`)
                    
                    // Check buffer availability for THIS CASE - show warning if insufficient
                    const { count: availableBufferCount, error: bufferCheckError } = await supabase
                        .from('qr_codes')
                        .select('id', { count: 'exact', head: true })
                        .eq('order_id', order_id)
                        .eq('batch_id', batch_id)
                        .eq('case_number', caseNumber)
                        .eq('is_buffer', true)
                        .in('status', ['available', 'buffer_available'])

                    if (!bufferCheckError && availableBufferCount !== null) {
                        if (classifiedSpoiled.length > availableBufferCount) {
                            console.warn(`⚠️ Case #${caseNumber}: Insufficient buffers. Need ${classifiedSpoiled.length}, have ${availableBufferCount}. Unassigned codes will remain spoiled.`)
                            // NOTE: We allow the job to proceed. Worker will mark unassigned codes as 'spoiled_only'
                        }
                    }
                } else if (classifiedBuffer.length < classifiedSpoiled.length) {
                    // Scenario 2: Insufficient buffer codes - will auto-allocate remaining
                    const needAutoAllocate = classifiedSpoiled.length - classifiedBuffer.length
                    console.log(`📦 Case #${caseNumber}: ${classifiedBuffer.length} buffer codes provided, need ${needAutoAllocate} more. Will auto-allocate.`)
                    
                    // Check buffer availability for THIS CASE - show warning if insufficient
                    const { count: availableBufferCount, error: bufferCheckError } = await supabase
                        .from('qr_codes')
                        .select('id', { count: 'exact', head: true })
                        .eq('order_id', order_id)
                        .eq('batch_id', batch_id)
                        .eq('case_number', caseNumber)
                        .eq('is_buffer', true)
                        .in('status', ['available', 'buffer_available'])

                    if (!bufferCheckError && availableBufferCount !== null) {
                        if (needAutoAllocate > availableBufferCount) {
                            console.warn(`⚠️ Case #${caseNumber}: Insufficient buffers for auto-allocation. Need ${needAutoAllocate}, have ${availableBufferCount}. Some codes will remain spoiled.`)
                            // NOTE: We allow the job to proceed. Worker will mark unassigned codes as 'spoiled_only'
                        }
                    }
                } else if (classifiedBuffer.length > classifiedSpoiled.length) {
                    // Scenario 3: Excess buffer codes - use only what's needed
                    const excessCount = classifiedBuffer.length - classifiedSpoiled.length
                    console.log(`⚠️ Case #${caseNumber}: ${excessCount} excess buffer codes provided. Will use only ${classifiedSpoiled.length} buffer codes.`)
                    // Note: The pairing logic below will only pair up to classifiedSpoiled.length anyway
                } else {
                    // Scenario 4: Exact match - use user-provided buffers
                    console.log(`✅ Case #${caseNumber}: Exact match! ${classifiedBuffer.length} spoiled = ${classifiedBuffer.length} buffer codes provided.`)
                }
            }

            if (classifiedSpoiled.length === 0) {
                // Provide detailed error message based on what was found
                if (alreadyPackedCodes.length > 0 && alreadySpoiledCodes.length === 0) {
                    const codeList = alreadyPackedCodes.map(c => `#${c.sequence_no}`).join(', ')
                    return NextResponse.json({ 
                        error: `Case #${caseNumber}: These QR codes (${codeList}) are from a case that has already been completed and packed. You cannot re-enter codes from finished cases. Please check your entries.` 
                    }, { status: 400 })
                } else if (alreadySpoiledCodes.length > 0 && alreadyPackedCodes.length === 0) {
                    const codeList = alreadySpoiledCodes.map(c => `#${c.sequence_no}`).join(', ')
                    return NextResponse.json({ 
                        error: `Case #${caseNumber}: These QR codes (${codeList}) have already been marked as spoiled in a previous job. Please enter different codes.` 
                    }, { status: 400 })
                } else if (alreadyPackedCodes.length > 0 && alreadySpoiledCodes.length > 0) {
                    return NextResponse.json({ 
                        error: `Case #${caseNumber}: The QR codes you entered are either from a completed case or already marked as spoiled. Please verify your entries and try again with valid codes.` 
                    }, { status: 400 })
                } else {
                    // Get the sequences that were attempted for this case
                    const attemptedSequences = caseEntries
                        .map((e: any) => e.parsed?.sequenceNumber)
                        .filter((s: any) => s !== undefined)
                        .join(', ')
                    
                    return NextResponse.json({ 
                        error: `Case #${caseNumber}: No valid spoiled codes found. The QR codes you entered (sequences: ${attemptedSequences}) may not exist in batch ${currentOrderNo} or are not eligible for replacement. Please verify you scanned the correct codes.` 
                    }, { status: 400 })
                }
            }

            const pairings: Array<{
                spoiled_code_id: string
                spoiled_sequence_no: number
                replacement_code_id: string | null
                replacement_sequence_no: number | null
            }> = []

            // NEW LOGIC: Support partial or full user-provided buffers
            if (classifiedBuffer.length > 0) {
                // User provided some or all buffer codes
                const buffersToUse = Math.min(classifiedBuffer.length, classifiedSpoiled.length)
                
                // Pair user-provided buffers first
                for (let i = 0; i < buffersToUse; i++) {
                    pairings.push({
                        spoiled_code_id: classifiedSpoiled[i].code_id,
                        spoiled_sequence_no: classifiedSpoiled[i].sequence_no,
                        replacement_code_id: classifiedBuffer[i].code_id,
                        replacement_sequence_no: classifiedBuffer[i].sequence_no
                    })
                }
                
                // If insufficient buffers provided, add remaining spoiled codes with null replacement
                // Worker will auto-allocate these
                for (let i = buffersToUse; i < classifiedSpoiled.length; i++) {
                    pairings.push({
                        spoiled_code_id: classifiedSpoiled[i].code_id,
                        spoiled_sequence_no: classifiedSpoiled[i].sequence_no,
                        replacement_code_id: null,
                        replacement_sequence_no: null
                    })
                }
                
                console.log(`📊 Pairing result: ${buffersToUse} user-provided, ${classifiedSpoiled.length - buffersToUse} will auto-allocate`)
            } else {
                // No buffers provided - worker will auto-allocate all
                for (const spoiled of classifiedSpoiled) {
                    pairings.push({
                        spoiled_code_id: spoiled.code_id,
                        spoiled_sequence_no: spoiled.sequence_no,
                        replacement_code_id: null,
                        replacement_sequence_no: null
                    })
                }
            }

            const { data: job } = await supabase
                .from('qr_reverse_jobs')
                .insert({
                    order_id,
                    batch_id,
                    manufacturer_org_id: userProfile.organization_id,
                    case_number: caseNumber,
                    variant_key: variantKey || null,
                    total_spoiled: pairings.length,
                    expected_units_per_case: unitsPerCase,
                    status: 'queued',
                    created_by: user.id
                })
                .select()
                .single()

            if (!job) {
                return NextResponse.json({ error: `Failed to create job for Case #${caseNumber}` }, { status: 500 })
            }

            const jobItems = pairings.map(p => ({ ...p, job_id: job.id }))
            await supabase.from('qr_reverse_job_items').insert(jobItems)

            jobsCreated.push({
                job_id: job.id,
                case_number: caseNumber,
                variant_key: variantKey,
                total_spoiled: classifiedSpoiled.length,
                total_buffer: classifiedBuffer.length
            })
        }

        const duration = Date.now() - startTime
        console.log(`✅ All jobs created in ${duration}ms`)

        try {
            const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
            const workerUrl = `${baseUrl}/api/cron/qr-reverse-worker`
            fetch(workerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => {})
        } catch {}

        const response: any = { success: true, duration_ms: duration, jobs: jobsCreated }

        if (jobsCreated.length === 1) {
            const job = jobsCreated[0]
            response.job_id = job.job_id
            response.case_number = job.case_number
            response.variant_key = job.variant_key
            response.total_spoiled = job.total_spoiled
            response.total_buffer = job.total_buffer
            response.message = `Reverse job created for Case #${job.case_number}`
        } else {
            response.message = `Created ${jobsCreated.length} reverse jobs for cases: ${jobsCreated.map(j => `#${j.case_number}`).join(', ')}`
        }

        return NextResponse.json(response)
        */
        // END OF OLD CODE

    } catch (error: any) {
        console.error('❌ Create job error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
