import { useState, useCallback, useEffect } from 'react'
import { useToast } from '@/components/ui/use-toast'

interface SubmitJobParams {
  batchId: string
  orderId: string
  excludeCodes: string[]
  manufacturerOrgId: string
  userId: string
  filterVariantId?: string
  filterCaseNumbers?: number[]
}

interface JobStatus {
  job_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  prepared_count: number
  remaining_to_prepare?: number
  total_available_in_batch?: number
  result_summary?: {
    prepared: number
    duplicates: number
    invalid: number
    total_available: number
    excluded_count: number
  }
  error_message?: string
  created_at?: string
  updated_at?: string
}

export function useReverseJob() {
  const { toast } = useToast()
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submitReverseJob = useCallback(async (params: SubmitJobParams) => {
    try {
      setSubmitting(true)
      
      console.log('📤 Submitting reverse job:', params)
      
      const response = await fetch('/api/manufacturer/reverse-job/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: params.batchId,
          order_id: params.orderId,
          exclude_codes: params.excludeCodes,
          manufacturer_org_id: params.manufacturerOrgId,
          user_id: params.userId,
          filter_variant_id: params.filterVariantId,
          filter_case_numbers: params.filterCaseNumbers
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to submit job')
      }
      
      console.log('✅ Job submitted:', result)
      setCurrentJobId(result.job_id)
      setIsPolling(true)
      
      toast({
        title: 'Job Submitted',
        description: `Reverse batch job created. Excluding ${result.exclude_count} codes.`,
      })

      return result

    } catch (error: any) {
      console.error('❌ Error submitting job:', error)
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
      throw error
    } finally {
      setSubmitting(false)
    }
  }, [toast])

  const fetchJobStatus = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`/api/manufacturer/reverse-job/status?job_id=${jobId}`)
      
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch job status')
      }

      setJobStatus(result)

      // Stop polling if job is completed or failed
      if (result.status === 'completed' || result.status === 'failed') {
        setIsPolling(false)
        
        if (result.status === 'completed') {
          toast({
            title: 'Job Completed',
            description: `Prepared ${result.prepared_count} codes. Ready to link to master cases.`,
          })
        } else if (result.status === 'failed') {
          toast({
            title: 'Job Failed',
            description: result.error_message || 'Job processing failed',
            variant: 'destructive'
          })
        }
      }

      return result

    } catch (error: any) {
      console.error('Error fetching job status:', error)
      setIsPolling(false)
      throw error
    }
  }, [toast])

  const clearReverseJob = useCallback(() => {
    setCurrentJobId(null)
    setJobStatus(null)
    setIsPolling(false)
  }, [])

  // Polling effect
  useEffect(() => {
    if (!isPolling || !currentJobId) return

    // Initial fetch
    fetchJobStatus(currentJobId)

    // Set up polling interval
    const pollInterval = setInterval(() => {
      fetchJobStatus(currentJobId)
    }, 3000) // Poll every 3 seconds

    return () => clearInterval(pollInterval)
  }, [isPolling, currentJobId, fetchJobStatus])

  return {
    submitReverseJob,
    fetchJobStatus,
    clearReverseJob,
    currentJobId,
    jobStatus,
    isPolling,
    submitting
  }
}
