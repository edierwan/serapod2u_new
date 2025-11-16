'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
    ClipboardPaste,
    Loader2,
    CheckCircle,
    AlertTriangle,
    Package,
    RefreshCw,
    Info,
    Zap,
    XCircle,
    ChevronDown,
    Eye,
    EyeOff,
    Trash2
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { parseError } from '@/lib/error-handler'

interface UserProfile {
    id: string
    email: string
    role_code: string
    organization_id: string
    organizations: {
        id: string
        org_name: string
        org_type_code: string
    }
}

interface BatchProgress {
    batch_id: string
    batch_code: string
    order_id: string
    order_no: string
    buyer_org_name: string
    total_master_codes: number
    packed_master_codes: number
    total_buffer_codes: number
    used_buffer_codes: number
}

interface ModeCReverseCaseViewProps {
    userProfile: UserProfile
    currentBatchProgress: BatchProgress | null
    isOrderLocked: boolean
    onJobComplete?: () => void
}

interface ReverseJob {
    id: string
    case_number: number
    variant_key: string | null
    status: string
    total_spoiled: number
    total_replacements: number | null
    master_code: string | null
    final_unit_count: number | null
    error_message: string | null
    created_at: string
    started_at: string | null
    completed_at: string | null
    pending_items: number
    replaced_items: number
    total_items: number
    canCancel?: boolean
    // Progress tracking (TASK 1)
    processed?: number
    total_expected?: number
    progress_pct?: number
    // Unassigned spoiled codes (no buffer replacement)
    unassigned_count?: number
    unassigned_sequences?: number[]
}

export default function ModeCReverseCaseView({
    userProfile,
    currentBatchProgress,
    isOrderLocked,
    onJobComplete
}: ModeCReverseCaseViewProps) {
    const { toast } = useToast()

    // Track component mount status
    const [isMounted, setIsMounted] = useState(true)
    
    const [spoiledInput, setSpoiledInput] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [jobs, setJobs] = useState<ReverseJob[]>([])
    const [loadingJobs, setLoadingJobs] = useState(false)
    const [workerRunning, setWorkerRunning] = useState(false) // Separate state for worker execution
    const [bulkDeleting, setBulkDeleting] = useState(false) // State for bulk delete operation
    const [pollingJobId, setPollingJobId] = useState<string | null>(null)
    const [cancellingJobId, setCancellingJobId] = useState<string | null>(null)
    
    // Timing tracking
    const [submitStartTime, setSubmitStartTime] = useState<number | null>(null)
    const [submitLineCount, setSubmitLineCount] = useState<number>(0)
    const [pendingJobCreation, setPendingJobCreation] = useState<{batchId: string, timestamp: number} | null>(null) // Track ongoing job creation
    const [deletingJobId, setDeletingJobId] = useState<string | null>(null)
    const [showCompletedJobs, setShowCompletedJobs] = useState(false)
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        running: true,    // Expanded by default (show running jobs)
        queued: false,    // COLLAPSED by default (just show count)
        failed: false,    // Collapsed by default
        completed: false, // Collapsed by default
        cancelled: false  // Collapsed by default
    })
    const [inputAnalysis, setInputAnalysis] = useState<{
        spoiledCount: number
        bufferProvidedCount: number
        autoAllocateCount: number
        excessBufferCount: number
        ignoredBuffers: Array<{ sequence: number, fromCase: number, forCase: number }> | null
        wrongOrderCodes: Array<{ sequence: number, orderNo: string }> | null
        insufficientBuffers: { needed: number, available: number, caseNumber: number } | null
    } | null>(null)

    // Global cleanup effect
    useEffect(() => {
        console.log('🟢 [Mode C MOUNT] ModeCReverseCaseView mounted')
        setIsMounted(true)
        
        // Check localStorage for pending job creation
        if (typeof window !== 'undefined') {
            const pendingKey = `modec_creating_${currentBatchProgress?.batch_id}`
            const pending = localStorage.getItem(pendingKey)
            if (pending) {
                const data = JSON.parse(pending)
                const age = Date.now() - data.timestamp
                
                // If less than 10 minutes old, restore creating state
                if (age < 10 * 60 * 1000) {
                    console.log('🔄 [Mode C] Restoring pending job creation state')
                    setSubmitting(true)
                    setPendingJobCreation(data)
                    
                    toast({
                        title: '⏳ Job Creation In Progress',
                        description: 'Your previous job is still being created. Please wait...'
                    })
                } else {
                    // Clean up old entry
                    localStorage.removeItem(pendingKey)
                }
            }
        }
        
        return () => {
            console.log('🔴 [Mode C UNMOUNT] ModeCReverseCaseView unmounting - cleaning up')
            setIsMounted(false)
        }
    }, [])

    // Clear jobs and state when user or batch changes
    useEffect(() => {
        // Reset all state when batch changes
        setJobs([])
        setSpoiledInput('')
        setPollingJobId(null)
        setCancellingJobId(null)
        setDeletingJobId(null)

        // Load fresh jobs from server
        if (currentBatchProgress && isMounted) {
            loadJobs().then(() => {
                // Trigger parent refresh to sync batch progress after initial load
                if (onJobComplete) {
                    console.log('🔄 [Mode C] Initial jobs loaded - refreshing parent batch progress')
                    onJobComplete()
                }
                
                // After loading jobs, check if there are any in 'queued' status
                // and automatically start polling for the most recent one
                const queuedJobs = jobs.filter(j => j.status === 'queued')
                if (queuedJobs.length > 0) {
                    const mostRecentQueued = queuedJobs[0] // Jobs are sorted by created_at DESC
                    console.log('🔄 [Mode C] Found queued job on mount, starting polling:', mostRecentQueued.id)
                    setPollingJobId(mostRecentQueued.id)
                    
                    toast({
                        title: 'Job In Progress',
                        description: `Continuing to monitor Case #${mostRecentQueued.case_number}`,
                    })
                }
            })
        }
    }, [currentBatchProgress?.batch_id, userProfile?.id, isMounted])

    // Poll for job updates every 2 seconds (TASK 1)
    useEffect(() => {
        // Only run in browser
        if (typeof window === 'undefined') {
            console.log('⚠️ [Mode C] Skipping job polling - not in browser')
            return
        }

        if (!pollingJobId) {
            console.log('⚠️ [Mode C] No pollingJobId - not starting job poll')
            return
        }

        console.log('🔄 [Mode C POLLING START] Starting job status polling for job:', pollingJobId)

        const interval = setInterval(async () => {
            console.log('🔄 [Mode C POLLING TICK] Checking job status...')
            await loadJobs()
            
            // Also trigger parent refresh on every poll to keep batch progress updated
            if (onJobComplete) {
                onJobComplete()
            }

            // Note: We check job status after loadJobs updates the state
            // The cleanup logic is handled via pollingJobId state changes
        }, 2000) // Poll every 2 seconds (TASK 1)

        return () => {
            console.log('🛑 [Mode C POLLING CLEANUP] Stopping job polling, clearing interval:', interval)
            clearInterval(interval)
        }
    }, [pollingJobId]) // Only depend on pollingJobId, not jobs array
    
    // Separate effect to check if polling should stop based on job status
    useEffect(() => {
        if (!pollingJobId) return
        
        const job = jobs.find(j => j.id === pollingJobId)
        if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) {
            console.log('✅ [Mode C] Job finished. Status:', job.status)
            
            // Check if there are any other running/queued jobs - keep polling if yes
            const hasActiveJobs = jobs.some(j => ['running', 'queued'].includes(j.status) && j.id !== pollingJobId)
            
            if (hasActiveJobs) {
                console.log('🔄 [Mode C] Other jobs still active, continuing to poll...')
                // Don't stop polling - other jobs are still running
                // Just trigger onJobComplete for this specific job
                if (job.status === 'completed' && onJobComplete) {
                    onJobComplete()
                }
            } else {
                console.log('✅ [Mode C] All jobs finished, stopping polling')
                setPollingJobId(null)
                if (job.status === 'completed' && onJobComplete) {
                    onJobComplete()
                }
            }
        }
    }, [jobs, pollingJobId, onJobComplete])

    // Auto-hide completed jobs after 30 seconds
    useEffect(() => {
        const completedJobs = jobs.filter(j => j.status === 'completed' && j.completed_at)
        
        if (completedJobs.length === 0) return

        const timers = completedJobs.map(job => {
            const completedTime = new Date(job.completed_at!).getTime()
            const now = Date.now()
            const elapsed = now - completedTime
            const remaining = Math.max(0, 30000 - elapsed) // 30 seconds

            if (remaining > 0) {
                return setTimeout(() => {
                    setShowCompletedJobs(false)
                }, remaining)
            }
            return null
        }).filter(Boolean)

        return () => {
            timers.forEach(timer => timer && clearTimeout(timer))
        }
    }, [jobs])

    const loadJobs = async () => {
        // Guard: Don't make API calls if component is unmounted
        if (!isMounted) {
            console.log('⚠️ [Mode C loadJobs] Component unmounted - skipping API call')
            return
        }
        
        if (!currentBatchProgress) return

        setLoadingJobs(true)
        try {
            console.log('📡 [Mode C loadJobs] Fetching jobs...')
            const response = await fetch(
                `/api/manufacturer/modec/jobs?order_id=${currentBatchProgress.order_id}&batch_id=${currentBatchProgress.batch_id}`
            )

            if (!response.ok) {
                throw new Error('Failed to load jobs')
            }

            const data = await response.json()
            
            // Guard: Only update state if component is still mounted
            if (isMounted) {
                setJobs(data.jobs || [])
                
                // Sync workerRunning state based on actual job statuses
                const hasActiveJobs = (data.jobs || []).some((j: ReverseJob) => 
                    ['active', 'processing'].includes(j.status)
                )
                setWorkerRunning(hasActiveJobs)
                
                console.log('✅ [Mode C loadJobs] Jobs updated, count:', data.jobs?.length || 0, 'Active jobs:', hasActiveJobs)
            } else {
                console.log('⚠️ [Mode C loadJobs] Component unmounted during fetch - discarding result')
            }
        } catch (error: any) {
            console.error('❌ [Mode C loadJobs] Error loading jobs:', error)
            if (isMounted) {
                const errorInfo = parseError(error)
                toast({
                    title: errorInfo.title,
                    description: errorInfo.message,
                    variant: errorInfo.variant as any
                })
            }
        } finally {
            if (isMounted) {
                setLoadingJobs(false)
            }
        }
    }

    // Analyze input to classify spoiled vs buffer codes
    const analyzeInput = async (input: string) => {
        if (!input.trim() || !currentBatchProgress) {
            setInputAnalysis(null)
            return
        }

        try {
            const response = await fetch('/api/manufacturer/modec/analyze-input', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    order_id: currentBatchProgress.order_id,
                    batch_id: currentBatchProgress.batch_id,
                    spoiled_input: input
                })
            })

            if (response.ok) {
                const data = await response.json()
                setInputAnalysis(data.analysis)
            } else {
                setInputAnalysis(null)
            }
        } catch (error) {
            console.error('Error analyzing input:', error)
            setInputAnalysis(null)
        }
    }

    const handleSubmitJob = async () => {
        if (!currentBatchProgress) {
            toast({
                title: 'Error',
                description: 'No batch selected',
                variant: 'destructive'
            })
            return
        }

        if (!spoiledInput.trim()) {
            toast({
                title: 'Error',
                description: 'Please enter at least one spoiled code or sequence number',
                variant: 'destructive'
            })
            return
        }

        // Count lines to estimate processing time
        const lineCount = spoiledInput.split('\n').filter(l => l.trim()).length
        const isLargeJob = lineCount > 100
        
        // Start timing
        const startTime = Date.now()
        setSubmitStartTime(startTime)
        setSubmitLineCount(lineCount)
        
        setSubmitting(true)
        
        // Save to localStorage to persist across navigation
        if (typeof window !== 'undefined') {
            const pendingKey = `modec_creating_${currentBatchProgress.batch_id}`
            localStorage.setItem(pendingKey, JSON.stringify({
                batchId: currentBatchProgress.batch_id,
                timestamp: Date.now(),
                lineCount
            }))
            setPendingJobCreation({
                batchId: currentBatchProgress.batch_id,
                timestamp: Date.now()
            })
        }
        
        // Show informative toast for large jobs
        if (isLargeJob) {
            toast({
                title: '⏳ Processing Large Job',
                description: `Submitting ${lineCount} codes. This may take a few minutes. Feel free to navigate away - the job will continue in background.`
            })
        }
        
        try {
            // STEP 1: Check order validation FIRST (wrong order or wrong QR type)
            const response = await fetch('/api/manufacturer/modec/create-job', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    order_id: currentBatchProgress.order_id,
                    batch_id: currentBatchProgress.batch_id,
                    spoiled_input: spoiledInput
                })
            })

            const data = await response.json()

            if (!response.ok) {
                // Check if it's a wrong order error - show as warning
                if (data.error === 'WRONG_ORDER') {
                    toast({
                        title: '❌ Wrong Order!',
                        description: data.message || 'You tried to enter QR codes from a different order. Please check your entries.',
                        variant: 'destructive'
                    })
                    setSubmitting(false)
                    return
                }
                // Check if user entered master codes instead of unique codes
                if (data.error === 'WRONG_QR_TYPE') {
                    toast({
                        title: 'Wrong QR Code Type',
                        description: data.message || 'You tried to enter master case QR codes. Please enter unique product QR codes for damage recovery.',
                        variant: 'destructive'
                    })
                    setSubmitting(false)
                    return
                }
                // STEP 2: Check buffer availability (only if order validation passed)
                if (data.error === 'NOT_ENOUGH_BUFFERS') {
                    // Count how many spoiled codes user tried to submit
                    const spoiledLines = spoiledInput.split('\n').filter(line => line.trim()).length
                    const availableBuffers = currentBatchProgress.total_buffer_codes - currentBatchProgress.used_buffer_codes
                    
                    toast({
                        title: 'Not Enough Buffer Codes',
                        description: `You're trying to replace ${spoiledLines} damaged item${spoiledLines > 1 ? 's' : ''}, but only ${availableBuffers} buffer code${availableBuffers !== 1 ? 's are' : ' is'} available. Please reduce the number of damaged items or contact your administrator to add more buffer codes.`,
                        variant: 'destructive'
                    })
                    setSubmitting(false)
                    return
                }
                throw new Error(data.error || 'Failed to create job')
            }

            // Calculate timing
            const endTime = Date.now()
            const elapsedSeconds = ((endTime - startTime) / 1000).toFixed(2)
            
            // Clear localStorage - job creation complete
            if (typeof window !== 'undefined') {
                const pendingKey = `modec_creating_${currentBatchProgress.batch_id}`
                localStorage.removeItem(pendingKey)
                setPendingJobCreation(null)
            }
            
            // Show success message with timing
            if (data.is_split) {
                // Multi-batch job
                toast({
                    title: '✅ Large Job Split for Performance',
                    description: `Created ${data.total_batches} separate jobs processing ${data.total_codes} codes across ${data.total_cases} cases in ${elapsedSeconds}s. Each batch will process independently.`,
                })
            } else if (lineCount > 100) {
                toast({
                    title: '✅ Job Submitted Successfully',
                    description: `Processing ${lineCount} codes. Job created in ${elapsedSeconds}s. Will continue even if you navigate away.`,
                })
            } else {
                toast({
                    title: 'Success',
                    description: `Job created for Case #${data.case_number} in ${elapsedSeconds}s (${lineCount} codes submitted)`,
                })
            }

            // Clear input
            setSpoiledInput('')

            // Start polling (for split jobs, poll the first batch)
            if (data.is_split && data.jobs && data.jobs.length > 0) {
                setPollingJobId(data.jobs[0].job_id)
            } else if (data.job_id) {
                setPollingJobId(data.job_id)
            }

            // Reload jobs list to show new job
            loadJobs()

        } catch (error: any) {
            // Clear localStorage on error too
            if (typeof window !== 'undefined') {
                const pendingKey = `modec_creating_${currentBatchProgress.batch_id}`
                localStorage.removeItem(pendingKey)
                setPendingJobCreation(null)
            }
            const errorInfo = parseError(error)
            toast({
                title: errorInfo.title,
                description: errorInfo.message,
                variant: errorInfo.variant as any
            })
        } finally {
            setSubmitting(false)
        }
    }

    const handleCancelJob = async (jobId: string) => {
        const confirmed = window.confirm('Cancel this job? Any further background processing will stop.')
        if (!confirmed) return

        setCancellingJobId(jobId)

        // Optimistic update - immediately show the job as being cancelled
        setJobs(prevJobs =>
            prevJobs.map(job =>
                job.id === jobId
                    ? { ...job, status: 'cancelling' as any }
                    : job
            )
        )

        try {
            const response = await fetch(`/api/manufacturer/modec/jobs/${jobId}/cancel`, {
                method: 'POST'
            })

            const data = await response.json()

            if (!response.ok) {
                // Revert optimistic update on error
                loadJobs()
                throw new Error(data.error || 'Failed to cancel job')
            }

            toast({
                title: 'Job Cancelled',
                description: 'The background processing has been stopped.',
            })

            // Stop polling if this was the job being polled
            if (pollingJobId === jobId) {
                setPollingJobId(null)
            }

            // Reload jobs list to get final state
            loadJobs()

        } catch (error: any) {
            const errorInfo = parseError(error)
            toast({
                title: errorInfo.title,
                description: errorInfo.message,
                variant: errorInfo.variant as any
            })
        } finally {
            setCancellingJobId(null)
        }
    }

    const handleDeleteJob = async (jobId: string) => {
        const confirmed = window.confirm('Delete this job permanently? This will remove it from history and cannot be undone.')
        if (!confirmed) return

        setDeletingJobId(jobId)

        try {
            const response = await fetch(`/api/manufacturer/modec/jobs/${jobId}`, {
                method: 'DELETE'
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Failed to delete job')
            }

            // Success - remove from UI immediately
            setJobs(prevJobs => prevJobs.filter(job => job.id !== jobId))

            // Also reload from server to ensure consistency
            await loadJobs()

            toast({
                title: 'Job Deleted Permanently',
                description: 'The job has been removed from the database.',
            })

        } catch (error: any) {
            const errorInfo = parseError(error)
            toast({
                title: errorInfo.title,
                description: errorInfo.message,
                variant: errorInfo.variant as any
            })
        } finally {
            setDeletingJobId(null)
        }
    }

    const toggleGroup = (groupName: string) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupName]: !prev[groupName]
        }))
    }

    const groupJobsByStatus = () => {
        const grouped: Record<string, ReverseJob[]> = {
            running: jobs.filter(j => j.status === 'running'),
            queued: jobs.filter(j => j.status === 'queued'),
            failed: jobs.filter(j => j.status === 'failed'),
            completed: jobs.filter(j => j.status === 'completed'),
            cancelled: jobs.filter(j => j.status === 'cancelled' || j.status === 'cancelling')
        }
        return grouped
    }

    const handleBulkDelete = async (status: 'failed' | 'completed' | 'cancelled' | 'all') => {
        // Get jobs to delete based on status filter
        const jobsToDelete = status === 'all' 
            ? jobs 
            : jobs.filter(j => j.status === status)

        if (jobsToDelete.length === 0) {
            toast({
                title: 'No Jobs to Delete',
                description: `No ${status} jobs found.`,
                variant: 'default'
            })
            return
        }

        const confirmed = window.confirm(
            `Delete ${jobsToDelete.length} ${status === 'all' ? '' : status + ' '}job${jobsToDelete.length > 1 ? 's' : ''} permanently?\n\n` +
            `This will remove ${jobsToDelete.length === 1 ? 'it' : 'them'} from history and revert any used buffer codes back to available status.`
        )
        
        if (!confirmed) return

        setBulkDeleting(true)

        try {
            if (!currentBatchProgress) {
                throw new Error('No batch selected')
            }

            // Use bulk delete endpoint for efficiency and atomic buffer cleanup
            const response = await fetch(
                `/api/manufacturer/modec/jobs?filter=${status}&order_id=${currentBatchProgress.order_id}&batch_id=${currentBatchProgress.batch_id}`,
                { method: 'DELETE' }
            )

            const result = await response.json()

            if (!response.ok) {
                throw new Error(result.error || 'Failed to delete jobs')
            }

            // Reload jobs after bulk delete
            await loadJobs()

            toast({
                title: '✅ Bulk Delete Successful',
                description: result.message || `Deleted ${result.deleted_count} job(s) successfully. ${result.reverted_buffers || 0} buffer code(s) reverted.`,
            })

        } catch (error: any) {
            const errorInfo = parseError(error)
            toast({
                title: errorInfo.title,
                description: errorInfo.message,
                variant: errorInfo.variant as any
            })
        } finally {
            setBulkDeleting(false)
        }
    }

    const handleTriggerWorker = async () => {
        setWorkerRunning(true)
        try {
            toast({
                title: 'Triggering Worker',
                description: 'Manually running the background processor...',
            })

            // Call the worker API to process jobs
            const response = await fetch('/api/cron/qr-reverse-worker', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            })

            const data = await response.json()

            if (response.ok && data.success) {
                toast({
                    title: 'Worker Completed',
                    description: `Processed ${data.processed} job(s) in ${data.duration_ms}ms`,
                })
                // Refresh jobs to show updated status
                await loadJobs()
                
                // Trigger parent refresh to update batch progress
                if (onJobComplete) {
                    console.log('🔄 Worker completed - triggering parent refresh for batch progress')
                    onJobComplete()
                }
            } else {
                throw new Error(data.error || 'Worker failed')
            }
        } catch (error: any) {
            const errorInfo = parseError(error)
            toast({
                title: errorInfo.title,
                description: errorInfo.message,
                variant: errorInfo.variant as any
            })
        } finally {
            setWorkerRunning(false)
        }
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'queued':
                return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Queued</Badge>
            case 'running':
                return <Badge className="bg-blue-600"><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Running</Badge>
            case 'partial':
                return <Badge className="bg-yellow-600"><Loader2 className="h-3 w-3 mr-1" />Partial</Badge>
            case 'cancelling':
                return <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Cancelling...</Badge>
            case 'completed':
                return <Badge className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>
            case 'failed':
                return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>
            case 'cancelled':
                return <Badge variant="outline" className="bg-gray-200"><XCircle className="h-3 w-3 mr-1" />Cancelled</Badge>
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    if (!currentBatchProgress) {
        return (
            <Card>
                <CardContent className="pt-6">
                    <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                            Please select an order and batch to use Mode C.
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-6">
            {/* Order Locked Warning */}
            {isOrderLocked && (
                <Alert className="border-amber-200 bg-amber-50">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-900">
                        Warehouse intake has begun for this order. New reverse jobs cannot be created.
                    </AlertDescription>
                </Alert>
            )}

            {/* Step 1: Submit Spoiled Codes */}
            <Card>
                <CardHeader>
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <CardTitle className="flex items-center gap-2">
                                <ClipboardPaste className="h-5 w-5" />
                                Step 1: Paste Spoiled Codes & Submit Job
                            </CardTitle>
                            <p className="text-xs text-gray-500 mt-1.5">
                                Working on: <span className="font-semibold text-gray-700">{currentBatchProgress.order_no}</span>
                            </p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-gray-700">
                                Spoiled QR Codes or Sequence Numbers
                            </label>
                            {spoiledInput.trim() && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSpoiledInput('')}
                                    disabled={isOrderLocked || submitting}
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                                >
                                    <XCircle className="h-4 w-4 mr-1" />
                                    Clear
                                </Button>
                            )}
                        </div>
                        <textarea
                            value={spoiledInput}
                            onChange={(e) => {
                                setSpoiledInput(e.target.value)
                                // Analyze input to show summary
                                analyzeInput(e.target.value)
                            }}
                            placeholder={"Examples:\n" +
                                "Spoiled codes: PROD-...-00015, PROD-...-00022\n" +
                                "Buffer codes: PROD-...-03001, PROD-...-03002\n" +
                                "Or just sequence: 15, 22, 3001, 3002\n" +
                                "SEQ:42"}
                            className="w-full h-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                            disabled={isOrderLocked || submitting}
                        />
                        
                        {/* Line count indicator */}
                        {spoiledInput.trim() && (
                            <p className="mt-1 text-xs text-gray-500">
                                📊 Total lines: <span className="font-semibold text-gray-700">{spoiledInput.split('\n').filter(l => l.trim()).length}</span>
                            </p>
                        )}
                        
                        {/* Input Summary */}
                        {inputAnalysis && spoiledInput.trim() && (
                            <div className="mt-2 p-3 border rounded-lg bg-blue-50 border-blue-200">
                                <div className="flex items-start gap-2">
                                    <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-600" />
                                    <div className="flex-1 text-xs space-y-1">
                                        <p className="font-semibold text-blue-900">Input Summary:</p>
                                        <div className="text-blue-800 space-y-0.5">
                                            <p>• Spoiled codes: <span className="font-semibold">{inputAnalysis.spoiledCount}</span></p>
                                            {inputAnalysis.bufferProvidedCount > 0 && (
                                                <p>• Buffer codes provided: <span className="font-semibold">{inputAnalysis.bufferProvidedCount}</span></p>
                                            )}
                                            {inputAnalysis.autoAllocateCount > 0 && !inputAnalysis.insufficientBuffers && (
                                                <p>• Will auto-allocate: <span className="font-semibold text-green-700">{inputAnalysis.autoAllocateCount}</span> buffer code{inputAnalysis.autoAllocateCount > 1 ? 's' : ''}</p>
                                            )}
                                            {inputAnalysis.insufficientBuffers && (
                                                <p className="text-red-700 font-semibold">⚠️ WARNING: Need {inputAnalysis.insufficientBuffers.needed} buffer{inputAnalysis.insufficientBuffers.needed > 1 ? 's' : ''}, but only {inputAnalysis.insufficientBuffers.available} available in Case #{inputAnalysis.insufficientBuffers.caseNumber}. {inputAnalysis.insufficientBuffers.needed - inputAnalysis.insufficientBuffers.available} spoiled code{(inputAnalysis.insufficientBuffers.needed - inputAnalysis.insufficientBuffers.available) > 1 ? 's' : ''} will remain without buffer replacement.</p>
                                            )}
                                            {inputAnalysis.excessBufferCount > 0 && (
                                                <p className="text-amber-700">⚠️ Excess buffer codes: <span className="font-semibold">{inputAnalysis.excessBufferCount}</span> (will be ignored)</p>
                                            )}
                                            {inputAnalysis.ignoredBuffers && inputAnalysis.ignoredBuffers.length > 0 && (
                                                <p className="text-amber-700">
                                                    ⚠️ Ignoring {inputAnalysis.ignoredBuffers.length} buffer code{inputAnalysis.ignoredBuffers.length > 1 ? 's' : ''} from wrong case: 
                                                    <span className="font-semibold"> #{inputAnalysis.ignoredBuffers.map(b => b.sequence).join(', #')}</span>
                                                    {' '}(Case #{inputAnalysis.ignoredBuffers[0].fromCase} → Case #{inputAnalysis.ignoredBuffers[0].forCase})
                                                </p>
                                            )}
                                            {inputAnalysis.wrongOrderCodes && inputAnalysis.wrongOrderCodes.length > 0 && currentBatchProgress && (
                                                <p className="text-red-700">
                                                    ❌ Wrong Order! Ignoring {inputAnalysis.wrongOrderCodes.length} code{inputAnalysis.wrongOrderCodes.length > 1 ? 's' : ''} from "{inputAnalysis.wrongOrderCodes[0].orderNo}": 
                                                    <span className="font-semibold"> #{inputAnalysis.wrongOrderCodes.map(c => c.sequence).join(', #')}</span>
                                                    {' '}due to you're working on "{currentBatchProgress.order_no}"
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <Button
                        onClick={handleSubmitJob}
                        disabled={submitting || !spoiledInput.trim() || isOrderLocked}
                        className="w-full"
                        size="lg"
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                                Creating Job... ({submitLineCount} codes)
                            </>
                        ) : (
                            <>
                                <Zap className="h-5 w-5 mr-2" />
                                Submit Spoiled Codes
                            </>
                        )}
                    </Button>
                </CardContent>
            </Card>

            {/* Step 2: Job Status & Results */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div className="flex-1">
                        <CardTitle className="flex items-center gap-2">
                            <Package className="h-5 w-5" />
                            Step 2: Job Status & Results
                        </CardTitle>
                        <p className="text-xs text-gray-500 mt-1.5">
                            Processing for: <span className="font-semibold text-gray-700">{currentBatchProgress.order_no}</span>
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={loadJobs}
                            disabled={loadingJobs}
                        >
                            {loadingJobs ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="h-4 w-4" />
                            )}
                        </Button>
                        <Button
                            variant="default"
                            size="sm"
                            onClick={handleTriggerWorker}
                            disabled={
                                workerRunning || 
                                jobs.filter(j => j.status === 'queued').length === 0 ||
                                jobs.some(j => ['active', 'processing'].includes(j.status))
                            }
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {workerRunning || jobs.some(j => ['active', 'processing'].includes(j.status)) ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Running...
                                </>
                            ) : (
                                <>
                                    <Zap className="h-4 w-4 mr-2" />
                                    Start Processing
                                </>
                            )}
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {jobs.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>No reverse jobs yet. Submit spoiled codes above to get started.</p>
                        </div>
                    ) : (
                        <>
                            {/* Toggle Button for Completed Jobs */}
                            {jobs.filter(j => j.status === 'completed').length > 0 && (
                                <div className="mb-4 flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-200">
                                    <div className="flex items-center gap-2">
                                        <Info className="h-4 w-4 text-gray-500" />
                                        <span className="text-sm text-gray-700">
                                            {jobs.filter(j => j.status === 'completed').length} completed job{jobs.filter(j => j.status === 'completed').length > 1 ? 's' : ''}
                                        </span>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setShowCompletedJobs(!showCompletedJobs)}
                                        className="gap-2"
                                    >
                                        {showCompletedJobs ? (
                                            <>
                                                <EyeOff className="h-4 w-4" />
                                                Hide Completed
                                            </>
                                        ) : (
                                            <>
                                                <Eye className="h-4 w-4" />
                                                Show Completed
                                            </>
                                        )}
                                    </Button>
                                </div>
                            )}

                            {/* Bulk Delete Actions */}
                            {jobs.length > 0 && (() => {
                                const hasErrors = jobs.filter(j => j.status === 'failed').length > 0
                                const bgColor = hasErrors ? 'bg-red-50' : 'bg-green-50'
                                const borderColor = hasErrors ? 'border-red-200' : 'border-green-200'
                                const iconColor = hasErrors ? 'text-red-600' : 'text-green-600'
                                const textColor = hasErrors ? 'text-red-900' : 'text-green-900'
                                
                                return (
                                <div className={`mb-4 ${bgColor} border ${borderColor} rounded-lg p-3`}>
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                        <div className="flex items-center gap-2">
                                            <Trash2 className={`h-4 w-4 ${iconColor}`} />
                                            <span className={`text-sm font-medium ${textColor}`}>Bulk Delete Actions</span>
                                        </div>
                                        <div className="flex gap-2 flex-wrap">
                                            {jobs.filter(j => j.status === 'failed').length > 0 && (
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    onClick={() => handleBulkDelete('failed')}
                                                    disabled={bulkDeleting}
                                                    className="text-xs"
                                                >
                                                    {bulkDeleting ? (
                                                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="h-3 w-3 mr-1" />
                                                    )}
                                                    Delete All Failed ({jobs.filter(j => j.status === 'failed').length})
                                                </Button>
                                            )}
                                            {jobs.filter(j => j.status === 'completed').length > 0 && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleBulkDelete('completed')}
                                                    disabled={bulkDeleting}
                                                    className="text-xs border-red-300 text-red-700 hover:bg-red-100"
                                                >
                                                    {bulkDeleting ? (
                                                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="h-3 w-3 mr-1" />
                                                    )}
                                                    Delete All Completed ({jobs.filter(j => j.status === 'completed').length})
                                                </Button>
                                            )}
                                            {jobs.filter(j => j.status === 'cancelled').length > 0 && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleBulkDelete('cancelled')}
                                                    disabled={bulkDeleting}
                                                    className="text-xs border-red-300 text-red-700 hover:bg-red-100"
                                                >
                                                    {bulkDeleting ? (
                                                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="h-3 w-3 mr-1" />
                                                    )}
                                                    Delete All Cancelled ({jobs.filter(j => j.status === 'cancelled').length})
                                                </Button>
                                            )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleBulkDelete('all')}
                                                disabled={bulkDeleting}
                                                className="text-xs border-red-400 text-red-800 hover:bg-red-100 font-semibold"
                                            >
                                                {bulkDeleting ? (
                                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                                ) : (
                                                    <Trash2 className="h-3 w-3 mr-1" />
                                                )}
                                                Delete All ({jobs.length})
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                                )
                            })()}
                            
                            {/* Grouped Job View */}
                            <div className="space-y-3">
                                {(() => {
                                    const groupedJobs = groupJobsByStatus()
                                    const statusConfig = [
                                        { key: 'running', label: 'Running', color: 'blue', icon: Loader2, iconSpin: true },
                                        { key: 'queued', label: 'Queued', color: 'gray', icon: Package, iconSpin: false },
                                        { key: 'failed', label: 'Failed', color: 'red', icon: XCircle, iconSpin: false },
                                        { key: 'completed', label: 'Completed', color: 'green', icon: CheckCircle, iconSpin: false },
                                        { key: 'cancelled', label: 'Cancelled', color: 'gray', icon: XCircle, iconSpin: false }
                                    ]

                                    return statusConfig.map(({ key, label, color, icon: Icon, iconSpin }) => {
                                        const groupJobs = groupedJobs[key]
                                        if (groupJobs.length === 0) return null
                                        
                                        // Hide completed jobs if showCompletedJobs is false
                                        if (key === 'completed' && !showCompletedJobs) return null

                                        const isExpanded = expandedGroups[key]
                                        // Use DB value (spoiled property) like individual jobs do
                                        const totalSpoiled = groupJobs.reduce((sum, j) => sum + ((j as any).spoiled || j.total_spoiled || 0), 0)
                                        const totalReplaced = groupJobs.reduce((sum, j) => sum + ((j as any).replaced || j.total_replacements || 0), 0)
                                        
                                        // Calculate cumulative processing time for completed jobs
                                        let cumulativeTime = ''
                                        if (key === 'completed') {
                                            const totalSeconds = groupJobs.reduce((sum, job) => {
                                                if (job.started_at && job.completed_at) {
                                                    const start = new Date(job.started_at).getTime()
                                                    const end = new Date(job.completed_at).getTime()
                                                    return sum + ((end - start) / 1000)
                                                }
                                                return sum
                                            }, 0)
                                            
                                            const minutes = Math.floor(totalSeconds / 60)
                                            const seconds = Math.round(totalSeconds % 60)
                                            cumulativeTime = minutes > 0 
                                                ? `${minutes}m ${seconds}s`
                                                : `${seconds}s`
                                        }

                                        const colorClasses = {
                                            blue: 'bg-blue-50 border-blue-200 text-blue-900',
                                            gray: 'bg-gray-50 border-gray-200 text-gray-900',
                                            red: 'bg-red-50 border-red-200 text-red-900',
                                            green: 'bg-green-50 border-green-200 text-green-900'
                                        }

                                        return (
                                            <div key={key} className={`border rounded-lg ${colorClasses[color as keyof typeof colorClasses]}`}>
                                                {/* Group Header - Always Visible */}
                                                <div
                                                    className="p-4 cursor-pointer hover:bg-opacity-80 transition-colors"
                                                    onClick={() => toggleGroup(key)}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3 flex-1">
                                                            <Icon className={`h-5 w-5 ${iconSpin ? 'animate-spin' : ''}`} />
                                                            <div className="flex-1">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <h3 className="font-semibold text-base">
                                                                        {label}
                                                                    </h3>
                                                                    <span className="text-sm font-normal opacity-75">
                                                                        ({groupJobs.length} job{groupJobs.length > 1 ? 's' : ''})
                                                                    </span>
                                                                    {key === 'running' && groupJobs.length > 0 && (
                                                                        <span className="text-sm font-medium">
                                                                            • Case #{groupJobs[0].case_number}
                                                                        </span>
                                                                    )}
                                                                    {key === 'queued' && groupJobs.length > 0 && (
                                                                        <span className="text-sm font-medium">
                                                                            • Cases #{groupJobs[0].case_number}-{groupJobs[groupJobs.length - 1].case_number}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex gap-4 text-xs mt-1 opacity-75 flex-wrap">
                                                                    <span>Spoiled: {totalSpoiled}</span>
                                                                    <span>Replaced: {totalReplaced}</span>
                                                                    {key === 'completed' && cumulativeTime && (
                                                                        <span className="font-semibold text-green-700">⏱️ Total time: {cumulativeTime}</span>
                                                                    )}
                                                                    {!isExpanded && (
                                                                        <span className="text-blue-700 font-medium">• Click to expand</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <ChevronDown
                                                            className={`h-5 w-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Group Content - Collapsible */}
                                                {isExpanded && (
                                                    <div className="border-t px-4 pb-4 space-y-3">
                                                        {groupJobs.map((job) => (
                                <div
                                    key={job.id}
                                    className={`mt-3 border border-gray-200 rounded-lg p-4 space-y-3 bg-white ${job.status === 'cancelled' ? 'opacity-60' :
                                        job.status === 'cancelling' ? 'opacity-75' : ''
                                        }`}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold">
                                                    Case #{job.case_number}
                                                </h3>
                                                {getStatusBadge(job.status)}
                                            </div>
                                            {job.variant_key && (
                                                <p className="text-xs text-gray-500 mt-1">
                                                    Variant: {job.variant_key}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <p className="text-xs text-gray-600">
                                                {new Date(job.created_at).toLocaleString()}
                                            </p>
                                            {job.canCancel && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleCancelJob(job.id)}
                                                    disabled={cancellingJobId === job.id}
                                                    className="text-red-600 hover:bg-red-50 border-red-300"
                                                >
                                                    {cancellingJobId === job.id ? (
                                                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                                    ) : (
                                                        <XCircle className="h-3 w-3 mr-1" />
                                                    )}
                                                    Cancel
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Progress Tracking (TASK 1) */}
                                    {!['cancelled', 'cancelling'].includes(job.status) && (job.processed !== undefined && job.total_expected !== undefined) && (
                                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <p className="text-xs text-gray-600 font-medium">Progress</p>
                                                <p className="text-sm font-bold">
                                                    {job.processed} / {job.total_expected}
                                                    {' '}
                                                    <span className={
                                                        (job.progress_pct || 0) < 50 ? 'text-yellow-600' :
                                                            (job.progress_pct || 0) < 90 ? 'text-blue-600' :
                                                                'text-green-600'
                                                    }>
                                                        ({(job.progress_pct || 0).toFixed(0)}%)
                                                    </span>
                                                </p>
                                            </div>
                                            <div className="w-full bg-gray-200 rounded-full h-2">
                                                <div
                                                    className={`h-2 rounded-full transition-all duration-300 ${(job.progress_pct || 0) < 50 ? 'bg-yellow-500' :
                                                        (job.progress_pct || 0) < 90 ? 'bg-blue-500' :
                                                            'bg-green-500'
                                                        }`}
                                                    style={{ width: `${Math.min(job.progress_pct || 0, 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                        <div>
                                            <p className="text-gray-500 text-xs">Spoiled Codes</p>
                                            <p className="font-semibold text-red-600">
                                                {(job as any).spoiled || job.total_spoiled}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-gray-500 text-xs">Buffer Used</p>
                                            <p className="font-semibold text-green-600">
                                                {(job as any).replaced || job.total_replacements || 0}
                                            </p>
                                        </div>
                                        {job.pending_items > 0 && (
                                            <div>
                                                <p className="text-gray-500 text-xs">Pending</p>
                                                <p className="font-semibold text-yellow-600">
                                                    {job.pending_items}
                                                </p>
                                            </div>
                                        )}
                                        <div>
                                            <p className="text-gray-500 text-xs">Final Count</p>
                                            <p className="font-semibold">
                                                {job.status === 'cancelled' ? 'N/A' : (job.final_unit_count || '-')}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Unassigned Spoiled Codes Warning */}
                                    {job.status === 'completed' && (job as any).unassigned_count > 0 && (
                                        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3">
                                            <div className="flex items-start gap-2">
                                                <span className="text-amber-600 text-lg">⚠️</span>
                                                <div className="flex-1">
                                                    <p className="text-xs text-amber-800 font-semibold mb-1">
                                                        {(job as any).unassigned_count} Spoiled Code{(job as any).unassigned_count > 1 ? 's' : ''} Without Buffer Replacement
                                                    </p>
                                                    <p className="text-xs text-amber-700 mb-2">
                                                        These codes remain spoiled and are NOT included in the final count. Insufficient buffers were available.
                                                    </p>
                                                    <div className="bg-white border border-amber-200 rounded px-2 py-1">
                                                        <p className="text-xs text-amber-900 font-mono">
                                                            Seq: {(job as any).unassigned_sequences?.join(', ')}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {job.status === 'completed' && job.master_code && (
                                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1">
                                                    <p className="text-xs text-green-700 mb-1 font-medium">
                                                        ✅ Master Case Assigned:
                                                    </p>
                                                    <p className="font-mono text-sm text-green-900">
                                                        {job.master_code}
                                                    </p>
                                                    {job.started_at && job.completed_at && (() => {
                                                        const startTime = new Date(job.started_at).getTime()
                                                        const endTime = new Date(job.completed_at).getTime()
                                                        const durationMs = endTime - startTime
                                                        const totalSeconds = Math.floor(durationMs / 1000)
                                                        const minutes = Math.floor(totalSeconds / 60)
                                                        const seconds = totalSeconds % 60
                                                        const timeStr = minutes > 0 
                                                            ? `${minutes} min ${seconds} sec` 
                                                            : `${seconds} sec`
                                                        return (
                                                            <p className="text-xs text-green-600 mt-2">
                                                                ⏱️ Completed in {timeStr}
                                                            </p>
                                                        )
                                                    })()}
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDeleteJob(job.id)}
                                                    disabled={deletingJobId === job.id}
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 shrink-0"
                                                    title="Remove from history"
                                                >
                                                    {deletingJobId === job.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <XCircle className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {job.status === 'failed' && job.error_message && (
                                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1">
                                                    <p className="text-xs text-red-700 mb-1 font-medium">
                                                        ❌ Error:
                                                    </p>
                                                    <p className="text-sm text-red-900">
                                                        {job.error_message}
                                                    </p>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDeleteJob(job.id)}
                                                    disabled={deletingJobId === job.id}
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 shrink-0"
                                                    title="Remove from history"
                                                >
                                                    {deletingJobId === job.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <XCircle className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {job.status === 'partial' && (
                                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1">
                                                    <p className="text-xs text-yellow-700 mb-1 font-medium">
                                                        ⏸️ Partially Complete:
                                                    </p>
                                                    <p className="text-sm text-yellow-900">
                                                        Good codes linked to master. Waiting for buffer scans for spoiled items.
                                                    </p>
                                                    {job.master_code && (
                                                        <p className="font-mono text-xs text-yellow-800 mt-2">
                                                            Master: {job.master_code}
                                                        </p>
                                                    )}
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDeleteJob(job.id)}
                                                    disabled={deletingJobId === job.id}
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 shrink-0"
                                                    title="Remove from history"
                                                >
                                                    {deletingJobId === job.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <XCircle className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {job.status === 'running' && (
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                                            <p className="text-sm text-blue-900">
                                                Processing replacements...
                                            </p>
                                        </div>
                                    )}

                                    {job.status === 'cancelled' && (
                                        <div className="bg-gray-50 border border-gray-300 rounded-lg p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1">
                                                    <p className="text-xs text-gray-600 mb-1 font-medium">
                                                        ⏹️ Cancelled:
                                                    </p>
                                                    <p className="text-sm text-gray-700">
                                                        {job.error_message || 'Job was cancelled by user'}
                                                    </p>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDeleteJob(job.id)}
                                                    disabled={deletingJobId === job.id}
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 shrink-0"
                                                    title="Remove from history"
                                                >
                                                    {deletingJobId === job.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <XCircle className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                                        </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })
                                })()}
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
