'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
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
  Zap
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

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
}

interface ReverseBatchModeCProps {
  currentBatchProgress: BatchProgress | null
  userProfile: UserProfile
  isOrderLocked: boolean
  onJobComplete?: () => void
}

interface JobStatus {
  job_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  total_spoiled: number
  total_replacements: number
  master_code?: string
  case_number?: number
  final_unit_count?: number
  error_message?: string
  created_at?: string
}

export default function ReverseBatchModeC({
  currentBatchProgress,
  userProfile,
  isOrderLocked,
  onJobComplete
}: ReverseBatchModeCProps) {
  const { toast } = useToast()
  
  const [excludeInput, setExcludeInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [isPolling, setIsPolling] = useState(false)

  // Poll job status
  useEffect(() => {
    if (!currentJobId || !isPolling) return

    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/manufacturer/async-reverse/job-status?job_id=${currentJobId}`)
        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'Failed to fetch job status')
        }

        setJobStatus(result)

        // Stop polling if completed or failed
        if (result.status === 'completed' || result.status === 'failed') {
          setIsPolling(false)
          
          if (result.status === 'completed') {
            toast({
              title: 'Job Completed!',
              description: `Case #${result.case_number} processed. Master QR assigned: ${result.master_code}`,
            })
            
            if (onJobComplete) {
              onJobComplete()
            }
          } else if (result.status === 'failed') {
            toast({
              title: 'Job Failed',
              description: result.error_message || 'Job processing failed',
              variant: 'destructive'
            })
          }
        }
      } catch (error: any) {
        console.error('Error polling job status:', error)
      }
    }

    // Initial poll
    pollStatus()

    // Poll every 3 seconds
    const interval = setInterval(pollStatus, 3000)

    return () => clearInterval(interval)
  }, [currentJobId, isPolling, toast, onJobComplete])

  const handleSubmitJob = async () => {
    if (!currentBatchProgress) {
      toast({
        title: 'Error',
        description: 'No batch selected. Please select an order and batch first.',
        variant: 'destructive'
      })
      return
    }

    if (!excludeInput.trim()) {
      toast({
        title: 'Error',
        description: 'Please paste at least one spoiled QR code or sequence number',
        variant: 'destructive'
      })
      return
    }

    try {
      setSubmitting(true)

      // Parse input lines
      const lines = excludeInput
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)

      const response = await fetch('/api/manufacturer/async-reverse/submit-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: currentBatchProgress.batch_id,
          order_id: currentBatchProgress.order_id,
          spoiled_inputs: lines,
          created_by: userProfile.id
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to submit job')
      }

      setCurrentJobId(result.job_id)
      setIsPolling(true)
      setExcludeInput('')

      toast({
        title: 'Job Submitted',
        description: `Processing ${result.total_spoiled} spoiled code(s) for Case #${result.case_number}`,
      })

    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setSubmitting(false)
    }
  }

  const clearJob = () => {
    setCurrentJobId(null)
    setJobStatus(null)
    setIsPolling(false)
  }

  const excludeLineCount = excludeInput
    .split('\n')
    .filter(line => line.trim().length > 0).length

  return (
    <div className="space-y-6">
      {isOrderLocked && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Warehouse intake has begun for this order. Job submission is disabled.
          </AlertDescription>
        </Alert>
      )}

      {!currentBatchProgress && (
        <Alert className="border-blue-200 bg-blue-50 text-blue-900">
          <Info className="h-4 w-4" />
          <AlertDescription>
            Please select an order and batch from the dropdown above to get started.
          </AlertDescription>
        </Alert>
      )}

      {/* Step 1: Submit Job */}
      {currentBatchProgress && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardPaste className="h-5 w-5" />
              Step 1: Paste Spoiled Codes & Submit Job
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-900">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold mb-1">Paste spoiled/damaged codes (one per line):</p>
                  <ul className="list-disc list-inside text-xs space-y-1">
                    <li>Full tracking URL: <code className="text-xs">http://serapod2u.com/track/product/PROD-...-00015</code></li>
                    <li>Raw QR code: <code className="text-xs">PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015</code></li>
                    <li>Just sequence number: <code className="text-xs">15</code> (if QR is unreadable)</li>
                  </ul>
                  <p className="mt-2 text-purple-700">
                    <strong>Note:</strong> All codes must be from the <strong>same case</strong>. System will auto-replace with buffer codes and assign master QR automatically.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Spoiled QR Codes or Sequence Numbers
              </label>
              <textarea
                value={excludeInput}
                onChange={(e) => setExcludeInput(e.target.value)}
                placeholder="Paste spoiled codes here (one per line)...&#10;PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015&#10;or just: 15&#10;or full URL: http://serapod2u.com/track/product/PROD-...-00015"
                rows={8}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 font-mono text-xs"
                disabled={isOrderLocked || isPolling}
              />
              {excludeLineCount > 0 && (
                <p className="text-xs text-gray-600 mt-2">
                  Ready to process <strong>{excludeLineCount}</strong> spoiled code{excludeLineCount !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleSubmitJob}
                disabled={submitting || !excludeInput.trim() || isOrderLocked || isPolling}
                className="flex-1 bg-purple-600 hover:bg-purple-700"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting Job...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    Submit Background Job
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setExcludeInput('')}
                disabled={submitting || isPolling}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Job Status */}
      {currentJobId && jobStatus && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Job Status - Case #{jobStatus.case_number}
              </div>
              <Badge 
                variant={
                  jobStatus.status === 'completed' ? 'default' :
                  jobStatus.status === 'failed' ? 'destructive' :
                  'secondary'
                }
                className={
                  jobStatus.status === 'completed' ? 'bg-green-600' :
                  jobStatus.status === 'failed' ? 'bg-red-600' :
                  'bg-blue-600'
                }
              >
                {jobStatus.status === 'queued' && 'Queued'}
                {jobStatus.status === 'running' && <><Loader2 className="h-3 w-3 mr-1 animate-spin inline" />Running</>}
                {jobStatus.status === 'completed' && <><CheckCircle className="h-3 w-3 mr-1 inline" />Completed</>}
                {jobStatus.status === 'failed' && <><AlertTriangle className="h-3 w-3 mr-1 inline" />Failed</>}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobStatus.status === 'running' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">Processing...</span>
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                </div>
                <Progress value={50} className="h-2" />
              </div>
            )}

            {jobStatus.status === 'completed' && (
              <>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
                  <p className="font-semibold text-green-900 mb-3 flex items-center gap-2">
                    <CheckCircle className="h-5 w-5" />
                    Job Complete - Master QR Auto-Assigned
                  </p>
                  <div className="space-y-2 text-green-800">
                    <div className="flex items-center justify-between py-2 border-b border-green-200">
                      <span>Master Case QR:</span>
                      <code className="font-mono text-xs bg-white px-2 py-1 rounded">{jobStatus.master_code}</code>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-green-200">
                      <span>Case Number:</span>
                      <strong>#{jobStatus.case_number}</strong>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-green-200">
                      <span>Final Unit Count:</span>
                      <strong>{jobStatus.final_unit_count} units</strong>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-green-200">
                      <span>Spoiled Codes:</span>
                      <strong className="text-red-600">{jobStatus.total_spoiled}</strong>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span>Buffer Replacements:</span>
                      <strong className="text-blue-600">{jobStatus.total_replacements}</strong>
                    </div>
                  </div>
                </div>

                <Alert className="border-green-200 bg-green-50">
                  <Info className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-900 text-sm">
                    <strong>No manual master scan needed!</strong> The system has automatically linked all valid codes to the master case QR above.
                  </AlertDescription>
                </Alert>
              </>
            )}

            {jobStatus.error_message && (
              <Alert className="border-red-200 bg-red-50">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-900">
                  <strong>Error:</strong> {jobStatus.error_message}
                </AlertDescription>
              </Alert>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={clearJob}
              className="w-full"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Clear & Start New Job
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
