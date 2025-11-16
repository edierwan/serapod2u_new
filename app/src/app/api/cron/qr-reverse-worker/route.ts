import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Mode C Background Worker - Intelligent Buffer Assignment
 * 
 * SCENARIO 1 (Auto-assign): User scans ONLY spoiled codes
 * - User submits: 5 spoiled codes (no buffers provided)
 * - Worker finds 5 available buffers from pool
 * - Worker marks spoiled as 'spoiled', buffers as 'buffer_used'
 * - Result: Auto-replacement with available buffers
 * 
 * SCENARIO 2 (Manual pair): User scans spoiled + specific buffer codes
 * - User submits: 4 spoiled + 4 specific buffers
 * - Worker uses EXACTLY those buffers (no auto-assignment)
 * - Worker validates buffers are available (not already used)
 * - Result: Manual pairing with user-selected buffers
 * 
 * Auto-assignment rules:
 * - Only use buffers with status 'available' or 'buffer_available'
 * - Never reuse buffers already marked 'buffer_used'
 * - Match variant_key if specified
 * - Fail if not enough available buffers in pool
 * 
 * Should be called by cron job every 1-2 minutes
 */

/**
 * Recalculate and update master case statistics
 * 
 * This function:
 * 1. Counts all codes linked to this master (excluding spoiled)
 * 2. Updates qr_master_codes.actual_unit_count
 * 3. Updates qr_master_codes.status (packed/partial)
 * 
 * Used by:
 * - Mode C worker after processing jobs
 * - Admin resync API to fix incorrect counts
 * 
 * @param supabase - Supabase client
 * @param masterId - UUID of the master code to recalculate
 * @param manufacturerOrgId - Organization ID of the manufacturer (from job)
 * @returns Object with expected, actual counts and updated status
 */
async function recalculateMasterCaseStats(supabase: any, masterId: string, manufacturerOrgId?: string) {
  // Get master code details
  const { data: master, error: masterError } = await supabase
    .from('qr_master_codes')
    .select('id, master_code, case_number, expected_unit_count, batch_id, qr_batches(order_id)')
    .eq('id', masterId)
    .single()

  if (masterError || !master) {
    throw new Error(`Master code not found: ${masterId}`)
  }

  const expectedCount = Number(master.expected_unit_count || 0)
  const orderId = master.qr_batches?.order_id || (Array.isArray(master.qr_batches) ? master.qr_batches[0]?.order_id : null)

  // Count ALL codes linked to this master (excluding spoiled)
  // Include: packed, buffer_used, and any other non-spoiled statuses
  // Key insight: master_code_id is the authoritative link, not order_id/batch_id
  const { count: actualCount, error: countError } = await supabase
    .from('qr_codes')
    .select('id', { count: 'exact', head: true })
    .eq('master_code_id', master.id)
    .neq('status', 'spoiled')

  if (countError) {
    throw new Error(`Failed to count codes for master ${master.master_code}: ${countError.message}`)
  }

  const finalCount = actualCount || 0
  // Note: Database constraint only allows specific statuses for qr_master_codes
  // Valid statuses: 'generated', 'printed', 'packed', 'ready_to_ship', 'received_warehouse', etc.
  // We use 'packed' when complete, 'generated' otherwise (no 'partial' status exists)
  const newStatus = finalCount >= expectedCount ? 'packed' : 'generated'
  
  console.log(`[recalculateMasterCaseStats] Master ${master.master_code}: finalCount=${finalCount}, expectedCount=${expectedCount}, newStatus=${newStatus}`)

  // Get scanned_by info from the first non-spoiled code linked to this master
  const { data: sampleCode } = await supabase
    .from('qr_codes')
    .select('last_scanned_by')
    .eq('master_code_id', master.id)
    .neq('status', 'spoiled')
    .limit(1)
    .single()

  const scannedBy = sampleCode?.last_scanned_by || null

  // Use the passed manufacturerOrgId (from job) or fall back to null
  // This ensures scan history appears after Mode C worker completes
  const finalManufacturerOrgId = manufacturerOrgId || null

  // Update master code with manufacturer tracking fields
  // This is CRITICAL for scan history to show the record
  const { error: updateError } = await supabase
    .from('qr_master_codes')
    .update({
      actual_unit_count: finalCount,
      status: newStatus,
      manufacturer_scanned_at: new Date().toISOString(), // REQUIRED for scan history visibility
      manufacturer_scanned_by: scannedBy,
      manufacturer_org_id: finalManufacturerOrgId, // Use org_id from job, not from QR codes
      updated_at: new Date().toISOString()
    })
    .eq('id', master.id)

  if (updateError) {
    throw new Error(`Failed to update master ${master.master_code}: ${updateError.message}`)
  }

  console.log(`✅ Master case ${master.case_number} updated with manufacturer scan timestamp`)


  // Log for observability
  console.log(`[ModeC] Master sync: case ${master.case_number}, expected ${expectedCount}, counted ${finalCount} (${newStatus}), master_id=${master.id}`)

  // Warning if count is 0 but we expected codes
  if (finalCount === 0 && expectedCount > 0) {
    console.warn(`⚠️ Master case ${master.case_number} has 0 codes linked but expected ${expectedCount}. Master: ${master.master_code}, Order: ${orderId || 'unknown'}`)
  }

  return {
    master_code: master.master_code,
    case_number: master.case_number,
    expected_unit_count: expectedCount,
    actual_unit_count: finalCount,
    status: newStatus,
    order_id: orderId
  }
}

/**
 * Main worker processing function
 * Used by both GET (Vercel cron) and POST (manual trigger)
 */
async function processJobs(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Verify authorization for Vercel Cron
    const authHeader = request.headers.get('authorization')
    const isDevelopment = process.env.NODE_ENV === 'development'
    
    // Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
    // Check if it's from Vercel Cron (has authorization header) or manual trigger
    if (!isDevelopment && authHeader) {
      const cronSecret = process.env.CRON_SECRET
      
      // If CRON_SECRET is set, validate it
      if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        console.warn('⚠️ Unauthorized worker access attempt - invalid CRON_SECRET')
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }
      
      console.log('✅ Authorized: Vercel Cron job')
    } else if (isDevelopment) {
      console.log('🔓 Development mode: Auth check skipped')
    } else {
      console.log('ℹ️ Manual trigger (no auth header)')
    }

    const supabase = await createClient()

    // Fetch queued jobs (exclude cancelled)
    // Increased from 10 to 100 to process more jobs per run (large batch support)
    const { data: queuedJobs, error: fetchError } = await supabase
      .from('qr_reverse_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(100)

    if (fetchError) {
      console.error('❌ Failed to fetch queued jobs:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch jobs' },
        { status: 500 }
      )
    }

    if (!queuedJobs || queuedJobs.length === 0) {
      console.log('ℹ️  No queued jobs found. Checking job statuses...')

      // Log recent jobs to help debug
      const { data: recentJobs } = await supabase
        .from('qr_reverse_jobs')
        .select('id, status, case_number, variant_key, created_at')
        .order('created_at', { ascending: false })
        .limit(5)

      console.log('📋 Recent jobs:', recentJobs)

      return NextResponse.json({
        message: 'No queued jobs to process',
        processed: 0,
        recent_jobs: recentJobs
      })
    }

    console.log(`📋 Found ${queuedJobs.length} queued job(s) to process`)
    console.log(`   Jobs:`, queuedJobs.map(j => ({ id: j.id, case: j.case_number, variant: j.variant_key })))

    const results: any[] = []

    // Process each job
    for (const job of queuedJobs) {
      const jobStartTime = Date.now()

      try {
        // Validate job has case_number
        if (!job.case_number) {
          throw new Error('Job missing case_number')
        }

        // STRUCTURED LOG: Job Start
        console.log('[ModeC] Start job', {
          jobId: job.id,
          orderId: job.order_id,
          batchId: job.batch_id,
          caseNumber: job.case_number,
          variantKey: job.variant_key,
          totalSpoiled: job.total_spoiled,
        })

        // Mark job as running
        await supabase
          .from('qr_reverse_jobs')
          .update({
            status: 'running',
            started_at: new Date().toISOString()
          })
          .eq('id', job.id)

        // Get the SPECIFIC master code for THIS case_number
        // CRITICAL: Each case has its own master_code, don't use .limit(1) which could grab a different case!
        const { data: masterCode, error: masterError } = await supabase
          .from('qr_master_codes')
          .select('id, master_code, expected_unit_count, case_number')
          .eq('batch_id', job.batch_id)
          .eq('case_number', job.case_number) // FIXED: Must match the job's case_number
          .single()

        if (masterError || !masterCode) {
          console.error(`❌ Master code not found for batch ${job.batch_id}, case ${job.case_number}:`, masterError)
          throw new Error(`Master code not found for batch ${job.batch_id}, case ${job.case_number}. Please ensure master codes are generated for this batch.`)
        }

        console.log(`📍 Using master for case #${job.case_number}: ${masterCode.master_code} (expected: ${masterCode.expected_unit_count} units per case)`)

        // Get job items first to determine actual sequence range
        // This is important for split batch jobs that span multiple cases
        const { data: jobItems, error: itemsError } = await supabase
          .from('qr_reverse_job_items')
          .select('*')
          .eq('job_id', job.id)
          .is('processed_at', null)

        if (itemsError) {
          throw new Error(`Failed to fetch job items: ${itemsError.message}`)
        }

        console.log(`🔴 Processing ${jobItems?.length || 0} item(s)`)

        if (!jobItems || jobItems.length === 0) {
          console.log('✅ No items to process, marking job as completed')
          await supabase
            .from('qr_reverse_jobs')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString()
            })
            .eq('id', job.id)
          continue
        }

        // CRITICAL: Use job.case_number (from database) instead of calculating from sequences
        // Buffer codes have sequences outside the normal range, so calculating would be WRONG
        // Example: Buffer seq 152 belongs to Case 1 (not Case 4!)
        const caseNumber = job.case_number
        
        if (!caseNumber) {
          throw new Error('Job missing case_number - cannot process')
        }
        
        // Calculate expected sequence range for NORMAL codes in this case
        const startSeq = (caseNumber - 1) * masterCode.expected_unit_count + 1
        const endSeq = caseNumber * masterCode.expected_unit_count
        
        console.log(`📐 Processing Case #${caseNumber} (normal code range: ${startSeq}-${endSeq})`)

        // Load ALL codes for this case (normal + buffer) using case_number from database
        // This is MUCH more efficient and correct than calculating from sequences
        const { data: normalCodes, error: normalCodesError } = await supabase
          .from('qr_codes')
          .select('id, code, sequence_number, status, case_number, variant_key, is_buffer')
          .eq('order_id', job.order_id)
          .eq('batch_id', job.batch_id)
          .eq('case_number', caseNumber) // Filter by case_number (includes normal + buffer)
          .eq('is_buffer', false) // Only normal codes for validation
          .order('sequence_number', { ascending: true })

        if (normalCodesError) {
          throw new Error(`Failed to load case codes: ${normalCodesError.message}`)
        }

        console.log(`📦 Loaded ${normalCodes?.length || 0} normal codes for Case #${caseNumber}`)
        console.log(`   Expected: ${masterCode.expected_unit_count} codes per case`)
        console.log(`   Variant Key: ${job.variant_key || 'not specified'}`)
        if (normalCodes && normalCodes.length > 0) {
          console.log(`   Actual sequences: ${normalCodes[0].sequence_number} - ${normalCodes[normalCodes.length - 1].sequence_number}`)
        }

        // Note: Buffer pool will be loaded later if needed for Scenario 1 (auto-assignment)

        // HANDLE VERIFICATION-ONLY JOB: 0 items means case is already complete
        if (!jobItems || jobItems.length === 0) {
          console.log(`✅ VERIFICATION JOB: Case #${caseNumber} has no spoiled codes - marking as complete`)
          
          await supabase
            .from('qr_reverse_jobs')
            .update({
              status: 'completed',
              total_spoiled: 0,
              total_replacements: 0,
              completed_at: new Date().toISOString()
            })
            .eq('id', job.id)
          
          results.push({
            jobId: job.id,
            status: 'completed',
            message: `Case #${caseNumber} verified complete - 0 spoiled, 0 replaced`
          })
          continue
        }

        // INTELLIGENT DETECTION: Check which scenario we're in
        const itemsWithBuffer = jobItems?.filter(i => i.replacement_code_id) || []
        const itemsWithoutBuffer = jobItems?.filter(i => !i.replacement_code_id) || []
        
        const isScenario1 = itemsWithoutBuffer.length > 0 && itemsWithBuffer.length === 0 // All items need auto-assignment
        const isScenario2 = itemsWithBuffer.length > 0 && itemsWithoutBuffer.length === 0 // All items have manual buffers
        const isMixed = itemsWithBuffer.length > 0 && itemsWithoutBuffer.length > 0 // Some have, some don't (partial manual)

        // ALLOW MIXED SCENARIO - user can provide SOME buffers manually, system auto-assigns the rest
        if (isMixed) {
          console.log(`🔧 MIXED SCENARIO: ${itemsWithBuffer.length} manual buffer(s), ${itemsWithoutBuffer.length} need auto-assignment`)
        }

        let replacementCount = 0
        let skippedCount = 0
        let bufferPool: any[] = []

        if (isScenario1 || isMixed) {
          // SCENARIO 1 OR MIXED: Auto-assign buffers from available pool
          if (isScenario1) {
            console.log(`🤖 SCENARIO 1: Auto-assigning ${itemsWithoutBuffer.length} buffer(s) from available pool`)
          } else {
            console.log(`🔧 MIXED SCENARIO: Auto-assigning ${itemsWithoutBuffer.length} buffer(s) (${itemsWithBuffer.length} already manual)`)
          }
          
          // Build buffer query
          // CRITICAL: Filter buffers by CASE NUMBER for performance and correctness
          // Each case has its own dedicated buffer pool (e.g., Case 1 → Buffers with case_number=1)
          let bufferQuery = supabase
            .from('qr_codes')
            .select('id, code, sequence_number, status, is_buffer, variant_key, case_number')
            .eq('order_id', job.order_id)
            .eq('batch_id', job.batch_id)
            .eq('is_buffer', true)
            .eq('case_number', job.case_number) // FILTER BY CASE - Only buffers for THIS case
            .in('status', ['available', 'buffer_available'])

          // Filter by variant_key to match the spoiled codes' variant
          // Use the FULL variant_key format from job (PROD-xxx-yyy) which matches database
          if (job.variant_key) {
            bufferQuery = bufferQuery.eq('variant_key', job.variant_key)
            console.log(`   🔧 Variant filter: "${job.variant_key}"`)
          } else {
            console.log(`   🔧 No variant filter (accepting any variant)`)
          }
          
          console.log(`   🔧 Case filter: Only buffers for Case #${job.case_number}`)

          const { data: availableBuffers, error: bufferPoolError } = await bufferQuery
            .order('sequence_number', { ascending: true })
            .limit(itemsWithoutBuffer.length * 2) // Query extra to show available pool size

          if (bufferPoolError) {
            throw new Error(`Failed to load available buffers for Case #${job.case_number}: ${bufferPoolError.message}`)
          }

          // Count total available buffers for this case (diagnostic)
          const { count: totalBuffersForCase } = await supabase
            .from('qr_codes')
            .select('id', { count: 'exact', head: true })
            .eq('order_id', job.order_id)
            .eq('batch_id', job.batch_id)
            .eq('is_buffer', true)
            .eq('case_number', job.case_number)

          console.log(`📊 Buffer Pool for Case #${job.case_number}:`)
          console.log(`   Total buffers allocated: ${totalBuffersForCase || 0}`)
          console.log(`   Available now: ${availableBuffers?.length || 0}`)
          console.log(`   Need for this job: ${itemsWithoutBuffer.length}`)

          if (!availableBuffers || availableBuffers.length < itemsWithoutBuffer.length) {
            // Provide detailed error with case-specific context
            const { count: usedBuffers } = await supabase
              .from('qr_codes')
              .select('id', { count: 'exact', head: true })
              .eq('order_id', job.order_id)
              .eq('batch_id', job.batch_id)
              .eq('is_buffer', true)
              .eq('case_number', job.case_number)
              .eq('status', 'buffer_used')

            throw new Error(
              `❌ Not enough buffers for Case #${job.case_number}!\n` +
              `   Allocated: ${totalBuffersForCase || 0} buffer codes\n` +
              `   Already used: ${usedBuffers || 0}\n` +
              `   Available: ${availableBuffers?.length || 0}\n` +
              `   Needed: ${itemsWithoutBuffer.length}\n` +
              `   Shortfall: ${itemsWithoutBuffer.length - (availableBuffers?.length || 0)}\n\n` +
              `This case has exhausted its buffer pool. ` +
              (itemsWithoutBuffer.length > (totalBuffersForCase || 0) 
                ? `You're trying to replace ${itemsWithoutBuffer.length} codes but this case only has ${totalBuffersForCase} buffers allocated (10% of case size).`
                : `Consider reducing spoilage or contact admin to allocate more buffers.`)
            )
          }

          // Only use what we need
          bufferPool = availableBuffers.slice(0, itemsWithoutBuffer.length)
          console.log(`✅ Auto-assigning ${bufferPool.length} buffer(s) from Case #${job.case_number} pool`)
          console.log(`   Buffer sequences: ${bufferPool.map(b => b.sequence_number).join(', ')}`)
          console.log(`   Buffer case numbers: ${bufferPool.map(b => b.case_number).join(', ')} (all should be ${job.case_number})`)
          console.log(`   Remaining available: ${(availableBuffers?.length || 0) - bufferPool.length}`)

        } else if (isScenario2) {
          // SCENARIO 2: Use user-provided buffers
          console.log(`👤 SCENARIO 2: Using ${itemsWithBuffer.length} manually provided buffer(s)`)
          console.log(`✅ All ${jobItems?.length || 0} spoiled codes have buffer assignments`)
        }

        // ============================================================
        // PERFORMANCE OPTIMIZATION: Batch all database operations
        // Instead of querying/updating one item at a time (slow!)
        // We fetch ALL codes upfront and batch ALL updates at the end
        // ============================================================
        
        console.log(`⚡ BATCH MODE: Fetching all codes for case #${job.case_number} upfront...`)
        
        // Step 1: Fetch ALL spoiled codes in ONE query
        const spoiledSequences = (jobItems || []).map(item => item.spoiled_sequence_no)
        const { data: allSpoiledCodes, error: fetchSpoiledError } = await supabase
          .from('qr_codes')
          .select('id, code, sequence_number, status, case_number, is_buffer')
          .eq('order_id', job.order_id)
          .eq('batch_id', job.batch_id)
          .in('sequence_number', spoiledSequences)
        
        if (fetchSpoiledError) {
          throw new Error(`Failed to fetch spoiled codes: ${fetchSpoiledError.message}`)
        }
        
        // Create map: sequence -> code data
        const spoiledCodeMap = new Map(allSpoiledCodes?.map(c => [c.sequence_number, c]) || [])
        console.log(`✅ Fetched ${spoiledCodeMap.size} spoiled codes in ONE query`)
        
        // Step 2: Fetch ALL manual buffer codes in ONE query (if Scenario 1 with manual selection)
        const manualBufferIds = (jobItems || [])
          .filter(item => item.replacement_code_id) // Has manual buffer ID
          .map(item => item.replacement_code_id!)
        
        let manualBufferMap = new Map<string, any>()
        if (manualBufferIds.length > 0) {
          const { data: allManualBuffers, error: fetchManualError } = await supabase
            .from('qr_codes')
            .select('id, sequence_number, status, replaces_sequence_no, case_number, is_buffer')
            .in('id', manualBufferIds)
          
          if (fetchManualError) {
            throw new Error(`Failed to fetch manual buffer codes: ${fetchManualError.message}`)
          }
          
          manualBufferMap = new Map(allManualBuffers?.map(c => [c.id, c]) || [])
          console.log(`✅ Fetched ${manualBufferMap.size} manual buffer codes in ONE query`)
        }
        
        // Arrays to collect batch updates
        const spoiledCodeUpdates: string[] = []
        const bufferCodeUpdates: Array<{ id: string, spoiled_seq: number, buffer_seq: number }> = []
        const jobItemUpdates: Array<{ id: string, buffer_id: string, buffer_seq: number, status: string }> = []
        
        let autoAssignIndex = 0 // Track which buffer to auto-assign next
        let itemsProcessed = 0

        // Process each item (NO DATABASE QUERIES IN LOOP!)
        for (const item of jobItems || []) {
          // Check cancellation status every 10 items (not every single item - too slow!)
          if (itemsProcessed % 10 === 0) {
            const { data: latestJob } = await supabase
              .from('qr_reverse_jobs')
              .select('status')
              .eq('id', job.id)
              .single()

            if (latestJob?.status === 'cancelled') {
              console.log('[ModeC] Job cancelled mid-processing', { jobId: job.id })
              return NextResponse.json({
                success: true,
                message: 'Job cancelled',
                processed: results.length,
                results
              })
            }
          }
          itemsProcessed++

          // Step 1: Get spoiled code from pre-fetched map (NO DATABASE QUERY!)
          const spoiledCode = spoiledCodeMap.get(item.spoiled_sequence_no)
          
          if (!spoiledCode) {
            throw new Error(
              `Spoiled code sequence ${item.spoiled_sequence_no} not found in this batch. ` +
              `This code does not exist or belongs to a different order.`
            )
          }
          
          // Validate the code belongs to THIS case
          if (spoiledCode.case_number !== caseNumber) {
            throw new Error(
              `Spoiled code sequence ${item.spoiled_sequence_no} belongs to Case #${spoiledCode.case_number}, ` +
              `but this job is for Case #${caseNumber}. Internal error - job items mismatch.`
            )
          }

          // Check if already packed (safety check - skip)
          if (spoiledCode.status === 'packed') {
            console.warn(`⚠️ Sequence ${item.spoiled_sequence_no} already packed, skipping`)
            skippedCount++
            continue
          }

          // Add to batch update list (will update all at once later)
          spoiledCodeUpdates.push(spoiledCode.id)

          // Step 2: Assign buffer (manual or auto)
          let bufferCodeId: string
          let bufferSequenceNo: number

          if (item.replacement_code_id) {
            // SCENARIO 2: User provided specific buffer
            // VALIDATION: Lookup pre-fetched buffer (NO DATABASE QUERY!)
            const bufferCheck = manualBufferMap.get(item.replacement_code_id)

            if (!bufferCheck) {
              console.error(`❌ Buffer code not found: ${item.replacement_code_id}`)
              throw new Error(`Buffer code not found for sequence ${item.replacement_sequence_no}`)
            }
            
            // CRITICAL: Validate buffer belongs to THIS case
            if (bufferCheck.case_number !== job.case_number) {
              console.error(`❌ Wrong case buffer: Seq ${bufferCheck.sequence_number} belongs to Case #${bufferCheck.case_number}, not Case #${job.case_number}`)
              throw new Error(
                `❌ Wrong buffer code! Sequence ${bufferCheck.sequence_number} is allocated for Case #${bufferCheck.case_number}, ` +
                `but you're trying to use it for Case #${job.case_number}. ` +
                `Each case has its own dedicated buffer pool. Please scan buffer codes that belong to Case #${job.case_number}.`
              )
            }
            
            // Validate it's actually a buffer code
            if (!bufferCheck.is_buffer) {
              console.error(`❌ Not a buffer: Seq ${bufferCheck.sequence_number} is a normal code`)
              throw new Error(`Sequence ${bufferCheck.sequence_number} is not a buffer code. Only buffer codes can replace spoiled codes.`)
            }

            // Check if buffer already used
            if (bufferCheck.status === 'buffer_used') {
              console.error(`❌ Buffer already used: Seq ${bufferCheck.sequence_number} (already replaced seq ${bufferCheck.replaces_sequence_no} in case ${bufferCheck.case_number})`)
              throw new Error(`Buffer code ${bufferCheck.sequence_number} has already been used to replace sequence ${bufferCheck.replaces_sequence_no} in case ${bufferCheck.case_number}. Cannot use same buffer twice.`)
            }

            // Check if buffer status is available
            if (bufferCheck.status && !['available', 'buffer_available'].includes(bufferCheck.status)) {
              console.error(`❌ Buffer not available: Seq ${bufferCheck.sequence_number}, status: ${bufferCheck.status}`)
              throw new Error(`Buffer code ${bufferCheck.sequence_number} is not available (status: ${bufferCheck.status})`)
            }

            bufferCodeId = item.replacement_code_id
            bufferSequenceNo = bufferCheck.sequence_number
            console.log(`  🟢 Using manual buffer: Seq ${bufferSequenceNo} → replaces Seq ${item.spoiled_sequence_no}`)

          } else {
            // SCENARIO 1: Auto-assign from buffer pool
            if (!bufferPool || autoAssignIndex >= bufferPool.length) {
              // No buffer available - mark as spoiled_only (code stays spoiled, no replacement)
              console.warn(`⚠️ No buffer available for spoiled code ${item.spoiled_sequence_no}. Marking as spoiled_only.`)
              
              await supabase
                .from('qr_reverse_job_items')
                .update({
                  status: 'spoiled_only',
                  processed_at: new Date().toISOString()
                })
                .eq('id', item.id)
              
              // Track this for user notification
              skippedCount++
              continue // Skip to next item (don't try to assign buffer)
            }

            const autoBuffer = bufferPool[autoAssignIndex]
            bufferCodeId = autoBuffer.id
            bufferSequenceNo = autoBuffer.sequence_number
            autoAssignIndex++

            console.log(`  🤖 Auto-assigned buffer: Seq ${bufferSequenceNo} → replaces Seq ${item.spoiled_sequence_no}`)
          }

          // Add to batch update lists (NO DATABASE UPDATE IN LOOP!)
          bufferCodeUpdates.push({
            id: bufferCodeId,
            spoiled_seq: item.spoiled_sequence_no,
            buffer_seq: bufferSequenceNo
          })
          
          jobItemUpdates.push({
            id: item.id,
            buffer_id: bufferCodeId,
            buffer_seq: bufferSequenceNo,
            status: 'replaced'
          })

          replacementCount++
        }

        // BATCH EXECUTION: Execute all updates in 3 batch operations instead of N individual queries
        console.log(`\n🚀 BATCH EXECUTION START:`)
        console.log(`   - Spoiled codes to mark: ${spoiledCodeUpdates.length}`)
        console.log(`   - Buffer codes to update: ${bufferCodeUpdates.length}`)
        console.log(`   - Job items to update: ${jobItemUpdates.length}`)

        // Batch 1: Mark all spoiled codes
        if (spoiledCodeUpdates.length > 0) {
          const { error: markSpoiledError } = await supabase
            .from('qr_codes')
            .update({ status: 'spoiled', updated_at: new Date().toISOString() })
            .in('id', spoiledCodeUpdates)
          
          if (markSpoiledError) {
            console.error(`❌ Batch update failed (spoiled):`, markSpoiledError)
            throw new Error(`Failed to batch mark codes as spoiled: ${markSpoiledError.message}`)
          }
          console.log(`   ✅ Batch 1/3: Marked ${spoiledCodeUpdates.length} codes as spoiled`)
        }

        // Batch 2: Update all buffer codes (chunk into groups for large datasets)
        if (bufferCodeUpdates.length > 0) {
          const BUFFER_CHUNK_SIZE = 1000
          for (let i = 0; i < bufferCodeUpdates.length; i += BUFFER_CHUNK_SIZE) {
            const chunk = bufferCodeUpdates.slice(i, i + BUFFER_CHUNK_SIZE)
            
            // Update each buffer individually within the chunk (must set unique replaces_sequence_no per row)
            for (const buf of chunk) {
              const { error: bufferError } = await supabase
                .from('qr_codes')
                .update({
                  status: 'buffer_used',
                  master_code_id: masterCode.id,
                  case_number: job.case_number,
                  variant_key: job.variant_key,
                  replaces_sequence_no: buf.spoiled_seq,
                  updated_at: new Date().toISOString()
                })
                .eq('id', buf.id)
              
              if (bufferError) {
                console.error(`❌ Buffer update failed (id=${buf.id}):`, bufferError)
                throw new Error(`Failed to update buffer code: ${bufferError.message}`)
              }
            }
          }
          console.log(`   ✅ Batch 2/3: Updated ${bufferCodeUpdates.length} buffer codes`)
        }

        // Batch 3: Update all job items (can batch these since all fields are same except IDs)
        if (jobItemUpdates.length > 0) {
          for (const item of jobItemUpdates) {
            const { error: itemError } = await supabase
              .from('qr_reverse_job_items')
              .update({
                replacement_code_id: item.buffer_id,
                replacement_sequence_no: item.buffer_seq,
                status: item.status,
                processed_at: new Date().toISOString()
              })
              .eq('id', item.id)
            
            if (itemError) {
              console.error(`❌ Job item update failed (id=${item.id}):`, itemError)
              throw new Error(`Failed to update job item: ${itemError.message}`)
            }
          }
          console.log(`   ✅ Batch 3/3: Updated ${jobItemUpdates.length} job items`)
        }

        console.log(`✅ BATCH EXECUTION COMPLETE: Processed ${replacementCount} spoiled codes replaced with ${replacementCount} buffer codes`)

        // Step 5: Link good codes + buffer_used codes to master
        // All items must have buffers in Scenario 2 - always mark as 'packed'
        const targetStatus = 'packed'

        console.log(`\n📍 Step 5: Linking good codes to master case #${job.case_number}`)
        console.log(`   Filter: order=${job.order_id}, batch=${job.batch_id}`)
        console.log(`   Sequence range: ${startSeq}-${endSeq} (Case ${job.case_number})`)
        console.log(`   Include: available, generated, printed`)
        console.log(`   Exclude: spoiled, buffer_used (buffers already linked)`)
        console.log(`   Status action: Mark as PACKED`)

        // Update codes: link to master AND set case_number (using sequence range calculated earlier)
        const { data: linkedCodes, error: linkError } = await supabase
          .from('qr_codes')
          .update({
            master_code_id: masterCode.id,
            case_number: job.case_number, // SET case_number for these codes
            status: targetStatus, // 'packed' if complete, 'printed' if partial
            updated_at: new Date().toISOString()
          })
          .eq('order_id', job.order_id)
          .eq('batch_id', job.batch_id)
          .eq('is_buffer', false) // Only normal codes (buffers handled separately)
          .gte('sequence_number', startSeq)
          .lte('sequence_number', endSeq)
          .in('status', ['available', 'generated', 'printed']) // Don't include buffer_used here
          .select('id, code, sequence_number, status')

        if (linkError) {
          console.error(`❌ Failed to link codes to master:`, linkError)
          throw new Error(`Failed to link codes to master: ${linkError.message}`)
        }

        // Show first few linked codes for verification
        if (linkedCodes && linkedCodes.length > 0) {
          const sampleCodes = linkedCodes.slice(0, 5).map(c => `Seq ${c.sequence_number}`).join(', ')
          console.log(`   📋 Sample codes: ${sampleCodes}${linkedCodes.length > 5 ? ` ... +${linkedCodes.length - 5} more` : ''}`)
        }

        // ALWAYS recalculate master stats after linking codes
        // This ensures actual_unit_count is correct even if no spoiled codes were processed
        console.log(`\n📊 Recalculating master case statistics...`)
        // Pass manufacturer_org_id from job to ensure scan history visibility
        const masterStats = await recalculateMasterCaseStats(supabase, masterCode.id, job.manufacturer_org_id)
        
        const actualFinalCount = masterStats.actual_unit_count
        console.log(`   ✅ Master ${masterCode.master_code}: ${actualFinalCount}/${masterStats.expected_unit_count} codes (${masterStats.status})`)

        // Count spoiled and buffer_used codes for comprehensive logging
        const { count: spoiledCount } = await supabase
          .from('qr_codes')
          .select('id', { count: 'exact', head: true })
          .eq('master_code_id', masterCode.id)
          .eq('status', 'spoiled')

        const { count: bufferUsedCount } = await supabase
          .from('qr_codes')
          .select('id', { count: 'exact', head: true })
          .eq('master_code_id', masterCode.id)
          .eq('status', 'buffer_used')

        // STRUCTURED SUMMARY: Complete job statistics
        console.log(`\n📋 JOB SUMMARY for Case #${job.case_number}:`)
        console.log(`   Master Code: ${masterCode.master_code}`)
        console.log(`   Order ID: ${job.order_id}`)
        console.log(`   Batch ID: ${job.batch_id}`)
        console.log(`   Expected Count: ${masterStats.expected_unit_count}`)
        console.log(`   Spoiled Codes: ${spoiledCount || 0}`)
        console.log(`   Buffer Used: ${bufferUsedCount || 0}`)
        console.log(`   Actual Unit Count: ${actualFinalCount}`)
        console.log(`   Master Status: ${masterStats.status}`)
        console.log(`   Replacements Made: ${replacementCount}`)

        // Job completed - all spoiled codes have buffer replacements
        console.log(`✅ Job completed: ${replacementCount} spoiled codes replaced, ${actualFinalCount} total codes in master`)

        const { data: updatedJob, error: completeError } = await supabase
          .from('qr_reverse_jobs')
          .update({
            status: 'completed',
            total_replacements: replacementCount,
            master_code_id: masterCode.id,
            master_code: masterCode.master_code,
            final_unit_count: actualFinalCount,
            completed_at: new Date().toISOString()
          })
          .eq('id', job.id)
          .select()
          .single()

        if (completeError) {
          console.error(`❌ Failed to complete job:`, completeError)
          throw new Error(`Failed to complete job: ${completeError.message}`)
        }

        const jobDuration = Date.now() - jobStartTime

        // Verify job items were updated correctly
        const { data: verifyItems } = await supabase
          .from('qr_reverse_job_items')
          .select('id, status, spoiled_sequence_no, replacement_sequence_no')
          .eq('job_id', job.id)

        const verifyReplaced = verifyItems?.filter(i => i.status === 'replaced').length || 0
        const verifyPending = verifyItems?.filter(i => i.status === 'pending' || !i.status).length || 0

        console.log(`📊 Job items verification: ${verifyReplaced} replaced, ${verifyPending} pending, ${verifyItems?.length || 0} total`)

        // STRUCTURED LOG: Job Finished
        console.log('[ModeC] Job finished', {
          jobId: job.id,
          status: updatedJob?.status || 'completed',
          totalSpoiled: updatedJob?.total_spoiled || job.total_spoiled,
          totalReplacements: updatedJob?.total_replacements || replacementCount,
          replacementCountActual: replacementCount,
          verifyReplacedItems: verifyReplaced,
          verifyPendingItems: verifyPending,
          finalUnitCount: updatedJob?.final_unit_count || actualFinalCount,
          masterCode: updatedJob?.master_code || masterCode.master_code,
          error: updatedJob?.error_message ?? null,
          durationMs: jobDuration,
        })

        console.log(`✅ Job ${job.id} completed in ${jobDuration}ms (${replacementCount} replacements, verified: ${verifyReplaced} items with status='replaced')`)

        results.push({
          job_id: job.id,
          case_number: job.case_number,
          success: true,
          replacements: replacementCount,
          final_unit_count: actualFinalCount,
          master_code: masterCode.master_code,
          duration_ms: jobDuration
        })

      } catch (error: any) {
        console.error(`❌ Job ${job.id} failed:`, error)

        // Mark job as failed
        const { data: failedJob } = await supabase
          .from('qr_reverse_jobs')
          .update({
            status: 'failed',
            error_message: error.message,
            completed_at: new Date().toISOString()
          })
          .eq('id', job.id)
          .select()
          .single()

        // STRUCTURED LOG: Job Failed
        console.log('[ModeC] Job finished', {
          jobId: job.id,
          status: 'failed',
          totalSpoiled: failedJob?.total_spoiled || job.total_spoiled,
          totalReplacements: failedJob?.total_replacements || 0,
          finalUnitCount: failedJob?.final_unit_count || 0,
          masterCode: failedJob?.master_code || null,
          error: error.message,
          durationMs: Date.now() - jobStartTime,
        })

        results.push({
          job_id: job.id,
          case_number: job.case_number,
          success: false,
          error: error.message
        })
      }
    }

    const totalDuration = Date.now() - startTime
    console.log(`\n✅ Worker completed: ${results.length} job(s) in ${totalDuration}ms`)

    return NextResponse.json({
      success: true,
      processed: results.length,
      results,
      duration_ms: totalDuration
    })

  } catch (error: any) {
    console.error('❌ Worker error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET handler - Called by Vercel Cron Jobs
 * Vercel cron jobs use GET requests by default
 */
export async function GET(request: NextRequest) {
  console.log('🔔 Cron trigger: GET request from Vercel')
  return processJobs(request)
}

/**
 * POST handler - Manual trigger for testing/debugging
 * Can be called manually with CRON_SECRET for testing
 */
export async function POST(request: NextRequest) {
  console.log('🔧 Manual trigger: POST request')
  return processJobs(request)
}
