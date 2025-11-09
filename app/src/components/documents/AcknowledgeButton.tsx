'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { 
  canAcknowledgeDocument, 
  getDocumentTypeLabel,
  type Document 
} from '@/lib/document-permissions'

interface AcknowledgeButtonProps {
  document: Document
  userProfile: {
    id: string
    organization_id: string
    signature_url?: string | null
    organizations: {
      org_type_code: string
    }
    roles: {
      role_level: number
    }
  }
  onSuccess: () => void
  requiresPaymentProof?: boolean
  paymentProofUrl?: string | null
  hasReviewedPaymentProof?: boolean
}

export default function AcknowledgeButton({
  document,
  userProfile,
  onSuccess,
  requiresPaymentProof = false,
  paymentProofUrl = null,
  hasReviewedPaymentProof = false
}: AcknowledgeButtonProps) {
  const [acknowledging, setAcknowledging] = useState(false)
  const { toast } = useToast()
  const supabase = createClient()

  // Check if user can acknowledge this document
  const canAcknowledge = canAcknowledgeDocument(document, {
    organizationId: userProfile.organization_id,
    orgTypeCode: userProfile.organizations.org_type_code,
    roleLevel: userProfile.roles.role_level
  })

  const isPending = document.status === 'pending'
  const normalizedOrgType = userProfile.organizations.org_type_code?.toUpperCase() ?? ''
  const isManufacturer = ['MFG', 'MANU'].includes(normalizedOrgType)
  const isInvoice = document.doc_type === 'INVOICE'
  const issuedToMismatch = document.issued_to_org_id !== userProfile.organization_id
  const shouldShowInvoiceAssignmentNotice =
    isPending && isInvoice && issuedToMismatch && isManufacturer

  // Don’t show button if user can’t acknowledge or document is not pending
  if (!canAcknowledge || !isPending) {
    if (shouldShowInvoiceAssignmentNotice) {
      return (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
          This invoice must be acknowledged by the buying organization (HQ). Please reach out to the HQ finance team if you need them to complete the acknowledgment.
        </div>
      )
    }

    return null
  }

  async function handleAcknowledge() {
    try {
      if (document.doc_type === 'PAYMENT' && document.issued_to_org_id !== userProfile.organization_id) {
        toast({
          title: 'Manufacturer Confirmation Required',
          description: 'Only the manufacturing team can acknowledge this payment. Please reach out to the seller to complete the confirmation.',
          variant: 'destructive'
        })
        return
      }

      // Check if user has uploaded signature
      if (!userProfile.signature_url) {
        toast({
          title: 'Signature Required',
          description: 'Please upload your digital signature in your profile before acknowledging documents.',
          variant: 'destructive'
        })
        return
      }

      // Pre-check for invoice acknowledgment with payment proof requirement
      if (document.doc_type === 'INVOICE' && requiresPaymentProof && !paymentProofUrl) {
        toast({
          title: 'Payment Proof Required',
          description: 'Please upload payment proof above before you can acknowledge this invoice.',
          variant: 'destructive'
        })
        return
      }

      // Check if manufacturer has reviewed payment proof before acknowledging payment
      if (document.doc_type === 'PAYMENT' && paymentProofUrl && !hasReviewedPaymentProof) {
        const confirmed = window.confirm(
          'Please download and review the payment proof to verify the payment has been made. Are you sure you want to proceed with acknowledgment before reviewing the payment proof?'
        )
        if (!confirmed) {
          return
        }
      }

      setAcknowledging(true)

      let result
      let successMessage = ''

      switch (document.doc_type) {
        case 'PO':
          result = await supabase.rpc('po_acknowledge', {
            p_document_id: document.id
          })
          successMessage = 'Purchase Order acknowledged. Invoice has been automatically generated.'
          break

        case 'INVOICE':
          result = await supabase.rpc('invoice_acknowledge', {
            p_document_id: document.id,
            p_payment_proof_url: paymentProofUrl
          })
          successMessage = 'Invoice acknowledged. Payment document has been created.'
          break

        case 'PAYMENT':
          result = await supabase.rpc('payment_acknowledge', {
            p_document_id: document.id
          })
          successMessage = 'Payment acknowledged. Receipt has been generated and order is now closed.'
          break

        default:
          throw new Error('Invalid document type for acknowledgment')
      }

      if (result.error) {
        const { message, details, hint, code } = result.error
        const composedMessage = message || details || hint || (code ? `Acknowledgement failed (code ${code})` : null)
        throw new Error(composedMessage || 'Failed to acknowledge document')
      }

      toast({
        title: `${getDocumentTypeLabel(document.doc_type)} Acknowledged`,
        description: successMessage
      })

      onSuccess()
    } catch (error: any) {
      console.error('Error acknowledging document:', error)

      const errorDetails = error?.message || error?.details || error?.hint || error?.code
      const fallbackMessage = typeof errorDetails === 'string' && errorDetails.trim().length > 0
        ? errorDetails
        : 'Failed to acknowledge document'
      
      // Handle authorization errors before payment proof messaging
      if (error.message && error.message.toLowerCase().includes('for this organization')) {
        toast({
          title: 'Not Authorized',
          description: 'Your organization is not permitted to acknowledge this document. Please contact the assigned team for assistance.',
          variant: 'destructive'
        })
      } else if (error.message && error.message.includes('Payment proof is required')) {
        toast({
          title: 'Payment Proof Required',
          description: 'Please upload payment proof above before acknowledging this invoice.',
          variant: 'destructive'
        })
      } else {
        toast({
          title: 'Error',
          description: fallbackMessage,
          variant: 'destructive'
        })
      }
    } finally {
      setAcknowledging(false)
    }
  }

  // Determine if button should be disabled
  const isDisabled = acknowledging || 
    !userProfile.signature_url ||
    (document.doc_type === 'INVOICE' && requiresPaymentProof && !paymentProofUrl)

  return (
    <div className="space-y-3">
      {/* Show warning if signature is not uploaded */}
      {!userProfile.signature_url && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-blue-900 mb-1">
                Digital Signature Required
              </h4>
              <p className="text-sm text-blue-800">
                Please upload your digital signature in your profile settings to acknowledge documents.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Show warning if payment proof is required but not uploaded */}
      {document.doc_type === 'INVOICE' && requiresPaymentProof && !paymentProofUrl && userProfile.signature_url && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-amber-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-amber-900 mb-1">
                Payment Proof Required
              </h4>
              <p className="text-sm text-amber-800">
                Please upload your payment proof document above before you can acknowledge this invoice.
              </p>
            </div>
          </div>
        </div>
      )}

      <Button
        onClick={handleAcknowledge}
        disabled={isDisabled}
        className="w-full"
        size="lg"
      >
        {acknowledging ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Acknowledging...
          </>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Acknowledge {getDocumentTypeLabel(document.doc_type)}
          </>
        )}
      </Button>

      {isDisabled && !acknowledging && (
        <p className="text-xs text-center text-gray-500">
          {!userProfile.signature_url 
            ? 'Please upload your signature in profile settings'
            : document.doc_type === 'INVOICE' && requiresPaymentProof && !paymentProofUrl
            ? 'Button will be enabled after uploading payment proof'
            : ''
          }
        </p>
      )}

      {!acknowledging && document.doc_type === 'PAYMENT' && document.issued_to_org_id !== userProfile.organization_id && userProfile.signature_url && (
        <p className="text-xs text-center text-amber-600">
          Only the manufacturing organization can acknowledge payments for this order.
        </p>
      )}
    </div>
  )
}
