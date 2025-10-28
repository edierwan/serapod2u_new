/**
 * Document Signatures Display Component
 * Shows the signature trail for a document with download link
 */

'use client';

import { useEffect, useState } from 'react';
import { Download, FileCheck, Shield, Clock, User } from 'lucide-react';
import Image from 'next/image';

export interface DocumentSignature {
  id: string;
  signer_user_id: string;
  signer_name: string;
  signer_role: string;
  signed_at: string;
  signature_image_url: string | null;
  signature_hash: string;
}

interface DocumentSignaturesProps {
  documentId: string;
  signedPdfUrl?: string | null;
  signatures?: DocumentSignature[];
  showDownload?: boolean;
}

export default function DocumentSignatures({
  documentId,
  signedPdfUrl,
  signatures: initialSignatures,
  showDownload = true,
}: DocumentSignaturesProps) {
  const [signatures, setSignatures] = useState<DocumentSignature[]>(initialSignatures || []);
  const [loading, setLoading] = useState(!initialSignatures);

  const fetchSignatures = async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}/acknowledge`);
      if (response.ok) {
        const data = await response.json();
        setSignatures(data.signatures || []);
      }
    } catch (error) {
      console.error('Failed to fetch signatures:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialSignatures) {
      fetchSignatures();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-MY', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  };

  const getRoleLabel = (role: string) => {
    const roleMap: Record<string, string> = {
      HQ_ADMIN: 'HQ Administrator',
      POWER_USER: 'Power User (HQ)',
      MANUFACTURER: 'Manufacturer',
      DISTRIBUTOR: 'Distributor',
      SHOP: 'Shop',
    };
    return roleMap[role] || role;
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-gray-200 rounded w-1/3"></div>
        <div className="h-32 bg-gray-200 rounded"></div>
      </div>
    );
  }

  if (!signatures || signatures.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
        <Shield className="w-12 h-12 mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-600">No signatures yet</p>
        <p className="text-xs text-gray-500 mt-1">
          This document will be signed when acknowledged
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Signed PDF Download */}
      {signedPdfUrl && showDownload && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <FileCheck className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-green-900">Signed Document Available</p>
                <p className="text-xs text-green-700">
                  {signatures.length} signature{signatures.length > 1 ? 's' : ''} recorded
                </p>
              </div>
            </div>
            <a
              href={signedPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </a>
          </div>
        </div>
      )}

      {/* Signatures Section */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">Signatures / Approval Trail</h3>
        </div>

        <div className="space-y-4">
          {signatures.map((signature, index) => (
            <div
              key={signature.id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Signature Image */}
                <div className="flex-shrink-0">
                  <div className="w-48 h-24 border border-gray-300 rounded bg-gray-50 flex items-center justify-center overflow-hidden">
                    {signature.signature_image_url ? (
                      <Image
                        src={signature.signature_image_url}
                        alt={`${signature.signer_name}'s signature`}
                        width={192}
                        height={96}
                        className="max-w-full max-h-full object-contain"
                      />
                    ) : (
                      <p className="text-xs text-gray-400 italic">No signature image</p>
                    )}
                  </div>
                </div>

                {/* Signature Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                      {index === 0 ? 'Acknowledged By' : `Confirmed By (${index})`}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="font-medium text-gray-900">{signature.signer_name}</span>
                      <span className="text-gray-500">•</span>
                      <span className="text-gray-600">{getRoleLabel(signature.signer_role)}</span>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span>{formatDateTime(signature.signed_at)}</span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">
                      <Shield className="w-3 h-3" />
                      <span title={signature.signature_hash}>
                        Hash: {signature.signature_hash.substring(0, 16)}...
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Verification Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Cryptographically Verified</p>
            <p className="text-xs">
              Each signature is timestamped and includes an SHA-256 integrity hash. The signed PDF
              contains all signature details and cannot be modified without detection.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
