/**
 * Document Acknowledge Button Component
 * Handles document acknowledgement with signature
 */

'use client';

import { useState } from 'react';
import { FileCheck, Upload, AlertCircle } from 'lucide-react';

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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Payment Proof Required
            </h3>

            <p className="text-sm text-gray-600 mb-4">
              Please provide the payment proof URL before acknowledging this invoice.
            </p>

            {error && (
              <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Payment Proof URL
              </label>
              <input
                type="url"
                value={paymentProofUrl}
                onChange={(e) => setPaymentProofUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                Upload your payment advice to storage and paste the URL here
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowPaymentProofDialog(false);
                  setError(null);
                }}
                disabled={isAcknowledging}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAcknowledge}
                disabled={isAcknowledging || !paymentProofUrl}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAcknowledging ? 'Processing...' : 'Acknowledge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
