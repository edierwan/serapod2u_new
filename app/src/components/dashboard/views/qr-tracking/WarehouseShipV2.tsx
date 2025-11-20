'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Scan,
  QrCode,
  CheckCircle,
  Trash2,
  RefreshCw,
  History,
  TrendingUp,
  Box,
  Target,
  Truck,
  AlertTriangle,
  ClipboardPaste,
  Unlink,
  XCircle,
  Search
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string
  organizations: {
    id: string
    org_name: string
    org_type_code: string
  }
}

interface WarehouseShipV2Props {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

interface ShipmentProgress {
  distributor_id: string
  distributor_name: string
  master_cases_scanned: number
  unique_codes_scanned: number
  total_expected_cases?: number
  total_expected_units?: number
  progress_percentage: number
  created_at: string
}

interface PendingUniqueCode {
  code: string
  product_name: string
  variant_name: string
}

interface ScanHistory {
  id: string
  distributor_id: string | null
  distributor_name: string
  master_code: string
  product_name?: string  // NEW: Product name for display
  case_number: number
  actual_unit_count: number
  scanned_at: string
  order_id: string | null
  order_no: string
  status: string  // Code status: 'warehouse_packed' or 'shipped_distributor'
  validation_status?: string  // Session status: 'pending', 'matched', 'approved'
  product_breakdown: Record<string, number>
  pending_master_codes?: string[]
  pending_unique_codes?: PendingUniqueCode[]
}

type ScanCodeType = 'master' | 'unique' | 'unknown'

interface ScannedProduct {
  code: string
  product_name: string
  variant_name: string
  sequence_number: number
  status: 'success' | 'duplicate' | 'error'
  error_message?: string
  code_type: ScanCodeType
}

export default function WarehouseShipV2({ userProfile }: WarehouseShipV2Props) {
  const [scannedCodes, setScannedCodes] = useState<ScannedProduct[]>([])
  const [qrInput, setQrInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const [selectedDistributor, setSelectedDistributor] = useState<string>('')
  const [distributors, setDistributors] = useState<any[]>([])
  const [shipmentProgress, setShipmentProgress] = useState<ShipmentProgress | null>(null)
  const [distributorHistory, setDistributorHistory] = useState<ScanHistory[]>([])
  const [overallHistory, setOverallHistory] = useState<ScanHistory[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [showBatchInput, setShowBatchInput] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [batchProcessingActive, setBatchProcessingActive] = useState(false)
  const [batchProcessingProgress, setBatchProcessingProgress] = useState(0)
  const [batchProcessingStatus, setBatchProcessingStatus] = useState('')
  const [batchProcessingSummary, setBatchProcessingSummary] = useState({ total: 0, success: 0, duplicates: 0, errors: 0 })
  const [confirming, setConfirming] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const [sessionQuantities, setSessionQuantities] = useState({
    total_units: 0,
    total_cases: 0,
    per_variant: {} as Record<string, { units: number; cases: number }>
  })
  
  // Manual stock state
  const [selectedVariant, setSelectedVariant] = useState<string>('')
  const [variants, setVariants] = useState<any[]>([])
  const [variantsWithStock, setVariantsWithStock] = useState<any[]>([])
  const [variantSearchTerm, setVariantSearchTerm] = useState<string>('')
  const [manualStockBalance, setManualStockBalance] = useState<number>(0)
  const [manualQty, setManualQty] = useState<number>(0)
  const [loadingManualStock, setLoadingManualStock] = useState(false)
  const [loadingVariants, setLoadingVariants] = useState(false)
  
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    loadDistributors()
    loadVariants()
    loadScanHistory()
  }, [])

  useEffect(() => {
    if (selectedDistributor) {
      createOrLoadSession(selectedDistributor)
      loadScanHistory()
      loadVariants() // Refresh variants when distributor changes
    } else {
      setSessionId(null)
      setShipmentProgress(null)
      setDistributorHistory([])
      setScannedCodes([])
      setSessionQuantities({ total_units: 0, total_cases: 0, per_variant: {} })
    }
  }, [selectedDistributor])

  useEffect(() => {
    if (selectedDistributor) {
      setDistributorHistory(overallHistory.filter(item => item.distributor_id === selectedDistributor))
    } else {
      setDistributorHistory([])
    }
  }, [overallHistory, selectedDistributor])

  useEffect(() => {
    if (selectedVariant) {
      loadManualStockBalance(selectedVariant)
    } else {
      setManualStockBalance(0)
      setManualQty(0)
    }
  }, [selectedVariant])

  const loadDistributors = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_name, org_type_code')
        .eq('org_type_code', 'DIST')
        .eq('is_active', true)
        .order('org_name', { ascending: true })

      if (error) throw error
      setDistributors(data || [])
    } catch (error: any) {
      console.error('Error loading distributors:', error)
      toast({
        title: 'Error',
        description: 'Failed to load distributors',
        variant: 'destructive'
      })
    }
  }

  const loadVariants = async () => {
    try {
      setLoadingVariants(true)
      
      // Get variants with manual stock balance for this warehouse
      const { data: stockData, error: stockError } = await supabase
        .from('vw_manual_stock_balance')
        .select(`
          variant_id,
          manual_balance_qty,
          product_variants (
            id,
            variant_code,
            variant_name,
            products (
              product_name
            )
          )
        `)
        .eq('warehouse_id', userProfile.organization_id)
        .gt('manual_balance_qty', 0)
        .order('manual_balance_qty', { ascending: false })

      if (stockError) throw stockError
      
      // Transform data to include balance info
      const variantsData = (stockData || []).map(item => {
        const variant = item.product_variants
        return {
          ...variant,
          manual_balance_qty: item.manual_balance_qty
        }
      }).filter(v => v.id) // Filter out any null variants
      
      setVariantsWithStock(variantsData)
      setVariants(variantsData)
    } catch (error: any) {
      console.error('Error loading variants:', error)
      toast({
        title: 'Error',
        description: 'Failed to load product variants with stock',
        variant: 'destructive'
      })
    } finally {
      setLoadingVariants(false)
    }
  }

  const loadManualStockBalance = async (variantId: string) => {
    if (!variantId) {
      setManualStockBalance(0)
      return
    }

    try {
      setLoadingManualStock(true)
      const { data, error } = await supabase
        .from('vw_manual_stock_balance')
        .select('manual_balance_qty')
        .eq('warehouse_id', userProfile.organization_id)
        .eq('variant_id', variantId)
        .maybeSingle()

      if (error) throw error
      
      setManualStockBalance(data?.manual_balance_qty || 0)
    } catch (error: any) {
      console.error('Error loading manual stock balance:', error)
      setManualStockBalance(0)
    } finally {
      setLoadingManualStock(false)
    }
  }

  const createOrLoadSession = async (distributorId: string) => {
    try {
      console.log('🔍 Creating or loading session for distributor:', distributorId)

      // Check for existing session (pending or matched status means warehouse_packed items ready to ship)
      const { data: existingSession, error: sessionError } = await supabase
        .from('qr_validation_reports')
        .select('id, scanned_quantities, master_codes_scanned, unique_codes_scanned, distributor_org_id, validation_status')
        .eq('warehouse_org_id', userProfile.organization_id)
        .eq('distributor_org_id', distributorId)
        .in('validation_status', ['pending', 'matched'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (sessionError) {
        console.error('Error checking existing session:', sessionError)
      }

      console.log('📋 Existing session:', existingSession?.id || 'None')

      if (existingSession) {
        console.log('✅ Loading existing session with codes:', {
          master: existingSession.master_codes_scanned?.length || 0,
          unique: existingSession.unique_codes_scanned?.length || 0
        })
        setSessionId(existingSession.id)
        await loadProgressFromSession(existingSession)
        return
      }

      // No pending session found - create a new empty one
      const distributor = distributors.find(d => d.id === distributorId)
      
      console.log('📝 Creating new session for distributor:', distributor?.org_name)
      
      // ============================================================================
      // SCENARIO 1 vs SCENARIO 2: Phone Order vs D2H Order
      // ============================================================================
      // Check if there are any D2H orders (Distributor to HQ) for this distributor
      // that have been approved and have inventory at warehouse ready to ship
      
      let expectedQuantities = {
        total_units: 0,
        total_cases: 0,
        per_variant: {},
        source_order_id: null as string | null,
        scenario: 'phone_order' as 'phone_order' | 'd2h_order'
      }

      console.log('🔍 Checking for D2H orders from distributor:', distributorId)
      
      const { data: d2hOrders, error: orderError } = await supabase
        .from('orders')
        .select(`
          id,
          order_no,
          order_type,
          status,
          order_items (
            id,
            qty,
            variant_id,
            product:products (
              product_name
            ),
            variant:product_variants (
              variant_code,
              variant_name
            )
          )
        `)
        .eq('order_type', 'D2H')
        .eq('buyer_org_id', distributorId)
        .eq('seller_org_id', userProfile.organization_id)
        .in('status', ['approved', 'closed'])
        .order('created_at', { ascending: false })
        .limit(5)

      if (orderError) {
        console.warn('⚠️  Could not check for D2H orders:', orderError)
      }

      console.log(`📊 Found ${d2hOrders?.length || 0} D2H orders`)

      if (d2hOrders && d2hOrders.length > 0) {
        // SCENARIO 2: D2H Order exists - calculate expected quantities from order
        console.log('✅ SCENARIO 2: D2H Order flow - System knows expected quantities')
        
        // Use the most recent approved order
        const sourceOrder = d2hOrders[0]
        const orderItems = sourceOrder.order_items || []
        
        let totalUnits = 0
        const perVariant: any = {}
        
        orderItems.forEach((item: any) => {
          totalUnits += item.qty
          const variantKey = item.variant_id
          
          if (!perVariant[variantKey]) {
            perVariant[variantKey] = {
              variant_id: item.variant_id,
              variant_code: item.variant?.variant_code || 'N/A',
              variant_name: item.variant?.variant_name || item.product?.product_name || 'Unknown',
              expected_qty: 0
            }
          }
          perVariant[variantKey].expected_qty += item.qty
        })
        
        expectedQuantities = {
          total_units: totalUnits,
          total_cases: 0, // Will be calculated as codes are scanned
          per_variant: perVariant,
          source_order_id: sourceOrder.id,
          scenario: 'd2h_order'
        }
        
        console.log('📦 Expected quantities from D2H order:', {
          order_no: sourceOrder.order_no,
          total_units: totalUnits,
          variants: Object.keys(perVariant).length
        })
      } else {
        // SCENARIO 1: Phone Order - no system record
        console.log('📞 SCENARIO 1: Phone order flow - Expected quantities unknown (will scan freely)')
        expectedQuantities = {
          total_units: 0,
          total_cases: 0,
          per_variant: {},
          source_order_id: null,
          scenario: 'phone_order'
        }
      }
      
      // Create session with appropriate expected quantities
      const { data: newSession, error: createError } = await supabase
        .from('qr_validation_reports')
        .insert({
          company_id: userProfile.organizations?.id || userProfile.organization_id,
          warehouse_org_id: userProfile.organization_id,
          distributor_org_id: distributorId,
          source_order_id: expectedQuantities.source_order_id,
          validation_status: 'pending',
          created_by: userProfile.id,
          master_codes_scanned: [],
          unique_codes_scanned: [],
          expected_quantities: {
            total_units: expectedQuantities.total_units,
            total_cases: expectedQuantities.total_cases,
            per_variant: expectedQuantities.per_variant,
            scenario: expectedQuantities.scenario
          },
          scanned_quantities: {
            total_units: 0,
            total_cases: 0,
            per_variant: {}
          }
        })
        .select()
        .single()

      if (createError) {
        console.error('Error creating session:', createError)
        toast({
          title: 'Error',
          description: 'Failed to create shipment session',
          variant: 'destructive'
        })
        return
      }

      console.log('✅ Session created:', newSession.id)
      
      setSessionId(newSession.id)
      setSessionQuantities({ total_units: 0, total_cases: 0, per_variant: {} })
      setShipmentProgress({
        distributor_id: distributorId,
        distributor_name: distributor?.org_name || 'Unknown',
        master_cases_scanned: 0,
        unique_codes_scanned: 0,
        progress_percentage: 0,
        created_at: newSession.created_at || new Date().toISOString()
      })
    } catch (error: any) {
      console.error('Error in createOrLoadSession:', error)
      toast({
        title: 'Error',
        description: 'Failed to initialize shipment session',
        variant: 'destructive'
      })
    }
  }

  const loadProgressFromSession = async (session: any) => {
    const scannedQty = session.scanned_quantities || {}
    const masterCodes = Array.isArray(session.master_codes_scanned) ? session.master_codes_scanned : []
    const uniqueCodes = Array.isArray(session.unique_codes_scanned) ? session.unique_codes_scanned : []
    
    setSessionQuantities({
      total_units: scannedQty.total_units || 0,
      total_cases: scannedQty.total_cases || 0,
      per_variant: scannedQty.per_variant || {}
    })

    const distributor = distributors.find(d => d.id === session.distributor_org_id)
    
    setShipmentProgress({
      distributor_id: session.distributor_org_id,
      distributor_name: distributor?.org_name || 'Unknown',
      master_cases_scanned: masterCodes.length,
      unique_codes_scanned: uniqueCodes.length,
      progress_percentage: 0,
      created_at: session.created_at
    })

    // Load the actual scanned codes with product info to display in Current Ship Progress
    const allCodes = [...masterCodes, ...uniqueCodes]
    if (allCodes.length > 0) {
      await loadExistingScannedCodes(allCodes)
    } else {
      // No codes in session - clear the scanned codes list
      setScannedCodes([])
    }
  }

  const loadExistingScannedCodes = async (codes: string[]) => {
    try {
      console.log('📦 Loading existing scanned codes from session:', codes.length)
      console.log('📝 Sample codes:', codes.slice(0, 3))
      
      // Query QR codes to get product information
      const { data: qrCodes, error } = await supabase
        .from('qr_codes')
        .select(`
          code,
          status,
          master_code_id,
          product_variants (
            variant_name,
            products (
              product_name
            )
          )
        `)
        .in('code', codes)

      console.log('🔍 Query result:', { found: qrCodes?.length || 0, error: error?.message })

      if (error) {
        console.error('❌ Error loading existing codes:', error)
        return
      }

      const qrCodesSafe = qrCodes || []

      if (qrCodesSafe.length === 0) {
        console.warn('⚠️ No QR codes found for the provided codes from session (might be master cases only)')
      }

      // Filter for warehouse_packed status
      const packedCodes = qrCodesSafe.filter(qr => qr.status === 'warehouse_packed')
      console.log('📊 Status breakdown:', {
        total: qrCodes.length,
        warehouse_packed: packedCodes.length,
        other: qrCodes.length - packedCodes.length
      })

      // Transform to ScannedProduct format (only warehouse_packed codes)
      const scannedProducts: ScannedProduct[] = packedCodes.map((qr, index) => {
        const variant = Array.isArray(qr.product_variants) ? qr.product_variants[0] : qr.product_variants
        const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
        
        return {
          code: qr.code,
          product_name: product?.product_name || 'Unknown',
          variant_name: variant?.variant_name || 'Unknown',
          sequence_number: index + 1,
          status: 'success' as const,
          code_type: 'unique'
        }
      })

      const foundCodes = new Set(packedCodes.map(qr => qr.code))
      const missingCodes = codes.filter(code => !foundCodes.has(code))

      if (missingCodes.length > 0) {
        console.log('📦 Loading master codes missing from qr_codes query:', missingCodes)
        const { data: masterRecords, error: masterError } = await supabase
          .from('qr_master_codes')
          .select('master_code, status')
          .in('master_code', missingCodes)

        if (masterError) {
          console.warn('⚠️ Could not load master codes:', masterError)
        } else {
          masterRecords
            ?.filter(master => master.status === 'warehouse_packed')
            .forEach(master => {
              scannedProducts.push({
                code: master.master_code,
                product_name: master.master_code,
                variant_name: 'Master Case',
                sequence_number: scannedProducts.length + 1,
                status: 'success',
                code_type: 'master'
              })
            })
        }
      }

      console.log('✅ Loaded and displaying', scannedProducts.length, 'warehouse_packed codes')
      console.log('📦 Sample product:', scannedProducts[0])
      if (scannedProducts.length === 0) {
        console.warn('⚠️ No warehouse_packed codes found - they may have already been shipped')
        toast({
          title: 'Information',
          description: 'These items may have already been shipped. Check the shipment history.',
          variant: 'default'
        })
        return
      }

      setScannedCodes(scannedProducts)
    } catch (error: any) {
      console.error('❌ Error loading existing scanned codes:', error)
    }
  }

  const loadScanHistory = async () => {
    try {
      console.log('🔍 Loading warehouse scan history')
      
      const response = await fetch('/api/warehouse/scan-history')
      
      if (!response.ok) {
        throw new Error(`Failed to load scan history: ${response.status}`)
      }

      const result = await response.json()
      
      console.log('📊 Scan history API result:', { 
        success: result.success, 
        count: result.count 
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to load scan history')
      }

      const history: ScanHistory[] = (result.history || []).map((item: any) => ({
        id: item.id,
        distributor_id: item.distributor_id || '',
        distributor_name: item.distributor_name || 'Unknown',
        master_code: item.master_code,
        product_name: item.product_name,  // NEW: Product name from API
        case_number: item.case_number,
        actual_unit_count: item.actual_unit_count,
        scanned_at: item.scanned_at,
        order_id: item.order_id || null,
        order_no: item.order_no || 'Unknown',
        status: item.status || 'warehouse_packed',
        validation_status: item.validation_status,  // Session validation status
        product_breakdown: item.product_breakdown || {},
        pending_master_codes: item.pending_master_codes || [],
        pending_unique_codes: item.pending_unique_codes || []
      }))

      console.log('✅ Scan history loaded:', history.length, 'records')
      setOverallHistory(history)
      setDistributorHistory(selectedDistributor ? history.filter((item) => item.distributor_id === selectedDistributor) : [])
    } catch (error: any) {
      console.error('❌ Error loading scan history:', error)
      setOverallHistory([])
      setDistributorHistory([])
    }
  }

  const handleScanCode = async () => {
    if (!selectedDistributor || !sessionId) {
      toast({
        title: 'Error',
        description: 'Please select a distributor first',
        variant: 'destructive'
      })
      return
    }

    if (!qrInput.trim()) {
      toast({
        title: 'Error',
        description: 'Please scan or enter a QR code',
        variant: 'destructive'
      })
      return
    }

    try {
      setScanning(true)

      const response = await fetch('/api/warehouse/scan-for-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_session_id: sessionId,
          code: qrInput.trim(),
          // code_type removed - let API auto-detect based on QR code pattern
          user_id: userProfile.id
        })
      })

      const result = await response.json()

      if (!response.ok) {
        if (result.outcome === 'duplicate') {
          toast({
            title: 'Warning',
            description: result.message || 'This code has already been scanned',
          })
          setQrInput('')
          return
        }
        throw new Error(result.message || 'Failed to scan QR code')
      }

      if (result.outcome === 'shipped') {
        // Extract product info from result
        const productInfo: ScannedProduct = {
          code: result.normalized_code,
          product_name: result.product_info?.product_name || result.master_case?.master_code || result.normalized_code,
          variant_name: result.product_info?.variant_name || (result.code_type === 'master' ? 'Master Case' : 'Unit'),
          sequence_number: scannedCodes.length + 1,
          status: 'success',
          code_type: result.code_type === 'master' ? 'master' : 'unique'
        }
        
        setScannedCodes(prev => [...prev, productInfo])
        setQrInput('')
        
        toast({
          title: 'Success',
          description: result.message,
        })

        // Update progress
        if (result.session_update) {
          const masterCount = result.session_update.master_codes_scanned?.length || 0
          const uniqueCount = result.session_update.unique_codes_scanned?.length || 0
          const distributor = distributors.find(d => d.id === selectedDistributor)
          
          setShipmentProgress({
            distributor_id: selectedDistributor,
            distributor_name: distributor?.org_name || 'Unknown',
            master_cases_scanned: masterCount,
            unique_codes_scanned: uniqueCount,
            progress_percentage: 0,
            created_at: new Date().toISOString()
          })

          if (result.session_update.scanned_quantities) {
            const quantities = result.session_update.scanned_quantities
            setSessionQuantities({
              total_units: quantities.total_units || 0,
              total_cases: quantities.total_cases || 0,
              per_variant: quantities.per_variant || {}
            })
          }
        }

        loadScanHistory()
      } else {
        toast({
          title: result.outcome === 'already_shipped' ? 'Warning' : 'Error',
          description: result.message,
          variant: result.outcome === 'already_shipped' ? 'default' : 'destructive'
        })
        setQrInput('')
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setScanning(false)
    }
  }

  const handleBatchPaste = async () => {
    if (!batchInput.trim()) {
      toast({
        title: 'Error',
        description: 'Please paste QR codes in the batch input field',
        variant: 'destructive'
      })
      return
    }

    if (!selectedDistributor || !sessionId) {
      toast({
        title: 'Error',
        description: 'Please select a distributor first',
        variant: 'destructive'
      })
      return
    }

    const codes = batchInput
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)

    if (codes.length === 0) {
      toast({
        title: 'Error',
        description: 'No valid QR codes found',
        variant: 'destructive'
      })
      return
    }

    setBatchProcessingActive(true)
    setBatchProcessingProgress(0)
    setBatchProcessingStatus('Preparing batch scan...')
    setBatchProcessingSummary({ total: codes.length, success: 0, duplicates: 0, errors: 0 })

    let successCount = 0
    let duplicateCount = 0
    let errorCount = 0
    let latestTotal = codes.length
    const newScannedCodes: ScannedProduct[] = []

    try {
      const response = await fetch('/api/warehouse/scan-batch-for-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_session_id: sessionId,
          codes,
          user_id: userProfile.id
        })
      })

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null)
        throw new Error(errorPayload?.message || 'Failed to process batch scan')
      }

      if (!response.body) {
        throw new Error('Server returned an empty response stream')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalSummary: { total: number; success: number; duplicates: number; errors: number } | null = null

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          newlineIndex = buffer.indexOf('\n')

          if (!line) continue

          const event = JSON.parse(line)

          if (event.type === 'progress') {
            const { index, total, result } = event
            latestTotal = total || latestTotal

            setBatchProcessingStatus(`Scanning code ${index} of ${total}`)
            setBatchProcessingProgress(Math.round((index / total) * 100))

            const normalizedCode: string = result.normalized_code || codes[index - 1] || ''
            const sequenceNumber = index

            if (result.outcome === 'shipped') {
              successCount++

              newScannedCodes.push({
                code: normalizedCode,
                product_name: result.product_info?.product_name || result.master_case?.master_code || normalizedCode,
                variant_name: result.product_info?.variant_name || (result.code_type === 'master' ? 'Master Case' : 'Unit'),
                sequence_number: sequenceNumber,
                status: 'success',
                code_type: result.code_type === 'master' ? 'master' : 'unique'
              })

              if (result.session_update) {
                const masterCount = result.session_update.master_codes_scanned?.length || 0
                const uniqueCount = result.session_update.unique_codes_scanned?.length || 0
                const distributor = distributors.find(d => d.id === selectedDistributor)

                setShipmentProgress({
                  distributor_id: selectedDistributor,
                  distributor_name: distributor?.org_name || 'Unknown',
                  master_cases_scanned: masterCount,
                  unique_codes_scanned: uniqueCount,
                  progress_percentage: 0,
                  created_at: new Date().toISOString()
                })

                if (result.session_update.scanned_quantities) {
                  const quantities = result.session_update.scanned_quantities
                  setSessionQuantities({
                    total_units: quantities.total_units || 0,
                    total_cases: quantities.total_cases || 0,
                    per_variant: quantities.per_variant || {}
                  })
                }
              }
            } else if (result.outcome === 'duplicate') {
              duplicateCount++
              newScannedCodes.push({
                code: normalizedCode,
                product_name: normalizedCode,
                variant_name: 'Duplicate',
                sequence_number: sequenceNumber,
                status: 'duplicate',
                error_message: result.message || 'This code has already been scanned in this session',
                code_type: 'unknown'
              })
            } else {
              errorCount++
              newScannedCodes.push({
                code: normalizedCode,
                product_name: normalizedCode,
                variant_name: 'Error',
                sequence_number: sequenceNumber,
                status: 'error',
                error_message: result.message || 'Failed to scan QR code',
                code_type: 'unknown'
              })
            }

            setBatchProcessingSummary({
              total: latestTotal,
              success: successCount,
              duplicates: duplicateCount,
              errors: errorCount
            })
          } else if (event.type === 'complete') {
            finalSummary = event.summary
            if (finalSummary) {
              successCount = finalSummary.success
              duplicateCount = finalSummary.duplicates
              errorCount = finalSummary.errors
              latestTotal = finalSummary.total
              setBatchProcessingSummary(finalSummary)
            }
          } else if (event.type === 'error') {
            throw new Error(event.message || 'Batch processing failed')
          }
        }
      }

      setScannedCodes(prev => [...prev, ...newScannedCodes])

      setBatchProcessingStatus('Batch processing complete!')
      setBatchProcessingProgress(100)

      setTimeout(() => {
        setBatchProcessingActive(false)
        setBatchInput('')
        setShowBatchInput(false)
        loadScanHistory()

        const summary = finalSummary || {
          total: latestTotal,
          success: successCount,
          duplicates: duplicateCount,
          errors: errorCount
        }

        toast({
          title: 'Batch Scan Complete',
          description: `Processed ${summary.total} codes: ${summary.success} success, ${summary.duplicates} duplicates, ${summary.errors} errors`,
        })
      }, 800)
    } catch (error: any) {
      console.error('❌ Batch scan failed:', error)
      setBatchProcessingStatus('Batch processing failed')
      setBatchProcessingProgress(0)
      setBatchProcessingSummary(prev => ({ ...prev, success: successCount, duplicates: duplicateCount, errors: errorCount }))

      toast({
        title: 'Batch Scan Failed',
        description: error.message || 'Unable to complete batch scan',
        variant: 'destructive'
      })

      setTimeout(() => {
        setBatchProcessingActive(false)
      }, 800)
    }
  }

  const handleRemoveCode = (index: number) => {
    setScannedCodes(prev => prev.filter((_, i) => i !== index))
    toast({
      title: 'Removed',
      description: 'QR code removed from session',
    })
  }

  const handleUnlinkCode = async (code: string, codeType: 'master' | 'unique') => {
    if (!sessionId) return

    try {
      setUnlinking(code)

      const response = await fetch('/api/warehouse/unlink-shipment-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          session_id: sessionId,
          code_type: codeType,
          user_id: userProfile.id
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to unlink code')
      }

      toast({
        title: 'Success',
        description: result.message,
      })

      // Remove from scanned codes list immediately for responsive UI
      setScannedCodes(prev => prev.filter(c => c.code !== code))

      // Update session state directly from API response (faster than requery)
      if (result.session_update) {
        const masterCount = result.session_update.master_codes_scanned?.length || 0
        const uniqueCount = result.session_update.unique_codes_scanned?.length || 0
        const distributor = distributors.find(d => d.id === selectedDistributor)
        
        setShipmentProgress({
          distributor_id: selectedDistributor || '',
          distributor_name: distributor?.org_name || 'Unknown',
          master_cases_scanned: masterCount,
          unique_codes_scanned: uniqueCount,
          progress_percentage: 0,
          created_at: new Date().toISOString()
        })

        if (result.session_update.scanned_quantities) {
          const quantities = result.session_update.scanned_quantities
          setSessionQuantities({
            total_units: quantities.total_units || 0,
            total_cases: quantities.total_cases || 0,
            per_variant: quantities.per_variant || {}
          })
        }
      }

      // Reload session to get updated counts and progress (as backup/verification)
      if (selectedDistributor) {
        await createOrLoadSession(selectedDistributor)
      }
      
      // Reload scan history
      await loadScanHistory()

    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setUnlinking(null)
    }
  }

  const handleUnlinkProduct = async (sessionIds: string[], productName: string) => {
    if (!sessionIds || sessionIds.length === 0) return

    if (!confirm(`Unlink all "${productName}" units from these shipments? This will change their status back to received_warehouse.`)) {
      return
    }

    try {
      setUnlinking(productName)

      // Call API to unlink all sessions with this product
      const response = await fetch('/api/warehouse/unlink-product-from-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_ids: sessionIds,
          product_name: productName,
          user_id: userProfile.id
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to unlink product')
      }

      toast({
        title: 'Success',
        description: result.message || `Unlinked ${productName} from shipments`,
      })

      // Reload history
      loadScanHistory()

    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setUnlinking(null)
    }
  }

  const handleCancelShipment = async () => {
    if (!sessionId) {
      toast({
        title: 'Error',
        description: 'No active shipment session to cancel',
        variant: 'destructive'
      })
      return
    }

    const itemCount = masterCasesCount + looseItemsCount + manualQty
    const confirmMsg = `Cancel this shipment and reset ${itemCount} item${itemCount === 1 ? '' : 's'} back to warehouse_packed status?`
    
    if (!confirm(confirmMsg)) {
      return
    }

    try {
      setCanceling(true)

      const response = await fetch('/api/warehouse/cancel-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          user_id: userProfile.id
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to cancel shipment')
      }

      toast({
        title: 'Success',
        description: result.message || 'Shipment cancelled successfully',
      })

      // Clear all state
      setScannedCodes([])
      setManualQty(0)
      setSessionId(null)
      setShipmentProgress(null)
      setSessionQuantities({ total_units: 0, total_cases: 0, per_variant: {} })

      // Reload manual stock balance if variant selected
      if (selectedVariant) {
        await loadManualStockBalance(selectedVariant)
      }

      // Create fresh session
      if (selectedDistributor) {
        await createOrLoadSession(selectedDistributor)
      }

      await loadScanHistory()

    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to cancel shipment',
        variant: 'destructive'
      })
    } finally {
      setCanceling(false)
    }
  }

  const handleConfirmShipment = async () => {
    if (!selectedDistributor) {
      toast({
        title: 'Error',
        description: 'No distributor selected',
        variant: 'destructive'
      })
      return
    }

    // Check if we have at least one of: QR codes or manual qty
    const hasQrCodes = scannedCodes.filter(c => c.status === 'success').length > 0
    const hasManualQty = manualQty > 0

    if (!hasQrCodes && !hasManualQty) {
      toast({
        title: 'Error',
        description: 'Please scan QR codes or enter manual quantity',
        variant: 'destructive'
      })
      return
    }

    // Ensure we have an active session for QR codes
    if (hasQrCodes && !sessionId) {
      toast({
        title: 'Session Required',
        description: 'No active shipment session. Please reselect the distributor.',
        variant: 'destructive'
      })
      // Try to recreate session
      await createOrLoadSession(selectedDistributor)
      return
    }

    // Validate manual qty doesn't exceed balance
    if (manualQty > manualStockBalance) {
      toast({
        title: 'Error',
        description: `Manual quantity (${manualQty}) exceeds available balance (${manualStockBalance})`,
        variant: 'destructive'
      })
      return
    }

    // Validate variant is selected if manual qty > 0
    if (manualQty > 0 && !selectedVariant) {
      toast({
        title: 'Error',
        description: 'Please select a product variant for manual stock',
        variant: 'destructive'
      })
      return
    }

    const qrUnitsToShip = looseItemsCount
    const totalUnitsToShip = qrUnitsToShip + manualQty
    const confirmBreakdownParts = [
      masterCasesCount > 0 ? `${masterCasesCount} master case${masterCasesCount === 1 ? '' : 's'}` : null,
      qrUnitsToShip > 0 ? `${qrUnitsToShip} QR unit${qrUnitsToShip === 1 ? '' : 's'}` : null,
      manualQty > 0 ? `${manualQty} manual unit${manualQty === 1 ? '' : 's'}` : null
    ].filter(Boolean)
    const confirmMsg = `Confirm shipment of ${totalUnitsToShip} unit${totalUnitsToShip === 1 ? '' : 's'}${confirmBreakdownParts.length ? ` (${confirmBreakdownParts.join(' + ')})` : ''}?`
    
    if (!confirm(confirmMsg)) {
      return
    }

    let manualMovementId: string | null = null

    try {
      setConfirming(true)

      // Prepare QR codes (only successful ones)
      const qrCodes = scannedCodes
        .filter(c => c.status === 'success')
        .map(c => c.code)

      // Generate reference number
      const timestamp = Date.now().toString(36).toUpperCase()
      const referenceNo = `MIX-${timestamp}`

      let qrShippedCount = 0
      let masterCasesShipped = 0
      let manualShippedCount = 0

      // Step 1: Process manual stock first so we can roll back cleanly if later steps fail
      if (manualQty > 0) {
        console.log('📦 Processing manual stock shipment...', manualQty)

        const { data: manualResult, error: manualError } = await supabase.rpc('wms_ship_mixed', {
          p_company_id: userProfile.organizations?.id || userProfile.organization_id,
          p_warehouse_id: userProfile.organization_id,
          p_distributor_id: selectedDistributor,
          p_variant_id: selectedVariant || '',
          p_manual_qty: manualQty || 0,
          p_qr_codes: null,
          p_user_id: userProfile.id,
          p_reference_no: referenceNo,
          p_notes: `Mixed shipment: ${qrCodes.length} QR codes + ${manualQty} manual units`
        })

        if (manualError) {
          throw new Error(manualError.message || 'Failed to process manual shipment')
        }

        const manualResultData = manualResult as { manual_movement_id?: string; manual_quantity?: number } | null
        manualMovementId = manualResultData?.manual_movement_id ?? null
        manualShippedCount = manualResultData?.manual_quantity ?? manualQty

        console.log('✅ Manual stock shipment processed', manualResult)
      }

      // Step 2: Confirm QR shipment via dedicated API (handles movement + inventory)
      if (qrCodes.length > 0) {
        if (!sessionId) {
          throw new Error('Active shipment session not found. Please reselect the distributor and try again.')
        }

        console.log('📦 Confirming QR shipment via API…', { sessionId, qrCount: qrCodes.length })

        const response = await fetch('/api/warehouse/confirm-shipment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            user_id: userProfile.id
          })
        })

        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'Failed to confirm QR shipment')
        }

        qrShippedCount = result.details?.unique_codes_shipped ?? qrCodes.length
        masterCasesShipped = result.details?.master_cases_shipped ?? 0

        console.log('✅ QR shipment confirmed via API', result.details)
        // Manual succeeded and QR succeeded, no rollback needed
        manualMovementId = null
      }

      manualMovementId = null

      const breakdownParts = [
        masterCasesShipped > 0 ? `${masterCasesShipped} master case${masterCasesShipped === 1 ? '' : 's'}` : null,
        qrShippedCount > 0 ? `${qrShippedCount} QR unit${qrShippedCount === 1 ? '' : 's'}` : null,
        manualShippedCount > 0 ? `${manualShippedCount} manual unit${manualShippedCount === 1 ? '' : 's'}` : null
      ].filter(Boolean)

      const totalUnitsShipped = qrShippedCount + manualShippedCount

      toast({
        title: 'Success',
        description: `Shipment confirmed! ${totalUnitsShipped} unit${totalUnitsShipped === 1 ? '' : 's'} shipped${breakdownParts.length ? ` (${breakdownParts.join(' + ')})` : ''}.`,
      })

      // Clear current session completely - force new session creation
      setSessionId(null)
      setScannedCodes([])
      setManualQty(0)
      setShipmentProgress(null)
  setSessionQuantities({ total_units: 0, total_cases: 0, per_variant: {} })

      if (selectedVariant) {
        await loadManualStockBalance(selectedVariant)
      } else {
        setManualStockBalance(0)
      }

      // Create a fresh session for the next shipment
      if (selectedDistributor) {
        await createOrLoadSession(selectedDistributor)
      }

      await loadScanHistory()

    } catch (error: any) {
      console.error('Shipment error:', error)

      if (manualMovementId) {
        console.warn('♻️ Attempting to roll back manual shipment', manualMovementId)
        try {
          await supabase.rpc('wms_reverse_manual_movement', {
            p_movement_id: manualMovementId,
            p_reversal_reason: `Mixed shipment rollback: ${error.message ?? 'unknown error'}`,
            p_override_user: userProfile.id
          })
          console.log('♻️ Manual shipment rollback succeeded')
        } catch (rollbackError) {
          console.error('⚠️ Failed to roll back manual shipment', rollbackError)
        }
      }

      toast({
        title: 'Error',
        description: error.message || 'Failed to confirm shipment',
        variant: 'destructive'
      })
    } finally {
      setConfirming(false)
    }
  }

  const renderStatusBadge = (status?: string) => {
    switch (status) {
      case 'warehouse_packed':
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-900 border-blue-200">
            Warehouse Packed
          </Badge>
        )
      case 'shipped_distributor':
      case 'shipped':
        return (
          <Badge variant="default" className="bg-green-600">
            <CheckCircle className="h-3 w-3 mr-1" />
            Shipped
          </Badge>
        )
      case 'received_distributor':
      case 'received':
        return (
          <Badge variant="default" className="bg-purple-600">
            Received by Distributor
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary" className="uppercase text-xs">
            {status?.replace(/_/g, ' ') || 'Unknown'}
          </Badge>
        )
    }
  }

  const progressPercent = shipmentProgress ? Math.min(100, Math.max(0, shipmentProgress.progress_percentage || 0)) : 0

  // Calculate enhanced summary from scanned codes
  const scanSummary = scannedCodes.reduce((acc, code) => {
    if (code.status === 'success') {
      acc.successCount++
      if (code.code_type === 'master') {
        acc.masterCases++
        // For master cases, also track variant if we have product info
        if (code.product_name && code.variant_name && code.variant_name !== 'Master Case') {
          const variantKey = `${code.product_name} - ${code.variant_name}`
          acc.variants[variantKey] = (acc.variants[variantKey] || 0) + 1
        }
      } else if (code.code_type === 'unique') {
        acc.uniqueCodes++
        // Track variants by full product name
        const variantKey = `${code.product_name} - ${code.variant_name}`
        acc.variants[variantKey] = (acc.variants[variantKey] || 0) + 1
      }
    } else if (code.status === 'duplicate') {
      acc.duplicateCount++
    } else if (code.status === 'error') {
      acc.errorCount++
    }
    return acc
  }, {
    successCount: 0,
    masterCases: 0,
    uniqueCodes: 0,
    duplicateCount: 0,
    errorCount: 0,
    variants: {} as Record<string, number>
  })

  // Count master cases from shipmentProgress (which uses masterCodes.length from session)
  // This ensures we show "1 master case" when 1 master QR code is scanned, not "50" (the units inside)
  // Don't use sessionQuantities.total_cases as it might have been calculated incorrectly in old code
  const masterCasesCount = shipmentProgress?.master_cases_scanned || scanSummary.masterCases || 0
  
  // Use session quantities for loose items (individual units)
  const looseItemsCount = shipmentProgress?.unique_codes_scanned || sessionQuantities.total_units || scanSummary.uniqueCodes
  
  // Count variants from session quantities (more accurate for masters) or scan summary
  let variantCount = 0
  if (sessionQuantities.per_variant && Object.keys(sessionQuantities.per_variant).length > 0) {
    variantCount = Object.keys(sessionQuantities.per_variant).length
  } else {
    variantCount = Object.keys(scanSummary.variants).length
  }
  
  const totalScanned = looseItemsCount + manualQty

  return (
    <>
      {/* Batch Processing Modal */}
      <Dialog open={batchProcessingActive} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-center">Processing Batch</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="text-center">
              <p className="text-lg text-gray-700 mb-2">{batchProcessingStatus}</p>
              <p className="text-sm text-gray-500 uppercase tracking-wide font-semibold">
                {batchProcessingSummary.success + batchProcessingSummary.duplicates + batchProcessingSummary.errors} OF {batchProcessingSummary.total} CODES SCANNED
              </p>
            </div>

            <Progress value={batchProcessingProgress} className="h-3" />

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <p className="text-sm font-medium text-blue-600 mb-1">SUCCESS</p>
                <p className="text-3xl font-bold text-blue-700">{batchProcessingSummary.success}</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-4 text-center">
                <p className="text-sm font-medium text-orange-600 mb-1">DUPLICATES</p>
                <p className="text-3xl font-bold text-orange-700">{batchProcessingSummary.duplicates}</p>
              </div>
              <div className="bg-red-50 rounded-lg p-4 text-center">
                <p className="text-sm font-medium text-red-600 mb-1">ERRORS</p>
                <p className="text-3xl font-bold text-red-700">{batchProcessingSummary.errors}</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Warehouse ShipV2</h1>
          <p className="text-gray-600 mt-1">
            Scan master cases and unique QR codes for distributor shipments
          </p>
        </div>

      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <Target className="h-5 w-5 text-blue-600" />
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Distributor
              </label>
              <select
                value={selectedDistributor}
                onChange={(e) => setSelectedDistributor(e.target.value)}
                className="w-full px-4 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Choose distributor...</option>
                {distributors.map(distributor => (
                  <option key={distributor.id} value={distributor.id}>
                    {distributor.org_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Manual Stock Section */}
      {selectedDistributor && (
        <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-900">
              <Box className="h-5 w-5" />
              Manual Stock Addition
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Variant Selection with Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Product Variant {variantsWithStock.length > 0 && `(${variantsWithStock.length} available)`}
                </label>
                {selectedVariant && (
                  <div className="mb-2 p-2 bg-purple-100 border border-purple-300 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-xs text-purple-600 font-medium">Selected:</p>
                        <p className="text-sm font-semibold text-purple-900">
                          {(() => {
                            const variant = variantsWithStock.find(v => v.id === selectedVariant)
                            const product = variant ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
                            return variant ? `${product?.product_name} - ${variant.variant_name}` : 'Unknown'
                          })()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedVariant('')}
                        className="h-8 w-8 p-0 hover:bg-purple-200"
                      >
                        <XCircle className="h-4 w-4 text-purple-600" />
                      </Button>
                    </div>
                  </div>
                )}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search product variant..."
                    value={variantSearchTerm}
                    onChange={(e) => setVariantSearchTerm(e.target.value)}
                    onFocus={() => setVariantSearchTerm('')}
                    className="w-full pl-10 pr-4 py-2 border border-purple-300 rounded-t-lg focus:ring-2 focus:ring-purple-500 bg-white text-sm"
                  />
                </div>
                <div className="border border-t-0 border-purple-300 rounded-b-lg bg-white max-h-64 overflow-y-auto">
                  {loadingVariants ? (
                    <div className="p-4 text-center text-gray-500">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Loading variants...
                    </div>
                  ) : variantsWithStock.length === 0 ? (
                    <div className="p-4 text-center text-gray-500">
                      <Box className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm">No variants with manual stock available</p>
                    </div>
                  ) : (
                    variantsWithStock
                      .filter(variant => {
                        if (!variantSearchTerm) return true
                        const product = Array.isArray(variant.products) ? variant.products[0] : variant.products
                        const searchLower = variantSearchTerm.toLowerCase()
                        const productName = product?.product_name?.toLowerCase() || ''
                        const variantName = variant.variant_name?.toLowerCase() || ''
                        return productName.includes(searchLower) || variantName.includes(searchLower)
                      })
                      .map(variant => {
                        const product = Array.isArray(variant.products) ? variant.products[0] : variant.products
                        const isSelected = selectedVariant === variant.id
                        return (
                          <div
                            key={variant.id}
                            onClick={() => {
                              setSelectedVariant(variant.id)
                              setVariantSearchTerm('')
                            }}
                            className={`px-4 py-3 cursor-pointer hover:bg-purple-50 border-b border-gray-100 last:border-b-0 ${
                              isSelected ? 'bg-purple-100' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">
                                  {product?.product_name}
                                </p>
                                <p className="text-xs text-gray-600">
                                  {variant.variant_name}
                                </p>
                              </div>
                              <Badge variant="secondary" className="ml-2">
                                {variant.manual_balance_qty} units
                              </Badge>
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </div>

              {/* Manual Quantity Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Manual Quantity to Ship
                </label>
                <input
                  type="number"
                  min="0"
                  max={manualStockBalance}
                  value={manualQty}
                  onChange={(e) => setManualQty(Math.max(0, Math.min(manualStockBalance, parseInt(e.target.value) || 0)))}
                  disabled={!selectedVariant || loadingManualStock}
                  placeholder="Enter quantity..."
                  className="w-full px-4 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white disabled:bg-gray-100"
                />
              </div>
            </div>

            {/* Stock Balance Display */}
            {selectedVariant && (
              <div className="bg-white border border-purple-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    Available Manual Stock Balance:
                  </span>
                  <Badge variant={manualStockBalance > 0 ? "default" : "secondary"} className="text-lg">
                    {loadingManualStock ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      `${manualStockBalance} units`
                    )}
                  </Badge>
                </div>
                {manualQty > 0 && (
                  <div className="mt-2 pt-2 border-t border-purple-100">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">After shipment:</span>
                      <span className="font-semibold text-purple-700">
                        {manualStockBalance - manualQty} units remaining
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Alert className="border-purple-200 bg-purple-50">
              <AlertDescription className="text-purple-800 text-sm">
                <strong>Note:</strong> Manual stock is for items added without QR codes. 
                You can ship a mix of QR-coded items (scanned below) and manual stock items together.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {shipmentProgress && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-green-900">
                <Truck className="h-5 w-5" />
                Current Ship Progress: Distributor: {shipmentProgress.distributor_name}
              </CardTitle>
              {(masterCasesCount > 0 || looseItemsCount > 0 || manualQty > 0) && (
                <div className="flex gap-2">
                  <Button
                    onClick={handleCancelShipment}
                    disabled={canceling || confirming || (masterCasesCount === 0 && looseItemsCount === 0 && manualQty === 0)}
                    variant="outline"
                    className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    {canceling ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4 mr-2" />
                    )}
                    Cancel Shipment
                  </Button>
                  <Button
                    onClick={handleConfirmShipment}
                    disabled={confirming || canceling || (masterCasesCount === 0 && looseItemsCount === 0 && manualQty === 0)}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {confirming ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    )}
                    Confirm Shipment
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Main counts */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="bg-white border border-green-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Master Cases</span>
                  <span className="text-2xl font-bold text-green-700">
                    {masterCasesCount}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  Full cases scanned
                </p>
              </div>

              <div className="bg-white border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Loose Items</span>
                  <span className="text-2xl font-bold text-blue-700">
                    {looseItemsCount}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  Individual units
                </p>
              </div>

              <div className="bg-white border border-purple-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Manual Stock</span>
                  <span className="text-2xl font-bold text-purple-700">
                    {manualQty}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  Non-QR units
                </p>
              </div>

              <div className="bg-white border border-orange-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Variants</span>
                  <span className="text-2xl font-bold text-orange-700">
                    {variantCount + (manualQty > 0 ? 1 : 0)}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  Product types
                </p>
              </div>

              <div className="bg-white border border-indigo-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Total Items</span>
                  <span className="text-2xl font-bold text-indigo-700">
                    {looseItemsCount + manualQty}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  Ready to ship
                </p>
              </div>
            </div>

            {/* Variant breakdown */}
            {variantCount > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Product Variant Breakdown</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {Object.entries(scanSummary.variants).map(([variant, count]) => (
                    <div key={variant} className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-200">
                      <span className="text-sm text-gray-700 truncate">{variant}</span>
                      <Badge variant="secondary" className="ml-2">{count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status summary */}
            {(scanSummary.duplicateCount > 0 || scanSummary.errorCount > 0) && (
              <div className="flex gap-4 text-sm">
                {scanSummary.duplicateCount > 0 && (
                  <div className="flex items-center gap-2 text-orange-700">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{scanSummary.duplicateCount} duplicate{scanSummary.duplicateCount > 1 ? 's' : ''}</span>
                  </div>
                )}
                {scanSummary.errorCount > 0 && (
                  <div className="flex items-center gap-2 text-red-700">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{scanSummary.errorCount} error{scanSummary.errorCount > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
            )}

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">Scanning Progress</span>
                <span className="text-gray-900 font-bold">{totalScanned} units ready</span>
              </div>
              <p className="text-xs text-gray-600">
                Status: <strong>warehouse_packed</strong> - Ready to confirm shipment
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5" />
            Scan for Distributor Shipment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedDistributor && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Please select a distributor above to begin scanning for shipment.
              </AlertDescription>
            </Alert>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Scan/Enter QR Code
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleScanCode()
                  }
                }}
                placeholder="Scan or type QR code..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={scanning || !selectedDistributor}
              />
              <Button
                onClick={handleScanCode}
                disabled={scanning || !qrInput.trim() || !selectedDistributor}
              >
                {scanning ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Scan className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div>
            <Button
              variant="outline"
              onClick={() => setShowBatchInput(!showBatchInput)}
              className="w-full"
              disabled={!selectedDistributor}
            >
              <ClipboardPaste className="h-4 w-4 mr-2" />
              {showBatchInput ? 'Hide' : 'Show'} Batch Paste
            </Button>
          </div>

          {showBatchInput && (
            <div className="border border-blue-200 rounded-lg p-4 bg-blue-50 space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                Paste Multiple QR Codes (one per line)
              </label>
              <textarea
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                placeholder="Paste QR codes here... (one per line)&#10;MASTER-ORD-XX-XXXX-XX-CASE-XXX&#10;MASTER-ORD-XX-XXXX-XX-CASE-XXX&#10;..."
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                disabled={!selectedDistributor}
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleBatchPaste}
                  disabled={!batchInput.trim() || !selectedDistributor || scanning}
                  className="flex-1"
                >
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  {scanning ? 'Processing...' : 'Process Batch'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setBatchInput('')}
                  disabled={!selectedDistributor}
                >
                  Clear
                </Button>
              </div>
              <div className="text-xs text-gray-600">
                {batchInput.trim().length > 0 ? (
                  <span>
                    Detected <strong>{batchInput.split('\n').filter(line => line.trim().length > 0).length}</strong> QR codes
                  </span>
                ) : (
                  <span>Paste QR codes above to preview how many will be processed.</span>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                Scanned Codes ({scannedCodes.length})
              </label>
              {scannedCodes.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setScannedCodes([])}
                >
                  Clear All
                </Button>
              )}
            </div>

            <div className="border border-gray-200 rounded-lg max-h-96 overflow-y-auto">
              {scannedCodes.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <QrCode className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                  <p>No codes scanned yet</p>
                  <p className="text-sm">Scan QR codes to begin shipment preparation</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {scannedCodes.map((code, index) => (
                    <div key={index} className={`p-3 flex items-center justify-between hover:bg-gray-50 ${
                      code.status === 'error' ? 'bg-red-50' : 
                      code.status === 'duplicate' ? 'bg-orange-50' : 
                      'bg-green-50'
                    }`}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-xs">
                            #{code.sequence_number}
                          </Badge>
                          {code.status === 'success' && (
                            <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Success
                            </Badge>
                          )}
                          {code.status === 'duplicate' && (
                            <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Duplicate
                            </Badge>
                          )}
                          {code.status === 'error' && (
                            <Badge className="bg-red-100 text-red-800 border-red-200 text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Error
                            </Badge>
                          )}
                          <p className="text-sm font-medium text-gray-900">
                            {code.product_name}
                          </p>
                        </div>
                        <p className="text-xs text-gray-500">
                          {code.variant_name}
                        </p>
                        <p className="text-xs text-gray-400 font-mono mt-1">
                          {code.code}
                        </p>
                        {code.error_message && (
                          <div className="mt-2 p-2 bg-white border border-red-200 rounded text-xs text-red-700">
                            <strong>Reason:</strong> {code.error_message}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {code.status === 'success' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUnlinkCode(code.code, code.code_type === 'master' ? 'master' : 'unique')}
                            disabled={unlinking === code.code || confirming}
                            className="hover:bg-orange-50 text-orange-600 border-orange-300"
                          >
                            {unlinking === code.code ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              'Unlink'
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveCode(index)}
                          className="hover:bg-red-50"
                          disabled={unlinking === code.code}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Selected Distributor Scan History
            </CardTitle>
            <p className="text-sm text-gray-500">
              Product shipments for the distributor selected above.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                {selectedDistributor ? (
                  <p className="text-sm text-gray-600">
                    Showing products shipped to selected distributor.
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">
                    Select a distributor to view shipment history.
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={loadScanHistory}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Distributor</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Product</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Units</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Scanned At</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {(() => {
                    if (distributorHistory.length === 0) {
                      return (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-gray-500">
                            <Box className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                            <p>{selectedDistributor ? 'No scans for this distributor yet' : 'No distributor selected'}</p>
                            <p className="text-sm text-gray-400 mt-1">
                              {selectedDistributor ? 'Scan codes above to begin tracking shipments.' : 'Choose a distributor from the dropdown above.'}
                            </p>
                          </td>
                        </tr>
                      )
                    }
                    
                    // Aggregate by product across all sessions for this distributor
                    const productAggregation: Record<string, { units: number, lastScanned: string, status: string, distributorName: string, sessionIds: string[], validation_status?: string }> = {}
                    
                    distributorHistory.forEach(item => {
                      Object.entries(item.product_breakdown).forEach(([product, qty]) => {
                        if (!productAggregation[product]) {
                          productAggregation[product] = {
                            units: 0,
                            lastScanned: item.scanned_at,
                            status: item.status,
                            distributorName: item.distributor_name,
                            sessionIds: [],
                            validation_status: item.validation_status
                          }
                        }
                        productAggregation[product].units += Number(qty)
                        productAggregation[product].sessionIds.push(item.id)
                        // Keep the most recent scan time
                        if (new Date(item.scanned_at) > new Date(productAggregation[product].lastScanned)) {
                          productAggregation[product].lastScanned = item.scanned_at
                          productAggregation[product].status = item.status
                          productAggregation[product].validation_status = item.validation_status
                        }
                      })
                    })
                    
                    return Object.entries(productAggregation).map(([product, data]) => (
                      <tr key={product} className="hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm font-medium text-gray-900">
                          {data.distributorName}
                        </td>
                        <td className="py-3 px-4 text-sm font-medium text-gray-900">
                          {product}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm font-semibold text-blue-600">
                            {data.units} units
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {data.lastScanned ? new Date(data.lastScanned).toLocaleString() : '-'}
                        </td>
                        <td className="py-3 px-4">{renderStatusBadge(data.status)}</td>
                        <td className="py-3 px-4">
                          {data.status === 'warehouse_packed' && data.validation_status !== 'approved' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleUnlinkProduct(data.sessionIds, product)}
                              disabled={unlinking === product}
                              className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {unlinking === product ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Unlink className="h-4 w-4 mr-1" />
                                  Unlink
                                </>
                              )}
                            </Button>
                          ) : (
                            <span className="text-xs text-gray-400">
                              {data.status === 'shipped_distributor' ? 'Shipped' : '-'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  })()}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Overall Recent Scan History
              </CardTitle>
              <Button variant="outline" size="sm" onClick={loadScanHistory}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Distributor</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Product</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Units</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Scanned At</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {(() => {
                    if (overallHistory.length === 0) {
                      return (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-gray-500">
                            <Box className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                            <p>No scan history yet</p>
                            <p className="text-sm text-gray-400 mt-1">
                              Start scanning master cases to track warehouse shipments.
                            </p>
                          </td>
                        </tr>
                      )
                    }
                    
                    // Aggregate by distributor + product across all sessions
                    const aggregation: Record<string, { distributor: string, product: string, units: number, lastScanned: string, status: string, sessionIds: string[] }> = {}
                    
                    overallHistory.forEach(item => {
                      Object.entries(item.product_breakdown).forEach(([product, qty]) => {
                        const key = `${item.distributor_id}|||${product}` // Use ||| as separator to avoid conflicts with hyphens
                        if (!aggregation[key]) {
                          aggregation[key] = {
                            distributor: item.distributor_name,
                            product: product,
                            units: 0,
                            lastScanned: item.scanned_at,
                            status: item.status,
                            sessionIds: []
                          }
                        }
                        aggregation[key].units += Number(qty)
                        aggregation[key].sessionIds.push(item.id)
                        // Keep the most recent scan time
                        if (new Date(item.scanned_at) > new Date(aggregation[key].lastScanned)) {
                          aggregation[key].lastScanned = item.scanned_at
                          aggregation[key].status = item.status
                        }
                      })
                    })
                    
                    return Object.entries(aggregation).map(([key, data]) => {
                      return (
                        <tr key={key} className="hover:bg-gray-50">
                          <td className="py-3 px-4 text-sm font-medium text-gray-900">
                            {data.distributor}
                          </td>
                          <td className="py-3 px-4 text-sm font-medium text-gray-900">
                            {data.product}
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-sm font-semibold text-blue-600">
                              {data.units} units
                            </span>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600">
                            {data.lastScanned ? new Date(data.lastScanned).toLocaleString() : '-'}
                          </td>
                          <td className="py-3 px-4">{renderStatusBadge(data.status)}</td>
                          <td className="py-3 px-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleUnlinkProduct(data.sessionIds, data.product)}
                              disabled={data.status === 'shipped_distributor' || unlinking === data.product}
                              className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {unlinking === data.product ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Unlink className="h-4 w-4 mr-1" />
                                  Unlink
                                </>
                              )}
                            </Button>
                          </td>
                        </tr>
                      )
                    })
                  })()}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    </>
  )
}
