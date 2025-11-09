'use client'

import { useState, useEffect } from 'react'
import { Bell, DollarSign, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'

interface PendingPaymentRequest {
  id: string
  doc_no: string
  order_id: string
  created_at: string
  payload: {
    po_no?: string
    requested_amount?: number
    currency?: string
  }
}

export default function PaymentRequestNotifications() {
  const [pendingRequests, setPendingRequests] = useState<PendingPaymentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showDropdown, setShowDropdown] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    loadPendingRequests()

    // Subscribe to real-time updates
    const channel = supabase
      .channel('payment-requests-notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'documents',
          filter: 'doc_type=eq.PAYMENT_REQUEST'
        },
        () => {
          loadPendingRequests()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPendingRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('id, doc_no, order_id, created_at, payload')
        .eq('doc_type', 'PAYMENT_REQUEST')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) throw error

      setPendingRequests(data || [])
    } catch (error) {
      console.error('Error loading pending payment requests:', error)
    } finally {
      setLoading(false)
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

  const formatTimeAgo = (dateString: string) => {
    const now = new Date()
    const date = new Date(dateString)
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    
    if (diffInSeconds < 60) return 'just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`
    return `${Math.floor(diffInSeconds / 2592000)}mo ago`
  }

  const handleViewRequest = (request: PendingPaymentRequest) => {
    // Store order ID and navigate to track order view
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('trackingOrderId', request.order_id)
      window.location.href = `/dashboard?view=track-order&orderId=${request.order_id}`
    }
  }

  const count = pendingRequests.length

  if (loading) {
    return (
      <Button variant="ghost" size="icon" disabled>
        <Bell className="h-5 w-5 animate-pulse" />
      </Button>
    )
  }

  return (
    <div className="relative">
      <Button 
        variant="ghost" 
        size="icon" 
        className="relative"
        onClick={() => setShowDropdown(!showDropdown)}
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <Badge 
            className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-orange-600 hover:bg-orange-600 text-white border-2 border-white text-xs"
          >
            {count > 9 ? '9+' : count}
          </Badge>
        )}
      </Button>

      {showDropdown && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowDropdown(false)}
          />

          {/* Dropdown */}
          <Card className="absolute right-0 mt-2 w-80 max-h-96 overflow-hidden z-50 shadow-lg">
            <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-orange-600" />
                <span className="font-semibold text-sm">Pending Payment Requests</span>
                {count > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {count}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setShowDropdown(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="overflow-y-auto max-h-80">
              {count === 0 ? (
                <div className="px-4 py-8 text-center">
                  <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No pending requests</p>
                </div>
              ) : (
                pendingRequests.map((request) => (
                  <div
                    key={request.id}
                    className="border-b last:border-b-0 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => handleViewRequest(request)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-semibold text-sm truncate">
                        {request.doc_no}
                      </p>
                      <Badge className="text-xs bg-orange-50 text-orange-700 border-orange-300 flex-shrink-0">
                        Pending
                      </Badge>
                    </div>

                    {request.payload?.po_no && (
                      <p className="text-xs text-gray-500 mb-1">
                        PO: {request.payload.po_no}
                      </p>
                    )}

                    {request.payload?.requested_amount && (
                      <p className="text-sm font-medium text-gray-900 mb-1">
                        {formatCurrency(
                          request.payload.requested_amount,
                          request.payload.currency
                        )}
                      </p>
                    )}

                    <p className="text-xs text-gray-500">
                      {formatTimeAgo(request.created_at)}
                    </p>
                  </div>
                ))
              )}
            </div>

            {count > 0 && (
              <div className="sticky bottom-0 bg-white border-t p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    window.location.href = '/dashboard?view=orders&filter=pending-payment-requests'
                  }}
                >
                  View All Requests
                </Button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
