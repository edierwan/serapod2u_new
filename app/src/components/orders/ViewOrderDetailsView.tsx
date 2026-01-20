'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Package, Building2, Calendar, DollarSign, Sparkles, Gift, Trophy, QrCode, FileText, Receipt } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { formatNumber, formatCurrency as formatCurrencyUtil } from '@/lib/utils/formatters'
import OrderDocumentsDialogEnhanced from '@/components/dashboard/views/orders/OrderDocumentsDialogEnhanced'
import DHReceiptDialog from '@/components/orders/DHReceiptDialog'

interface UserProfile {
  id: string
  email: string
  organization_id: string
  organizations: {
    org_name: string
    org_code: string
    org_type_code: string
  }
  roles: {
    role_level: number
  }
}

interface ViewOrderDetailsViewProps {
  userProfile: UserProfile
  onViewChange?: (view: string) => void
  orderId?: string
}

export default function ViewOrderDetailsView({ userProfile, onViewChange, orderId }: ViewOrderDetailsViewProps) {
  const [orderData, setOrderData] = useState<any>(null)
  const [journeyData, setJourneyData] = useState<any>(null)
  const [qrStats, setQrStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [documentsDialogOpen, setDocumentsDialogOpen] = useState(false)
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    const idToLoad = orderId || sessionStorage.getItem('viewOrderId')
    if (idToLoad) {
      loadOrderData(idToLoad)
      loadJourneyData(idToLoad)
      loadQRStats(idToLoad)
    } else {
      toast({
        title: 'Error',
        description: 'No order ID found',
        variant: 'destructive'
      })
      handleBack()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadOrderData(orderId: string) {
    try {
      setLoading(true)

      // Fetch order data with all related data in a single query
      const { data: order, error } = await supabase
        .from('orders')
        .select(`
          *,
          buyer_org:organizations!orders_buyer_org_id_fkey(*),
          seller_org:organizations!orders_seller_org_id_fkey(*),
          created_by_user:users!orders_created_by_fkey(full_name, email, signature_url),
          approved_by_user:users!orders_approved_by_fkey(full_name, email, signature_url)
        `)
        .eq('id', orderId)
        .single()

      if (error) throw error
      if (!order) throw new Error('Order not found')

      // Load order items with product and variant in parallel
      const [itemsResult, poDocResult, paymentDocsResult] = await Promise.all([
        supabase
          .from('order_items')
          .select(`
            *,
            product:products(product_name, product_code),
            variant:product_variants(variant_name)
          `)
          .eq('order_id', orderId),

        // Load PO document to check acknowledgement status
        supabase
          .from('documents')
          .select('status')
          .eq('order_id', orderId)
          .eq('doc_type', 'PO')
          .maybeSingle(),

        // Load acknowledged PAYMENT documents to calculate paid amount
        supabase
          .from('documents')
          .select('payment_percentage, payload')
          .eq('order_id', orderId)
          .eq('doc_type', 'PAYMENT')
          .eq('status', 'acknowledged')
      ])

      const itemsWithDetails = itemsResult.data || []
      const poDoc = poDocResult.data
      const paymentDocs = paymentDocsResult.data

      // Calculate order total and paid amount
      const orderTotal = itemsWithDetails.reduce((sum, item) => sum + (item.line_total || 0), 0)
      let paidAmount = 0

      if (paymentDocs && paymentDocs.length > 0) {
        paymentDocs.forEach((payment: any) => {
          const paymentPct = payment.payment_percentage ||
            (payment.payload as any)?.payment_percentage ||
            (payment.payload as any)?.requested_percent ||
            30 // default deposit percentage
          paidAmount += (orderTotal * paymentPct / 100)
        })
      }

      // Determine payment status
      const poAcknowledged = poDoc?.status === 'acknowledged' || poDoc?.status === 'completed'
      let paymentStatus = 'submitted' // default
      if (order.status === 'approved' && poAcknowledged) {
        if (paidAmount >= orderTotal && orderTotal > 0) {
          paymentStatus = 'paid'
        } else if (paidAmount > 0) {
          paymentStatus = 'partial'
        } else {
          paymentStatus = 'unpaid'
        }
      } else if (order.status === 'approved') {
        paymentStatus = 'approved'
      } else if (order.status === 'closed') {
        paymentStatus = 'closed'
      } else {
        paymentStatus = order.status
      }

      // Combine all data
      const completeOrderData = {
        ...order,
        order_items: itemsWithDetails,
        paid_amount: paidAmount,
        order_total: orderTotal,
        payment_status: paymentStatus,
        po_acknowledged: poAcknowledged
      }

      console.log('✅ Complete order data loaded:', completeOrderData)
      setOrderData(completeOrderData)
    } catch (error: any) {
      console.error('Error loading order:', error?.message || 'Unknown error', error)
      toast({
        title: 'Error',
        description: error?.message || 'Failed to load order details',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  async function loadJourneyData(orderId: string) {
    try {
      // Get journey configuration linked to this order
      const { data: link, error: linkError } = await supabase
        .from('journey_order_links')
        .select('journey_config_id')
        .eq('order_id', orderId)
        .maybeSingle()

      if (linkError) {
        if (linkError.code !== 'PGRST116') {
          console.error('Error loading journey link:', linkError.message || linkError.code || 'Unknown error', linkError)
        }
        return
      }

      if (!link) {
        return // No journey linked to this order
      }

      // Get journey configuration details
      const { data: journeyConfig, error: configError } = await supabase
        .from('journey_configurations')
        .select('*')
        .eq('id', link.journey_config_id)
        .eq('is_active', true)
        .maybeSingle()

      if (configError) {
        if (configError.code !== 'PGRST116') {
          console.error('Error loading journey config:', configError.message || configError.code || 'Unknown error', configError)
        }
        return
      }

      console.log('Journey config loaded:', journeyConfig)
      setJourneyData(journeyConfig)
    } catch (error: any) {
      console.error('Error loading journey data:', error?.message || 'Unknown error', error)
    }
  }

  async function loadQRStats(orderId: string) {
    try {
      // Get batch ID from order
      const { data: batch, error: batchError } = await supabase
        .from('qr_batches')
        .select('id')
        .eq('order_id', orderId)
        .maybeSingle()

      if (batchError) {
        if (batchError.code !== 'PGRST116') {
          console.error('Error loading batch:', batchError.message || batchError.code || 'Unknown error', batchError)
        }
        return
      }

      if (!batch) {
        // No batch found, set default stats
        setQrStats({
          validLinks: 0,
          scanned: 0,
          redemptions: 0,
          luckyDraws: 0
        })
        return
      }

      // Get QR codes stats using proper count queries (avoids 1000 row limit)
      // Count total valid links (all QR codes in batch)
      const { count: validLinks } = await supabase
        .from('qr_codes')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batch.id)

      // Count scanned - actual consumer scans from consumer_qr_scans table
      const { count: scanned } = await supabase
        .from('consumer_qr_scans')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batch.id)

      // Get redemptions count from consumer_qr_scans where reward was redeemed
      const { count: redemptionCount } = await supabase
        .from('consumer_qr_scans')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batch.id)
        .not('redeemed_at', 'is', null)

      // Get lucky draw entries
      const { count: luckyDrawCount } = await supabase
        .from('lucky_draw_entries')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batch.id)

      setQrStats({
        validLinks: validLinks || 0,
        scanned: scanned || 0,
        redemptions: redemptionCount || 0,
        luckyDraws: luckyDrawCount || 0
      })
    } catch (error: any) {
      console.error('Error loading QR stats:', error?.message || 'Unknown error', error)
      // Set default stats on error
      setQrStats({
        validLinks: 0,
        scanned: 0,
        redemptions: 0,
        luckyDraws: 0
      })
    }
  }

  const handleBack = () => {
    sessionStorage.removeItem('viewOrderId')
    if (onViewChange) {
      onViewChange('orders')
    }
  }

  const formatCurrency = (amount: number): string => {
    return formatCurrencyUtil(amount)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading order details...</p>
        </div>
      </div>
    )
  }

  if (!orderData) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Order not found</p>
        <Button onClick={handleBack} className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Orders
        </Button>
      </div>
    )
  }

  const subtotal = orderData.order_items?.reduce((sum: number, item: any) => sum + (item.line_total || 0), 0) || 0
  
  // Logic to swap display for Sales Orders (SO) vs Purchase Orders (PO)
  // For PO: Header is Buyer (Issuer), Section is Supplier
  // For SO: Header is Seller (Issuer), Section is Customer
  const isSalesOrder = orderData.order_type === 'SO' || orderData.order_no?.startsWith('SO')
  const headerOrg = isSalesOrder ? orderData.seller_org : orderData.buyer_org
  const otherOrg = isSalesOrder ? orderData.buyer_org : orderData.seller_org
  const otherOrgLabel = isSalesOrder ? 'Customer:' : 'Supplier:'
  const docTitle = isSalesOrder ? 'SALES ORDER' : 'PURCHASE ORDER'
  const docNoLabel = isSalesOrder ? 'SO#:' : 'PO#:'

  const totalQuantity = orderData.order_items?.reduce((sum: number, item: any) => sum + (item.qty || 0), 0) || 0

  // Helper to get status color based on payment status
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'text-green-600'
      case 'partial': return 'text-orange-600'
      case 'unpaid': return 'text-red-600'
      case 'approved': return 'text-green-600'
      case 'closed': return 'text-gray-600'
      case 'cancelled': return 'text-red-600'
      case 'draft': return 'text-gray-500'
      default: return 'text-yellow-600' // submitted/pending
    }
  }

  // Get display status (payment status takes priority for approved orders)
  const getDisplayStatus = () => {
    if (orderData.payment_status && ['paid', 'partial', 'unpaid'].includes(orderData.payment_status)) {
      return orderData.payment_status.toUpperCase()
    }
    return orderData.status === 'submitted' ? 'SUBMITTED' : orderData.status?.toUpperCase()
  }

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      {/* Action Bar */}
      <div className="bg-white border-b border-gray-200 mb-0 print:hidden">
        <div className="px-6 py-4 flex justify-between items-center">
          <Button
            variant="ghost"
            onClick={handleBack}
            className="hover:bg-gray-100 -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Orders
          </Button>
          <div className="flex gap-3">
            {/* Receipt Button - Only show for D2H orders that are approved */}
            {(orderData?.order_type === 'D2H' || orderData?.order_type === 'DH') && orderData?.status === 'approved' && (
              <Button
                onClick={() => setReceiptDialogOpen(true)}
                variant="outline"
                className="gap-2 border-green-300 text-green-700 hover:bg-green-50"
              >
                <Receipt className="w-4 h-4" />
                Receipt
              </Button>
            )}
            <Button
              onClick={() => setDocumentsDialogOpen(true)}
              variant="outline"
              className="gap-2 border-gray-300 hover:bg-gray-50"
            >
              <FileText className="w-4 h-4" />
              Documents
            </Button>
            <Button
              onClick={() => {
                // Set document title for PDF filename
                const originalTitle = document.title
                if (orderData?.order_no) {
                  document.title = `PO ${orderData.order_no}`
                }

                // Show a toast with instructions
                toast({
                  title: 'Print Dialog Opening',
                  description: 'In the print dialog, select "Save as PDF" as your printer destination to download the PDF file.',
                })
                // Trigger browser print dialog
                setTimeout(() => {
                  window.print()
                  // Restore title after a delay to ensure print dialog picked it up
                  setTimeout(() => {
                    document.title = originalTitle
                  }, 2000)
                }, 500)
              }}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <FileText className="w-4 h-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Document Container */}
      <div className="bg-white shadow-lg p-8 md:p-12 print:shadow-none print:p-8 print:w-full">

        {/* Header Section - 3 Columns in 1 Row */}
        <div className="flex justify-between items-start mb-12 print:mb-6 gap-8">
          {/* Left: Company Logo */}
          <div className="flex-shrink-0">
            {headerOrg?.logo_url ? (
              <img
                src={headerOrg.logo_url}
                alt={headerOrg.org_name}
                className="h-60 object-contain"
              />
            ) : (
              <h1 className="text-2xl font-bold tracking-tight">serapod<span className="text-blue-600">2u</span></h1>
            )}
          </div>

          {/* Center: Headquarters Detail */}
          <div className="flex-1">
            <h2 className="font-bold text-gray-900 uppercase mb-2 text-sm tracking-wide">
              {headerOrg?.org_name}
            </h2>
            <div className="text-xs text-gray-600 space-y-1 leading-relaxed">
              <p className="whitespace-pre-line">{headerOrg?.address || 'No address provided'}</p>
              {headerOrg?.phone && <p>Phone: {headerOrg.phone}</p>}
              {headerOrg?.email && <p>Email: {headerOrg.email}</p>}
              {headerOrg?.website && <p>Website: {headerOrg.website}</p>}
            </div>
          </div>

          {/* Right: PO Detail */}
          <div className="flex-shrink-0 text-right">
            <h1 className="text-xl font-light text-gray-900 mb-4 uppercase tracking-wider">{docTitle}</h1>
            <div className="text-xs space-y-2">
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">{docNoLabel}</span>
                <span className="font-medium text-gray-900">{orderData.display_doc_no || orderData.order_no}</span>
              </div>
              {orderData.display_doc_no && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">Legacy#:</span>
                  <span className="font-medium text-gray-400 text-[10px]">{orderData.order_no}</span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Date:</span>
                <span className="font-medium text-gray-900">{new Date(orderData.created_at).toLocaleDateString('en-MY')}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">By:</span>
                <span className="font-medium text-gray-900">{orderData.created_by_user?.full_name || 'Unknown'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Ledger:</span>
                <span className="font-medium text-gray-900">Stock Purchased / Inventory</span>
              </div>
            </div>
          </div>
        </div>

        {/* Supplier & Status Section */}
        <div className="flex justify-between items-start mb-12 print:mb-6 border-t border-gray-100 pt-8 print:pt-4">
          {/* Supplier Info */}
          <div className="w-1/2">
            <h3 className="font-bold text-gray-900 mb-3 text-sm">{otherOrgLabel}</h3>
            <div className="text-xs text-gray-600 space-y-1 leading-relaxed">
              <p className="font-bold text-gray-800 uppercase mb-1">{otherOrg?.org_name}</p>
              {/* Contact Person if available, otherwise generic */}
              <p className="uppercase">{otherOrg?.contact_person || ''}</p>
              <p className="whitespace-pre-line max-w-xs">{otherOrg?.address || 'No address provided'}</p>
              <p>{otherOrg?.email}</p>
            </div>
          </div>

          {/* Status Box */}
          <div className="w-48">
            <div className="border border-gray-200 p-4 text-center rounded-sm">
              <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Status</p>
              <p className={`text-xl font-bold uppercase ${getStatusColor(orderData.payment_status || orderData.status)}`}>
                {getDisplayStatus()}
              </p>
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div className="mb-12 print:mb-6">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 text-left text-xs font-bold text-gray-900 w-12">No</th>
                <th className="py-2 text-left text-xs font-bold text-gray-900">Description</th>
                <th className="py-2 text-right text-xs font-bold text-gray-900 w-24">Unit</th>
                <th className="py-2 text-right text-xs font-bold text-gray-900 w-32">Price</th>
                <th className="py-2 text-right text-xs font-bold text-gray-900 w-32">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orderData.order_items?.map((item: any, index: number) => (
                <tr key={item.id} className="break-inside-avoid page-break-inside-avoid">
                  <td className="py-3 text-xs text-gray-600 align-top pt-4">{index + 1}</td>
                  <td className="py-3 text-xs text-gray-900 align-top pt-4">
                    <p className="font-medium text-sm whitespace-nowrap">
                      {(() => {
                        // Extract product base name (e.g., "Cellera Hero")
                        const productName = item.product?.product_name?.replace(/\[.*?\]\s*$/, '').trim() || '';
                        // Extract variant details (e.g., "Deluxe Cellera Cartridge [ Strawberry Cheesecake ]")
                        const variantName = item.variant?.variant_name || '';

                        // If variant contains brackets, extract the parts
                        const bracketMatch = variantName.match(/^(.*?)\s*\[(.*?)\]\s*$/);
                        if (bracketMatch) {
                          // Format: ProductName VariantType [ VariantFlavor ]
                          return `${productName} ${bracketMatch[1].trim()} [ ${bracketMatch[2].trim()} ]`;
                        }
                        // Fallback: Just show product name and variant
                        return `${productName} ${variantName}`;
                      })()}
                    </p>
                  </td>
                  <td className="py-3 text-xs text-gray-900 text-right align-top pt-4">{formatNumber(item.qty)}</td>
                  <td className="py-3 text-xs text-gray-900 text-right align-top pt-4">{formatCurrency(item.unit_price).replace('RM', '')}</td>
                  <td className="py-3 text-xs text-gray-900 text-right align-top pt-4">{formatCurrency(item.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200">
                <td colSpan={2} className="py-4"></td>
                <td className="py-4 text-right text-xs font-bold text-gray-900">{formatNumber(totalQuantity)}</td>
                <td className="py-4 text-right text-xs font-bold text-gray-900">Total</td>
                <td className="py-4 text-right text-sm font-bold text-gray-900">{formatCurrency(subtotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer Notes & Signature */}
        <div className="mt-12 pt-8 print:mt-4 print:pt-4 border-t border-gray-100 break-inside-avoid page-break-inside-avoid">
          <div className="flex justify-between items-start">
            {/* Left: Issued By with Company Signature */}
            <div>
              {headerOrg?.signature_type === 'electronic' && headerOrg?.signature_url && (
                <div className="mb-6">
                  <p className="text-sm font-bold text-gray-900 mb-2">Issued by:</p>
                  <div className="flex items-start gap-4">
                    <div className="w-32 h-24 flex items-center">
                      <img
                        src={headerOrg.signature_url}
                        alt="Company Signature"
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-8">This is a computer generated document.</p>
            </div>

            {/* Center: Created By */}
            <div className="text-center">
              <p className="text-xs text-gray-600 mb-2">Created by: {orderData.created_by_user?.full_name || 'Unknown'}</p>
              {orderData.created_by_user?.signature_url && (
                <div className="flex justify-center mb-2">
                  <img
                    src={orderData.created_by_user.signature_url}
                    alt="Created by signature"
                    className="h-16 print:h-12 object-contain"
                  />
                </div>
              )}
              <div className="border-t border-gray-300 w-48 mx-auto pt-1">
                <p className="text-xs text-gray-500">{orderData.created_at ? new Date(orderData.created_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</p>
              </div>
            </div>

            {/* Right: Approved By */}
            {orderData.approved_by && orderData.approved_by_user && (
              <div className="text-center">
                <p className="text-xs text-gray-600 mb-2">Approved by: {orderData.approved_by_user.full_name || 'Unknown'}</p>
                {orderData.approved_by_user.signature_url && (
                  <div className="flex justify-center mb-2">
                    <img
                      src={orderData.approved_by_user.signature_url}
                      alt="Approved by signature"
                      className="h-16 print:h-12 object-contain"
                    />
                  </div>
                )}
                <div className="border-t border-gray-300 w-48 mx-auto pt-1">
                  <p className="text-xs text-gray-500">{orderData.approved_at ? new Date(orderData.approved_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Order Documents Dialog */}
      {orderData && (
        <OrderDocumentsDialogEnhanced
          orderId={orderData.id}
          orderNo={orderData.order_no}
          displayOrderNo={orderData.display_doc_no}
          userProfile={userProfile}
          open={documentsDialogOpen}
          onClose={() => setDocumentsDialogOpen(false)}
        />
      )}

      {/* DH Receipt Dialog - For recording payments from distributors */}
      {orderData && (orderData.order_type === 'D2H' || orderData.order_type === 'DH') && (
        <DHReceiptDialog
          orderId={orderData.id}
          orderNo={orderData.order_no}
          orderTotal={subtotal}
          paidAmount={orderData.paid_amount || 0}
          buyerOrgId={orderData.buyer_org_id}
          sellerOrgId={orderData.seller_org_id}
          companyId={orderData.company_id}
          open={receiptDialogOpen}
          onClose={() => setReceiptDialogOpen(false)}
          onSuccess={() => {
            // Reload order data to update paid amounts
            loadOrderData(orderData.id)
          }}
        />
      )}
    </div>
  )
}
