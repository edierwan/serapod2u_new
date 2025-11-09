'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/use-toast'
import { 
  DollarSign, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  FileText 
} from 'lucide-react'

interface BalancePaymentRequestCardProps {
  orderId: string
  orderNo: string
  requestData: {
    id: string
    doc_no: string
    status: 'pending' | 'acknowledged'
    created_at: string
    payload?: {
      requested_amount?: number
      currency?: string
      po_no?: string
      reason?: string
      requested_percent?: number
    }
  } | null
  userProfile: any
  onRequestApproved?: () => void
  finalPaymentProofUrl?: string | null
  requireFinalProof?: boolean
  onUploadProofClick?: () => void
}

export default function BalancePaymentRequestCard({
  orderId,
  orderNo,
  requestData,
  userProfile,
  onRequestApproved,
  finalPaymentProofUrl,
  requireFinalProof = true,
  onUploadProofClick
}: BalancePaymentRequestCardProps) {
  const [approving, setApproving] = useState(false)

  const isHQAdmin = () => {
    return userProfile?.role_code === 'HQ_ADMIN' || 
           userProfile?.role_code === 'POWER_USER' ||
           userProfile?.organizations?.org_type_code === 'HQ'
  }

  const isFinalProofMissing = requireFinalProof && !finalPaymentProofUrl

  const handleApprove = async () => {
    if (!requestData) return

    if (isFinalProofMissing) {
      toast({
        title: 'Final Document Required',
        description: 'Attach the final 50% payment document before approving this request.',
        variant: 'destructive'
      })
      if (onUploadProofClick) {
        onUploadProofClick()
      }
      return
    }

    try {
      setApproving(true)

      const response = await fetch(`/api/documents/payment-request/${requestData.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve payment request')
      }

      toast({
        title: "Success",
        description: `Balance payment request approved. Payment document ${data.payment_doc_no} has been created.`,
      })

      if (onRequestApproved) {
        onRequestApproved()
      }

    } catch (error: any) {
      console.error('Error approving payment request:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to approve payment request",
        variant: "destructive"
      })
    } finally {
      setApproving(false)
    }
  }

  const formatCurrency = (amount: number, currency: string = 'MYR') => {
    return new Intl.NumberFormat('en-MY', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount).replace(currency, currency === 'MYR' ? 'RM' : currency)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (!requestData) {
    return (
      <Card className="border-dashed border-2 border-gray-300">
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">
              Balance payment request will be auto-generated when warehouse receives goods
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const requestedAmount = requestData.payload?.requested_amount || 0
  const currency = requestData.payload?.currency || 'MYR'
  const isPending = requestData.status === 'pending'

  return (
    <Card className={`border-2 ${
      isPending 
        ? 'border-orange-300 bg-orange-50/30' 
        : 'border-green-300 bg-green-50/30'
    }`}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${
              isPending ? 'bg-orange-100' : 'bg-green-100'
            }`}>
              <DollarSign className={`w-5 h-5 ${
                isPending ? 'text-orange-600' : 'text-green-600'
              }`} />
            </div>
            <div>
              <CardTitle className="text-lg">Balance Payment Request</CardTitle>
              <p className="text-sm text-gray-500 mt-0.5">
                Auto-generated after warehouse receive
              </p>
            </div>
          </div>
          <Badge 
            className={`${
              isPending 
                ? 'bg-orange-100 text-orange-700 border-orange-300' 
                : 'bg-green-100 text-green-700 border-green-300'
            } border`}
          >
            {isPending ? (
              <>
                <Clock className="w-3 h-3 mr-1" />
                Pending Approval
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Approved
              </>
            )}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Request Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-gray-500" />
              <p className="text-sm text-gray-500">Document Number</p>
            </div>
            <p className="font-semibold text-gray-900">{requestData.doc_no}</p>
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-gray-500" />
              <p className="text-sm text-gray-500">Requested Amount</p>
            </div>
            <p className="font-semibold text-gray-900 text-lg">
              {formatCurrency(requestedAmount, currency)}
            </p>
            {requestData.payload?.requested_percent && (
              <p className="text-xs text-gray-500 mt-1">
                ({(requestData.payload.requested_percent * 100).toFixed(0)}% of order total)
              </p>
            )}
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <p className="text-sm text-gray-500">Created At</p>
            </div>
            <p className="font-medium text-gray-900">{formatDate(requestData.created_at)}</p>
          </div>

          {requestData.payload?.po_no && (
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-gray-500" />
                <p className="text-sm text-gray-500">Related PO</p>
              </div>
              <p className="font-medium text-gray-900">{requestData.payload.po_no}</p>
            </div>
          )}
        </div>

        {/* Payment Terms Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-blue-900 text-sm mb-1">
                50/50 Payment Terms
              </h4>
              <p className="text-xs text-blue-700">
                This order uses split payment terms: 50% deposit (before production) and 50% balance (after warehouse receives goods).
                The balance payment request is automatically generated when the warehouse scans "purchase_in" for this order.
              </p>
            </div>
          </div>
        </div>

        {/* Approve Button (HQ Admin Only) */}
        {isPending && isHQAdmin() && (
          <div className="pt-2 border-t border-gray-200">
            <Button
              onClick={handleApprove}
              disabled={approving || isFinalProofMissing}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white"
              size="lg"
            >
              {approving ? (
                <>
                  <Clock className="w-5 h-5 mr-2 animate-spin" />
                  Approving Payment Request...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 mr-2" />
                  Approve Balance Payment (50%)
                </>
              )}
            </Button>
            <p className="text-xs text-gray-500 mt-2 text-center">
              This will create a new PAYMENT document that Finance can acknowledge
            </p>
            {isFinalProofMissing && (
              <p className="text-xs text-amber-600 mt-1 text-center">
                Upload the final balance payment document before approval.
              </p>
            )}
          </div>
        )}

        {/* Already Approved State */}
        {!isPending && (
          <div className="bg-green-100 border border-green-300 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
            <div>
              <p className="font-semibold text-green-900 text-sm">
                Payment Request Approved
              </p>
              <p className="text-xs text-green-700 mt-0.5">
                A new PAYMENT document has been created and sent to Finance for processing.
              </p>
            </div>
          </div>
        )}

        {/* Not HQ Admin State */}
        {isPending && !isHQAdmin() && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0" />
            <div>
              <p className="font-semibold text-amber-900 text-sm">
                Waiting for HQ Admin Approval
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Only HQ Administrators can approve balance payment requests.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
