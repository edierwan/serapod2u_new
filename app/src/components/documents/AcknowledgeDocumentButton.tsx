/**
 * Document Acknowledge Button Component
 * Handles document acknowledgement with signature
 */

'use client';

import { useState } from 'react';
import { FileCheck, Upload, AlertCircle } from 'lucide-react';
import {
  SeraModalOverlay,
  SeraModalPanel,
  SeraModalHeader,
  SeraModalBody,
  SeraModalFooter,
} from '@/components/ui/sera-modal';
import { Button } from '@/components/ui/button';

interface AcknowledgeDocumentButtonProps {
  documentId: string;
  documentType: 'PO' | 'INVOICE' | 'PAYMENT' | 'RECEIPT';
  documentNo: string;
  requiresPaymentProof?: boolean;
  onSuccess?: (result: any) => void;
  onError?: (error: string) => void;
  className?: string;
}

export default function AcknowledgeDocumentButton({
  documentId,
  documentType,
  documentNo,
  requiresPaymentProof = false,
  onSuccess,
  onError,
  className = '',
}: AcknowledgeDocumentButtonProps) {
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [showPaymentProofDialog, setShowPaymentProofDialog] = useState(false);
  const [paymentProofUrl, setPaymentProofUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAcknowledge = async () => {
    // For invoices that require payment proof, show dialog
    if (documentType === 'INVOICE' && requiresPaymentProof && !paymentProofUrl) {
      setShowPaymentProofDialog(true);
      return;
    }

    setIsAcknowledging(true);
    setError(null);

    try {
      const response = await fetch(`/api/documents/${documentId}/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentProofUrl: paymentProofUrl || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to acknowledge document');
      }

      if (onSuccess) {
        onSuccess(result);
      }

      // Close dialog if open
      setShowPaymentProofDialog(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to acknowledge document';
      setError(errorMessage);
      if (onError) {
        onError(errorMessage);
      }
    } finally {
      setIsAcknowledging(false);
    }
  };

  const getButtonText = () => {
    if (isAcknowledging) return 'Acknowledging...';
    
    switch (documentType) {
      case 'PO':
        return 'Acknowledge PO';
      case 'INVOICE':
        return 'Acknowledge Invoice';
      case 'PAYMENT':
        return 'Acknowledge Payment';
      case 'RECEIPT':
        return 'Acknowledge Receipt';
      default:
        return 'Acknowledge Document';
    }
  };

  return (
    <>
      <button
        onClick={handleAcknowledge}
        disabled={isAcknowledging}
        className={`
          inline-flex items-center gap-2 px-4 py-2 
          bg-blue-600 text-white text-sm font-medium rounded-lg
          hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors
          ${className}
        `}
      >
        <FileCheck className="w-4 h-4" />
        {getButtonText()}
      </button>

      {/* Payment Proof Dialog */}
      {showPaymentProofDialog && (
        <SeraModalOverlay onBackdropClick={() => {
          if (!isAcknowledging) {
            setShowPaymentProofDialog(false);
            setError(null);
          }
        }}>
          <SeraModalPanel>
            <SeraModalHeader
              title="Payment Proof Required"
              onClose={() => {
                if (!isAcknowledging) {
                  setShowPaymentProofDialog(false);
                  setError(null);
                }
              }}
            />
            <SeraModalBody className="space-y-4">
              <p className="text-sm text-[var(--sera-muted)]">
                Please provide the payment proof URL before acknowledging this invoice.
              </p>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--sera-ink)] mb-2">
                  Payment Proof URL
                </label>
                <input
                  type="url"
                  value={paymentProofUrl}
                  onChange={(e) => setPaymentProofUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-[var(--sera-line)] rounded-lg focus:ring-2 focus:ring-[var(--sera-orange)]/30 focus:border-[var(--sera-orange)]"
                />
                <p className="text-xs text-[var(--sera-muted)] mt-1">
                  Upload your payment advice to storage and paste the URL here
                </p>
              </div>
            </SeraModalBody>
            <SeraModalFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowPaymentProofDialog(false);
                  setError(null);
                }}
                disabled={isAcknowledging}
                className="border-[var(--sera-line)]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAcknowledge}
                disabled={isAcknowledging || !paymentProofUrl}
                className="bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white"
              >
                {isAcknowledging ? 'Processing...' : 'Acknowledge'}
              </Button>
            </SeraModalFooter>
          </SeraModalPanel>
        </SeraModalOverlay>
      )}
    </>
  );
}
