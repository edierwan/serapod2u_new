'use client'

import { Download, Eye, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useState } from 'react'

interface AvailableActionsCardProps {
  orderId: string
  orderNo: string
  onViewDocuments: () => void
  onReportIssue: () => void
}

export default function AvailableActionsCard({
  orderId,
  orderNo,
  onViewDocuments,
  onReportIssue
}: AvailableActionsCardProps) {
  const [downloadingPDF, setDownloadingPDF] = useState(false)

  const handleDownloadOrder = async () => {
    setDownloadingPDF(true)
    try {
      // Trigger PDF download
      const response = await fetch(`/api/documents/download?orderId=${orderId}&type=order`)
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${orderNo}-order.pdf`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      }
    } catch (error) {
      console.error('Error downloading order:', error)
    } finally {
      setDownloadingPDF(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Available Actions</CardTitle>
        <p className="text-sm text-gray-500">Quick actions you can perform on this order</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Download Order */}
          <button
            onClick={handleDownloadOrder}
            disabled={downloadingPDF}
            className="flex flex-col items-start p-6 border-2 border-blue-200 rounded-lg hover:border-blue-400 hover:shadow-md transition-all duration-200 bg-blue-50/50 hover:bg-blue-50 group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
              <Download className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">
              {downloadingPDF ? 'Downloading...' : 'Download Order'}
            </h3>
            <p className="text-sm text-gray-600">
              Download a PDF copy of this order for your records
            </p>
          </button>

          {/* View Documents */}
          <button
            onClick={onViewDocuments}
            className="flex flex-col items-start p-6 border-2 border-purple-200 rounded-lg hover:border-purple-400 hover:shadow-md transition-all duration-200 bg-purple-50/50 hover:bg-purple-50 group"
          >
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-purple-200 transition-colors">
              <Eye className="w-6 h-6 text-purple-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">View Documents</h3>
            <p className="text-sm text-gray-600">
              View all documents related to this order including PO, invoices, and receipts
            </p>
          </button>

          {/* Report Issue */}
          <button
            onClick={onReportIssue}
            className="flex flex-col items-start p-6 border-2 border-orange-200 rounded-lg hover:border-orange-400 hover:shadow-md transition-all duration-200 bg-orange-50/50 hover:bg-orange-50 group"
          >
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-orange-200 transition-colors">
              <AlertCircle className="w-6 h-6 text-orange-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Report Issue</h3>
            <p className="text-sm text-gray-600">
              Report a problem with this order for our team to investigate
            </p>
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
