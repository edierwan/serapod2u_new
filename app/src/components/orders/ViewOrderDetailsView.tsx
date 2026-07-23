'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveOrganizationLogoUrl } from '@/lib/organizations/logo'
import { resolveUserSignatureUrl } from '@/lib/users/signature'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Building2, Calendar, DollarSign, Sparkles, Gift, Trophy, QrCode, FileText, Receipt, Clock, CheckCircle2, Download } from 'lucide-react'
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

type OrderActor = {
  id?: string
  email?: string | null
  full_name?: string | null
  signature_url?: string | null
}

function mergeOrderActor(
  existing: OrderActor | null | undefined,
  fallback: OrderActor | undefined,
): OrderActor | undefined {
  if (!existing) return fallback
  if (!fallback) return existing

  return {
    ...fallback,
    ...existing,
    full_name: existing.full_name || fallback.full_name,
    email: existing.email || fallback.email,
    signature_url: existing.signature_url || fallback.signature_url,
  }
}

export default function ViewOrderDetailsView({ userProfile, onViewChange, orderId }: ViewOrderDetailsViewProps) {
  const [orderData, setOrderData] = useState<any>(null)
  const [journeyData, setJourneyData] = useState<any>(null)
  const [qrStats, setQrStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [documentsDialogOpen, setDocumentsDialogOpen] = useState(false)
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  const [companySignatureFailed, setCompanySignatureFailed] = useState(false)
  const [creatorSignatureUrl, setCreatorSignatureUrl] = useState<string | null>(null)
  const [creatorSignatureFailed, setCreatorSignatureFailed] = useState(false)
  const [approverSignatureUrl, setApproverSignatureUrl] = useState<string | null>(null)
  const [approverSignatureFailed, setApproverSignatureFailed] = useState(false)
  const [stockConfigurations, setStockConfigurations] = useState<any[]>([])
  const [confirmingItemId, setConfirmingItemId] = useState<string | null>(null)
  const printAreaRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    const idToLoad = orderId || sessionStorage.getItem('viewOrderId')
    if (idToLoad) {
      loadAuthorizedOrderData(idToLoad)
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

  // Stored signature values are raw public-object URLs for the `documents`
  // bucket, which the storage gateway rejects without credentials; they must
  // be re-signed before an <img> can load them.
  const storedCreatorSignature = orderData?.created_by_user?.signature_url ?? null
  const storedApproverSignature = orderData?.approved_by_user?.signature_url ?? null

  useEffect(() => {
    let cancelled = false

    const resolve = async () => {
      const [created, approved] = await Promise.all([
        resolveUserSignatureUrl(supabase, storedCreatorSignature),
        resolveUserSignatureUrl(supabase, storedApproverSignature),
      ])

      if (cancelled) return
      setCreatorSignatureUrl(created)
      setCreatorSignatureFailed(false)
      setApproverSignatureUrl(approved)
      setApproverSignatureFailed(false)
    }

    resolve()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedCreatorSignature, storedApproverSignature])

  useEffect(() => {
    setLogoFailed(false)
    setCompanySignatureFailed(false)
  }, [orderData?.id])

  async function loadAuthorizedOrderData(orderId: string) {
    try {
      const accessResponse = await fetch(`/api/orders/${encodeURIComponent(orderId)}/access`)
      if (!accessResponse.ok) {
        const result = await accessResponse.json().catch(() => null)
        throw new Error(result?.error || 'Unauthorized')
      }

      await Promise.all([
        loadOrderData(orderId),
        loadJourneyData(orderId),
        loadQRStats(orderId),
      ])
    } catch (error: any) {
      setLoading(false)
      toast({
        title: 'Unauthorized',
        description: error?.message || 'You do not have permission to view this order',
        variant: 'destructive'
      })
    }
  }

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

      // Resolve fulfillment warehouse display name for D2H/S2D (legacy-safe).
      const fulfillmentWarehouseId = (order as any).fulfillment_warehouse_id as string | null
      if (fulfillmentWarehouseId) {
        const { data: fulfillmentWarehouse } = await supabase
          .from('organizations')
          .select('id, org_name')
          .eq('id', fulfillmentWarehouseId)
          .maybeSingle()
        ;(order as any).fulfillment_warehouse_name = fulfillmentWarehouse?.org_name || null
      } else if (['D2H', 'S2D', 'DH'].includes(order.order_type)) {
        const { data: inventoryOrgId } = await (supabase as any).rpc('order_inventory_organization', {
          p_order_id: orderId,
        })
        if (inventoryOrgId) {
          const { data: fulfillmentWarehouse } = await supabase
            .from('organizations')
            .select('id, org_name')
            .eq('id', inventoryOrgId)
            .maybeSingle()
          ;(order as any).fulfillment_warehouse_id = inventoryOrgId
          ;(order as any).fulfillment_warehouse_name = fulfillmentWarehouse?.org_name || null
        }
      }

      // Compute resolved actors (may be hydrated from API). We keep them
      // separate from the Supabase-inferred row type to avoid type conflicts.
      let resolvedCreatedByUser = order.created_by_user as OrderActor | null | undefined
      let resolvedApprovedByUser = order.approved_by_user as OrderActor | null | undefined

      if (!resolvedCreatedByUser || (order.approved_by && !resolvedApprovedByUser)) {
        try {
          const actorResponse = await fetch('/api/orders/actors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderIds: [orderId] })
          })

          if (actorResponse.ok) {
            const actorPayload: unknown = await actorResponse.json()
            const rawUsers: unknown[] = (typeof actorPayload === 'object' && actorPayload !== null && Array.isArray((actorPayload as Record<string, unknown>).users))
              ? (actorPayload as Record<string, unknown[]>).users
              : []
            const actorUsers: OrderActor[] = rawUsers.filter(
              (u): u is OrderActor => typeof u === 'object' && u !== null && typeof (u as OrderActor).id === 'string'
            )
            const actorMap = new Map(actorUsers.map((actor: OrderActor) => [actor.id, actor]))

            const fallbackCreatedBy: OrderActor | undefined = order.created_by
              ? (actorMap.get(order.created_by) ?? undefined)
              : undefined
            const fallbackApprovedBy: OrderActor | undefined = order.approved_by
              ? (actorMap.get(order.approved_by) ?? undefined)
              : undefined

            resolvedCreatedByUser = mergeOrderActor(resolvedCreatedByUser, fallbackCreatedBy)
            resolvedApprovedByUser = mergeOrderActor(resolvedApprovedByUser, fallbackApprovedBy)
          }
        } catch (actorError) {
          console.warn('Failed to hydrate order detail actors:', actorError)
        }
      }

      // Load order items with product and variant in parallel
      const [itemsResult, poDocResult, paymentDocsResult] = await Promise.all([
        supabase
          .from('order_items')
          .select(`
            *,
            product:products(product_name, product_code),
            variant:product_variants(variant_name),
            stock_config:inventory_stock_configurations!order_items_stock_config_variant_fkey(id, config_code, config_label, stock_sku, volume_ml, packaging)
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

      if (itemsResult.error) throw itemsResult.error

      const itemVariantIds = Array.from(new Set((itemsResult.data || []).map((item: any) => item.variant_id)))
      if (itemVariantIds.length > 0 && ['HQ', 'WH'].includes(userProfile.organizations?.org_type_code)) {
        const [{ data: configs, error: configsError }, inventoryOrgResult, eligibilityResult] = await Promise.all([
          supabase
          .from('inventory_stock_configurations')
          .select('id, variant_id, config_code, config_label, stock_sku, volume_ml, packaging, allow_so, status, requires_repacking_before_sale')
          .in('variant_id', itemVariantIds)
          .eq('status', 'active')
          .eq('allow_so', true)
          .eq('requires_repacking_before_sale', false)
          .order('sort_order'),
          (supabase as any).rpc('order_inventory_organization', { p_order_id: orderId }),
          supabase.from('distributor_stock_config_eligibility')
            .select('allow_50ml_new_box')
            .eq('distributor_org_id', order.buyer_org_id)
            .maybeSingle(),
        ])
        if (configsError) throw configsError
        const inventoryOrgId = inventoryOrgResult.data as string | null
        const { data: balances, error: balancesError } = inventoryOrgId
          ? await supabase.from('product_inventory')
            .select('variant_id, stock_config_id, quantity_on_hand, quantity_allocated, quantity_available')
            .eq('organization_id', inventoryOrgId)
            .in('variant_id', itemVariantIds)
            .eq('is_active', true)
          : { data: [], error: inventoryOrgResult.error }
        if (balancesError) throw balancesError
        const balanceMap = new Map((balances || []).map((balance: any) => [balance.stock_config_id, balance]))
        const eligible50ml = eligibilityResult.data?.allow_50ml_new_box === true
        setStockConfigurations((configs || []).filter((config: any) => config.packaging !== 'old_box').map((config: any) => {
          const balance: any = balanceMap.get(config.id)
          return {
            ...config,
            onHand: Number(balance?.quantity_on_hand || 0),
            allocated: Number(balance?.quantity_allocated || 0),
            available: Number(balance?.quantity_available || 0),
            eligible: config.volume_ml === 50 ? eligible50ml : true,
          }
        }))
      } else {
        setStockConfigurations([])
      }

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

      // Combine all data, overriding actor fields with resolved/hydrated values.
      const completeOrderData = {
        ...order,
        created_by_user: resolvedCreatedByUser ?? order.created_by_user,
        approved_by_user: resolvedApprovedByUser ?? order.approved_by_user,
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
    window.history.replaceState({}, '', '/supply-chain')
    if (onViewChange) {
      onViewChange('orders')
    }
  }

  const formatCurrency = (amount: number): string => {
    return formatCurrencyUtil(amount)
  }

  const confirmStockConfiguration = async (item: any, stockConfig: any) => {
    if (item.stock_config_id && item.stock_config_id !== stockConfig.id) {
      const current = item.stock_config?.config_label || 'the current configuration'
      if (!window.confirm(`Move this line's allocation from ${current} to ${stockConfig.config_label}? This change is atomic and will not alter the order price.`)) return
    }
    try {
      setConfirmingItemId(item.id)
      const { error } = await supabase.rpc('set_order_item_stock_config', {
        p_order_item_id: item.id,
        p_stock_config_id: stockConfig.id,
      })
      if (error) throw error
      await loadOrderData(orderData.id)
      toast({ title: 'Configuration confirmed', description: 'The exact warehouse stock configuration is now locked to this line.' })
    } catch (error: any) {
      toast({ title: 'Configuration not confirmed', description: error?.message || 'Unable to confirm stock configuration.', variant: 'destructive' })
    } finally {
      setConfirmingItemId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-[var(--sera-muted)]">Loading order details...</p>
        </div>
      </div>
    )
  }

  if (!orderData) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--sera-muted)]">Order not found</p>
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
  // Check display_doc_no first (new format like SO26000044), then fall back to order_no and order_type
  const isSalesOrder = (orderData.display_doc_no || orderData.order_no)?.startsWith('SO') || orderData.order_type === 'SO'
  const headerOrg = isSalesOrder ? orderData.seller_org : orderData.buyer_org
  const otherOrg = isSalesOrder ? orderData.buyer_org : orderData.seller_org
  const otherOrgLabel = isSalesOrder ? 'Customer:' : 'Supplier:'
  const docTitle = isSalesOrder ? 'SALES ORDER' : 'PURCHASE ORDER'
  const docNoLabel = isSalesOrder ? 'SO#:' : 'PO#:'

  const totalQuantity = orderData.order_items?.reduce((sum: number, item: any) => sum + (item.qty || 0), 0) || 0

  // Persisted org media may be a relative storage path or a legacy-host URL;
  // the canonical resolver rebuilds it against the configured storage host.
  const headerOrgLogoUrl = resolveOrganizationLogoUrl(headerOrg?.logo_url)
  const companySignatureUrl = resolveOrganizationLogoUrl(headerOrg?.signature_url)
  const headerOrgInitials = String(headerOrg?.org_name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word: string) => word[0])
    .join('')
    .toUpperCase()

  const waitForDocumentImages = async (timeoutMs = 2500) => {
    const container = printAreaRef.current
    if (!container) return

    const pending = Array.from(container.querySelectorAll('img')).filter(
      (img) => !(img.complete && img.naturalWidth > 0)
    )
    if (pending.length === 0) return

    await Promise.race([
      Promise.all(
        pending.map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true })
              img.addEventListener('error', () => resolve(), { once: true })
            })
        )
      ),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  }

  // Helper to get status color based on payment status
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'text-green-600'
      case 'partial': return 'text-orange-600'
      case 'unpaid': return 'text-red-600'
      case 'approved': return 'text-green-600'
      case 'closed': return 'text-[var(--sera-muted)]'
      case 'cancelled': return 'text-red-600'
      case 'draft': return 'text-[var(--sera-muted)]'
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
                // Trigger browser print dialog once document images are ready
                setTimeout(async () => {
                  await waitForDocumentImages()
                  window.print()
                  // Restore title after a delay to ensure print dialog picked it up
                  setTimeout(() => {
                    document.title = originalTitle
                  }, 2000)
                }, 500)
              }}
              className="gap-2 bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white"
            >
              <FileText className="w-4 h-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>
      </div>



      {/* Static Order View */}
      {/* Document Container - Only show for SO or PO main tabs */}
      <div ref={printAreaRef} className="bg-white shadow-lg p-8 md:p-12 print:shadow-none print:p-8 print:w-full">

        {/* Header Section - 3 Columns in 1 Row */}
        <div className="flex justify-between items-start mb-12 print:mb-6 gap-8">
          {/* Left: Company Logo */}
          <div className="flex-shrink-0 w-40">
            {headerOrgLogoUrl && !logoFailed ? (
              <img
                src={headerOrgLogoUrl}
                alt={headerOrg?.org_name || 'Company logo'}
                className="h-24 max-w-full object-contain object-left-top"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <div className="h-24 flex items-center">
                <div className="w-20 h-20 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center print:bg-white">
                  <span className="text-xl font-bold text-[var(--sera-muted)] tracking-wide">{headerOrgInitials || '?'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Center: Headquarters Detail */}
          <div className="flex-1">
            <h2 className="font-bold text-gray-900 uppercase mb-2 text-sm tracking-wide">
              {headerOrg?.org_name}
            </h2>
            <div className="text-xs text-[var(--sera-muted)] space-y-1 leading-relaxed">
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
                <span className="text-[var(--sera-muted)]">{docNoLabel}</span>
                <span className="font-medium text-gray-900">{orderData.display_doc_no || orderData.order_no}</span>
              </div>
              {orderData.display_doc_no && (
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--sera-muted)]">Legacy#:</span>
                  <span className="font-medium text-gray-400 text-[10px]">{orderData.order_no}</span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-[var(--sera-muted)]">Date:</span>
                <span className="font-medium text-gray-900">{new Date(orderData.created_at).toLocaleDateString('en-MY')}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[var(--sera-muted)]">By:</span>
                <span className="font-medium text-gray-900">{orderData.created_by_user?.full_name || 'Unknown'}</span>
              </div>
              {['D2H', 'S2D', 'DH'].includes(orderData.order_type) && (
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--sera-muted)]">Fulfilled From:</span>
                  <span className="font-medium text-gray-900">
                    {(orderData as any).fulfillment_warehouse_name || 'Legacy / unresolved'}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-[var(--sera-muted)]">Ledger:</span>
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
            <div className="text-xs text-[var(--sera-muted)] space-y-1 leading-relaxed">
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
              <p className="text-xs text-[var(--sera-muted)] mb-1 uppercase tracking-wide">Status</p>
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
                <th className="py-2 text-left text-xs font-bold text-gray-900 print:hidden">Stock configuration</th>
                <th className="py-2 text-right text-xs font-bold text-gray-900 w-24">Unit</th>
                <th className="py-2 text-right text-xs font-bold text-gray-900 w-32">Price</th>
                <th className="py-2 text-right text-xs font-bold text-gray-900 w-32">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orderData.order_items?.map((item: any, index: number) => (
                <tr key={item.id} className="break-inside-avoid page-break-inside-avoid">
                  <td className="py-3 text-xs text-[var(--sera-muted)] align-top pt-4">{index + 1}</td>
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
                  <td className="py-3 pr-3 text-xs text-gray-900 align-top pt-4 print:hidden">
                    {orderData.status === 'submitted' && ['D2H', 'S2D'].includes(orderData.order_type) && ['HQ', 'WH'].includes(userProfile.organizations?.org_type_code) ? (
                      (() => {
                        const options = stockConfigurations.filter(config => config.variant_id === item.variant_id && config.eligible)
                        const selectable = options.filter(config => {
                          const effectiveAvailable = config.available + (config.id === item.stock_config_id ? Number(item.qty || 0) : 0)
                          return effectiveAvailable >= Number(item.qty || 0)
                        })
                        return <div className="min-w-[310px] space-y-2">
                          <div className="font-semibold text-slate-900">Requested: {item.variant?.variant_name || 'Flavour'} · {formatNumber(item.qty)}</div>
                          {options.map(config => {
                            const enough = selectable.some(candidate => candidate.id === config.id)
                            const selected = item.stock_config_id === config.id
                            return <button
                              key={config.id}
                              type="button"
                              disabled={!enough || confirmingItemId === item.id}
                              onClick={() => confirmStockConfiguration(item, config)}
                              className={`block w-full rounded-md border p-2 text-left transition ${selected ? 'border-[var(--sera-orange)] bg-[var(--sera-orange)]/[0.06]' : enough ? 'border-slate-200 bg-white hover:border-blue-300' : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'}`}
                            >
                              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{config.volume_ml ? `${config.volume_ml}ml · ${config.packaging === 'new_box' ? 'New Box' : 'Old Box'}` : 'Standard'}</span><span className={selected ? 'text-blue-700' : 'text-slate-500'}>{selected ? (item.stock_config_confirmed_at ? 'Confirmed' : 'Allocated') : enough ? 'Available' : 'Insufficient'}</span></div>
                              <div className="font-mono text-[11px] text-blue-700">{config.stock_sku}</div>
                              <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-slate-600"><span>On hand {formatNumber(config.onHand)}</span><span>Allocated {formatNumber(config.allocated)}</span><span>Available {formatNumber(config.available)}</span></div>
                              {config.volume_ml === 50 ? <div className="mt-1 text-[11px] text-emerald-700">Distributor eligible for 50ml New Box</div> : null}
                            </button>
                          })}
                          {selectable.length === 0 ? <div className="rounded border border-red-200 bg-red-50 p-2 font-medium text-red-700">Insufficient available stock. Fulfilment is blocked.</div> : null}
                          <div className={item.stock_config_confirmed_at ? 'text-green-700' : 'text-amber-700'}>{item.stock_config_confirmed_at ? 'Exact configuration confirmed for picking' : 'Confirmation required before approval'}</div>
                        </div>
                      })()
                    ) : (
                      <span>{item.stock_config ? `${item.stock_config.stock_sku} · ${item.stock_config.volume_ml ? `${item.stock_config.volume_ml}ml · ${item.stock_config.packaging === 'new_box' ? 'New Box' : 'Old Box'}` : item.stock_config.config_label}` : (item.stock_config_id ? 'Configured stock' : 'Legacy / not assigned')}</span>
                    )}
                  </td>
                  <td className="py-3 text-xs text-gray-900 text-right align-top pt-4">{formatNumber(item.qty)}</td>
                  <td className="py-3 text-xs text-gray-900 text-right align-top pt-4">{formatCurrency(item.unit_price).replace('RM', '')}</td>
                  <td className="py-3 text-xs text-gray-900 text-right align-top pt-4">{formatCurrency(item.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200">
                <td colSpan={3} className="py-4"></td>
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
              {headerOrg?.signature_type === 'electronic' && companySignatureUrl && !companySignatureFailed && (
                <div className="mb-6">
                  <p className="text-sm font-bold text-gray-900 mb-2">Issued by:</p>
                  <div className="flex items-start gap-4">
                    <div className="w-32 h-24 flex items-center">
                      <img
                        src={companySignatureUrl}
                        alt="Company Signature"
                        className="max-w-full max-h-full object-contain"
                        onError={() => setCompanySignatureFailed(true)}
                      />
                    </div>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-8">This is a computer generated document.</p>
            </div>

            {/* Center: Created By */}
            <div className="text-center">
              <p className="text-xs text-[var(--sera-muted)] mb-2">Created by: {orderData.created_by_user?.full_name || 'Unknown'}</p>
              {creatorSignatureUrl && !creatorSignatureFailed ? (
                <div className="flex justify-center mb-2">
                  <img
                    src={creatorSignatureUrl}
                    alt="Created by signature"
                    className="h-16 print:h-12 max-w-[12rem] object-contain"
                    onError={() => setCreatorSignatureFailed(true)}
                  />
                </div>
              ) : (
                <div className="h-16 print:h-12 mb-2 flex items-end justify-center">
                  <span className="text-[10px] italic text-gray-400">Signature not available</span>
                </div>
              )}
              <div className="border-t border-gray-300 w-48 mx-auto pt-1">
                <p className="text-xs text-[var(--sera-muted)]">{orderData.created_at ? new Date(orderData.created_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</p>
              </div>
            </div>

            {/* Right: Approved By */}
            {orderData.approved_by && orderData.approved_by_user && (
              <div className="text-center">
                <p className="text-xs text-[var(--sera-muted)] mb-2">Approved by: {orderData.approved_by_user.full_name || 'Unknown'}</p>
                {approverSignatureUrl && !approverSignatureFailed ? (
                  <div className="flex justify-center mb-2">
                    <img
                      src={approverSignatureUrl}
                      alt="Approved by signature"
                      className="h-16 print:h-12 max-w-[12rem] object-contain"
                      onError={() => setApproverSignatureFailed(true)}
                    />
                  </div>
                ) : (
                  <div className="h-16 print:h-12 mb-2 flex items-end justify-center">
                    <span className="text-[10px] italic text-gray-400">Signature not available</span>
                  </div>
                )}
                <div className="border-t border-gray-300 w-48 mx-auto pt-1">
                  <p className="text-xs text-[var(--sera-muted)]">{orderData.approved_at ? new Date(orderData.approved_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</p>
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
