'use client'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { CheckCircle2, Clock, FileText, FileCheck, CreditCard, Receipt } from 'lucide-react'
import { getDocumentStatusText, type Document } from '@/lib/document-permissions'

interface DocumentWorkflowProgressProps {
  documents: {
    po?: Document | null
    invoice?: Document | null
    payment?: Document | null
    receipt?: Document | null
    depositInvoice?: Document | null
    depositPayment?: Document | null
    balancePaymentRequest?: Document | null
    balancePayment?: Document | null
    depositReceipt?: Document | null
    finalReceipt?: Document | null
  }
  onTabChange?: (tab: string) => void
  use50_50Split?: boolean
  depositPercentage?: number
}

export default function DocumentWorkflowProgress({ documents, onTabChange, use50_50Split = false, depositPercentage = 50 }: DocumentWorkflowProgressProps) {
  const balancePercentage = 100 - depositPercentage
  // Define steps based on workflow type
  type Step = {
    key: string
    label: string
    shortLabel?: string
    icon: any
    color: string
    document: Document | null | undefined
  }

  const traditionalSteps: Step[] = [
    {
      key: 'po',
      label: 'Purchase Order',
      icon: FileText,
      color: 'blue',
      document: documents.po
    },
    {
      key: 'invoice',
      label: 'Invoice',
      icon: FileCheck,
      color: 'green',
      document: documents.invoice
    },
    {
      key: 'payment',
      label: 'Payment',
      icon: CreditCard,
      color: 'purple',
      document: documents.payment
    },
    {
      key: 'receipt',
      label: 'Receipt',
      icon: Receipt,
      color: 'orange',
      document: documents.receipt
    }
  ]

  const split50_50Steps: Step[] = [
    {
      key: 'po',
      label: 'Purchase Order',
      icon: FileText,
      color: 'blue',
      document: documents.po
    },
    {
      key: 'depositInvoice',
      label: `Deposit Invoice (${depositPercentage}%)`,
      shortLabel: 'Deposit Invoice',
      icon: FileCheck,
      color: 'green',
      document: documents.depositInvoice || documents.invoice
    },
    {
      key: 'depositPayment',
      label: `Deposit Payment (${depositPercentage}%)`,
      shortLabel: 'Deposit Pay',
      icon: CreditCard,
      color: 'purple',
      document: documents.depositPayment || (!documents.balancePayment ? documents.payment : null)
    },
    {
      key: 'balanceRequest',
      label: `Balance Request (${balancePercentage}%)`,
      shortLabel: 'Balance Req',
      icon: FileText,
      color: 'teal',
      document: documents.balancePaymentRequest
    },
    {
      key: 'balancePayment',
      label: `Balance Payment (${balancePercentage}%)`,
      shortLabel: 'Balance Pay',
      icon: CreditCard,
      color: 'indigo',
      document: documents.balancePayment
    },
    {
      key: 'receipt',
      label: 'Receipt',
      icon: Receipt,
      color: 'orange',
      document: documents.receipt
    }
  ]

  const steps = use50_50Split ? split50_50Steps : traditionalSteps

  const getStepStatus = (document: Document | null | undefined) => {
    if (!document) return 'not-started'
    if (document.doc_type === 'RECEIPT') return 'completed'
    if (document.status === 'acknowledged') return 'completed'
    if (document.status === 'pending') return 'pending'
    return 'not-started'
  }

  const getStepColor = (status: string, baseColor: string) => {
    if (status === 'completed') return 'bg-green-100 text-green-700 border-green-300'
    if (status === 'partial') return 'bg-amber-100 text-amber-800 border-amber-300'
    if (status === 'pending') return `bg-yellow-100 text-yellow-700 border-yellow-300`
    return 'bg-gray-100 text-gray-400 border-gray-300'
  }

  const getIconColor = (status: string, baseColor: string) => {
    if (status === 'completed') return 'text-green-600'
    if (status === 'partial') return 'text-amber-600'
    if (status === 'pending') return `text-${baseColor}-600`
    return 'text-gray-400'
  }

  const getProgressPercentage = () => {
    if (use50_50Split) {
      let completed = 0
      const total = 6

      if (documents.po?.status === 'acknowledged' || documents.depositInvoice || documents.invoice) completed++
      if (documents.depositInvoice?.status === 'acknowledged' || documents.depositPayment || documents.invoice?.status === 'acknowledged' || documents.payment) completed++
  if (documents.depositPayment?.status === 'acknowledged' || (!documents.balancePayment && documents.payment?.status === 'acknowledged') || documents.balancePaymentRequest) completed++
      if (documents.balancePaymentRequest?.status === 'acknowledged' || documents.balancePayment) completed++
      if (documents.balancePayment?.status === 'acknowledged' || documents.receipt) completed++
      if (documents.receipt) completed++

      return (completed / total) * 100
    } else {
      let completed = 0
      const total = 4

      if (documents.po?.status === 'acknowledged' || documents.invoice) completed++
      if (documents.invoice?.status === 'acknowledged' || documents.payment) completed++
      if (documents.payment?.status === 'acknowledged' || documents.receipt) completed++
      if (documents.receipt) completed++

      return (completed / total) * 100
    }
  }

  const progress = getProgressPercentage()

  return (
    <Card className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-gray-900">Document Workflow</h3>
          <span className="text-sm font-medium text-gray-600">{Math.round(progress)}% Complete</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className={`grid gap-3 sm:gap-4 ${use50_50Split ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 md:grid-cols-4'}`}>
        {steps.map((step, index) => {
          const isReceiptStep = use50_50Split && step.key === 'receipt'
          const depositReceipt = documents.depositReceipt
          const finalReceipt = documents.finalReceipt

          // Receipt status logic:
          // - If both deposit and final receipts exist: 'completed' (green)
          // - If only deposit receipt exists: 'partial' (yellow/amber)
          // - If no receipts exist: 'not-started' (gray)
          const status = isReceiptStep
            ? finalReceipt
              ? 'completed'  // Both receipts complete
              : depositReceipt
                ? 'partial'  // Only deposit receipt
                : getStepStatus(step.document)
            : getStepStatus(step.document)
          const StepIcon = step.icon
          const displayLabel = use50_50Split && 'shortLabel' in step ? step.shortLabel : step.label

          return (
            <div key={step.key} className="relative">
              <button
                onClick={() => onTabChange?.(step.key)}
                className={`w-full border-2 rounded-lg p-3 sm:p-4 transition-all ${getStepColor(status, step.color)} ${
                  onTabChange ? 'cursor-pointer hover:shadow-lg hover:scale-105 active:scale-100' : ''
                }`}
              >
                <div className="flex flex-col items-center text-center">
                  <div className={`mb-2 ${getIconColor(status, step.color)}`}>
                    {status === 'completed' ? (
                      <CheckCircle2 className="w-6 h-6 sm:w-8 sm:h-8" />
                    ) : status === 'pending' || status === 'partial' ? (
                      <Clock className="w-6 h-6 sm:w-8 sm:h-8" />
                    ) : (
                      <StepIcon className="w-6 h-6 sm:w-8 sm:h-8" />
                    )}
                  </div>
                  
                  <p className="font-semibold text-xs sm:text-sm mb-1">
                    <span className="sm:hidden">{step.key === 'po' ? 'PO' : displayLabel}</span>
                    <span className="hidden sm:inline">{displayLabel}</span>
                  </p>
                  
                  {step.document ? (
                    <>
                      <Badge 
                        variant="outline" 
                        className="text-[10px] sm:text-xs mb-1"
                      >
                        <span className="truncate max-w-full block leading-tight">{step.document.doc_no}</span>
                      </Badge>
                      <span className="text-xs hidden sm:block">
                        {getDocumentStatusText(step.document)}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs hidden sm:block">Not Created</span>
                  )}
                </div>
              </button>

              {/* Connector Arrow */}
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2 z-10">
                  <div className={`w-8 h-0.5 ${
                    getStepStatus(steps[index + 1].document) !== 'not-started' 
                      ? 'bg-green-400' 
                      : 'bg-gray-300'
                  }`} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Workflow Explanation */}
      <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <p className="text-sm text-blue-900">
          <strong>Workflow:</strong> {use50_50Split 
            ? `Orders use a ${depositPercentage}/${balancePercentage} payment split: Deposit Invoice (${depositPercentage}%) → Deposit Payment (${depositPercentage}%) → Production Complete → Balance Payment Request (${balancePercentage}%) → Balance Payment (${balancePercentage}%) → Receipt.` 
            : 'Each document is automatically created when the previous one is acknowledged. The Receipt marks the completion of the order.'}
        </p>
      </div>
    </Card>
  )
}
