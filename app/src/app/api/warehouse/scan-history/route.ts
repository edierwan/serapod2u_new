import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get organization_id and role from users profile table
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id, role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Check if user is Super Admin (role_level = 1)
    const isSuperAdmin = profile && (profile as any).roles && (profile as any).roles.role_level === 1

    if (!profile.organization_id && !isSuperAdmin) {
      return NextResponse.json({ error: 'Organization not assigned' }, { status: 400 })
    }

    const warehouseOrgId = profile.organization_id

    console.log('🔍 Querying shipment history for warehouse org:', isSuperAdmin ? 'ALL (Super Admin)' : warehouseOrgId)

    // Query qr_validation_reports to get shipment sessions
    // Show BOTH approved (completed) and pending/matched (current scanning) sessions
    let sessionQuery = supabase
      .from('qr_validation_reports')
      .select(`
        id,
        warehouse_org_id,
        distributor_org_id,
        destination_order_id,
        validation_status,
        master_codes_scanned,
        unique_codes_scanned,
        scanned_quantities,
        created_at,
        updated_at,
        approved_at,
        destination_order:orders!qr_validation_reports_destination_order_id_fkey (
          id,
          order_no,
          buyer_org_id,
          seller_org_id,
          buyer:organizations!orders_buyer_org_id_fkey (
            id,
            org_name
          ),
          seller:organizations!orders_seller_org_id_fkey (
            id,
            org_name
          )
        ),
        distributor:organizations!qr_validation_reports_distributor_org_id_fkey (
          id,
          org_name
        )
      `)
      .in('validation_status', ['approved', 'pending', 'matched'])  // Show approved (shipped) AND current scanning sessions
      .order('updated_at', { ascending: false })  // Most recent first
      .limit(20)  // Show more to include both current and recent history

    // Only filter by warehouse_org_id if not Super Admin
    if (!isSuperAdmin && warehouseOrgId) {
      sessionQuery = sessionQuery.eq('warehouse_org_id', warehouseOrgId)
    }

    const { data: sessions, error: sessionError } = await sessionQuery

    if (sessionError) {
      console.error('❌ Sessions query error:', sessionError)
      return NextResponse.json({ error: 'Database query failed', details: sessionError.message }, { status: 500 })
    }

    console.log('📦 Found sessions:', sessions?.length || 0)

    if (!sessions || sessions.length === 0) {
      console.log('ℹ️ No shipment sessions found for this warehouse')
      return NextResponse.json({
        success: true,
        count: 0,
        history: []
      })
    }

    const chunkArray = <T>(array: T[], size = 100) => {
      const result: T[][] = []
      for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size))
      }
      return result
    }

    const buildProductLabel = (product?: string | null, variant?: string | null) => {
      const productName = (product || '').trim()
      const variantName = (variant || '').trim()
      if (productName && variantName) {
        return `${productName} - ${variantName}`
      }
      return productName || variantName || ''
    }

    const masterToDistributor = new Map<string, { id: string | null; name: string }>()
    const masterToProductLabel = new Map<string, string>()

    // Collect all scanned codes from sessions
    const allMasterCodes = new Set<string>()
    const allUniqueCodes = new Set<string>()
    
    sessions.forEach(session => {
      const masters = session.master_codes_scanned || []
      const uniques = session.unique_codes_scanned || []
      masters.forEach((mc: string) => allMasterCodes.add(mc))
      uniques.forEach((uc: string) => allUniqueCodes.add(uc))
    })

    console.log('🔢 Total codes: master=', allMasterCodes.size, 'unique=', allUniqueCodes.size)

    // Query all codes to get product information
    let qrCodes: any[] = []
    const masterRecords: any[] = []
    let masterChildCodes: any[] = []
    let masterCodeData: any[] = []
    
    if (allUniqueCodes.size > 0) {
      const uniqueCodesArray = Array.from(allUniqueCodes)
      for (const chunk of chunkArray(uniqueCodesArray, 100)) {
        const { data: qrData, error: qrError } = await supabase
          .from('qr_codes')
          .select(`
            code,
            master_code_id,
            variant_id,
            product_variants (
              variant_name,
              products (
                product_name
              )
            ),
            qr_master_codes (
              master_code,
              case_number
            )
          `)
          .in('code', chunk)

        if (qrError) {
          console.warn('⚠️ QR codes query warning:', qrError)
        } else if (qrData && qrData.length > 0) {
          qrCodes = qrCodes.concat(qrData)
        }
      }
    }

    if (allMasterCodes.size > 0) {
      const masterCodesArray = Array.from(allMasterCodes)
      for (const chunk of chunkArray(masterCodesArray, 50)) {
        const { data: chunkRecords, error: masterRecordsError } = await supabase
          .from('qr_master_codes')
          .select('id, master_code, case_number, actual_unit_count')
          .in('master_code', chunk)

        if (masterRecordsError) {
          console.warn('⚠️ Master codes query warning:', masterRecordsError)
          continue
        }

        if (chunkRecords && chunkRecords.length > 0) {
          masterRecords.push(...chunkRecords)
        }
      }

      if (masterRecords.length > 0) {
        const masterIds = masterRecords.map(m => m.id)
        for (const chunk of chunkArray(masterIds, 50)) {
          const { data: chunkChildren, error: childError } = await supabase
            .from('qr_codes')
            .select(`
              code,
              master_code_id,
              status,
              product_variants (
                variant_name,
                products (
                  product_name
                )
              )
            `)
            .in('master_code_id', chunk)

          if (childError) {
            console.error('Error loading child codes for masters:', childError)
            continue
          }

          if (chunkChildren && chunkChildren.length > 0) {
            masterChildCodes = masterChildCodes.concat(chunkChildren)
          }
        }

        if (masterChildCodes.length > 0) {
          const childrenByMaster = new Map<string, any[]>()
          masterChildCodes.forEach(child => {
            if (!child.master_code_id) return
            if (!childrenByMaster.has(child.master_code_id)) {
              childrenByMaster.set(child.master_code_id, [])
            }
            childrenByMaster.get(child.master_code_id)!.push(child)
          })

          masterRecords.forEach(master => {
            const children = childrenByMaster.get(master.id) || []
            if (children.length > 0) {
              const firstChild = children[0]
              const variant = Array.isArray(firstChild.product_variants) ? firstChild.product_variants[0] : firstChild.product_variants
              const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null

              if (product && variant) {
                const productLabel = buildProductLabel(product.product_name, variant.variant_name)
                if (productLabel) {
                  masterToProductLabel.set(master.master_code, productLabel)
                }

                masterCodeData.push({
                  master_code: master.master_code,
                  case_number: master.case_number,
                  product_variants: [{ variant_name: variant.variant_name, products: [{ product_name: product.product_name }] }]
                })
              } else {
                console.warn(`⚠️ No product/variant info for master ${master.master_code}`)
              }
            } else {
              console.warn(`⚠️ No children found for master ${master.master_code} (ID: ${master.id})`)
            }
          })
        }
      }
    }

    console.log('🏷️ Found product info: unique codes=', qrCodes?.length || 0, 'master codes=', masterCodeData?.length || 0)

    // Create a map of code -> product info
    const codeProductMap = new Map<string, any>()
    
    // Map unique codes
    ;(qrCodes || []).forEach(qr => {
      const variant = Array.isArray(qr.product_variants) ? qr.product_variants[0] : qr.product_variants
      const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
      const master = Array.isArray(qr.qr_master_codes) ? qr.qr_master_codes[0] : qr.qr_master_codes
      
      if (product && variant) {
        const productLabel = buildProductLabel(product.product_name, variant.variant_name)
        if (master?.master_code && productLabel) {
          masterToProductLabel.set(master.master_code, productLabel)
        }

        codeProductMap.set(qr.code, {
          product_name: product.product_name,
          variant_name: variant.variant_name,
          master_code: master?.master_code || null,
          case_number: master?.case_number || null,
          product_label: productLabel
        })
      }
    })
    
    // Map master codes
    ;(masterCodeData || []).forEach(master => {
      const variant = Array.isArray(master.product_variants) ? master.product_variants[0] : master.product_variants
      const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
      
      if (product && variant) {
        const productLabel = buildProductLabel(product.product_name, variant.variant_name)
        if (productLabel) {
          masterToProductLabel.set(master.master_code, productLabel)
        }
        codeProductMap.set(master.master_code, {
          product_name: product.product_name,
          variant_name: variant.variant_name,
          master_code: master.master_code,
          case_number: master.case_number || null,
          product_label: productLabel
        })
      }
    })

    allMasterCodes.forEach(masterCode => {
      if (codeProductMap.has(masterCode)) return
      const label = masterToProductLabel.get(masterCode)
      if (label) {
        codeProductMap.set(masterCode, {
          product_name: label,
          variant_name: '',
          master_code: masterCode,
          case_number: null,
          product_label: label
        })
      }
    })

    console.log('📍 Product info mapped for', codeProductMap.size, 'codes')

    // Format response - one entry per session (shipment)
    const history: any[] = []
    
    for (const session of sessions) {
      const order = Array.isArray(session.destination_order) ? session.destination_order[0] : session.destination_order
      const distributor = Array.isArray(session.distributor) ? session.distributor[0] : session.distributor
      const buyer = order?.buyer ? (Array.isArray(order.buyer) ? order.buyer[0] : order.buyer) : null
      const seller = order?.seller ? (Array.isArray(order.seller) ? order.seller[0] : order.seller) : null
      
      const orderNo = order?.order_no || 'Unknown'
      let distributorId: string | null = session.distributor_org_id || order?.buyer_org_id || null
      let distributorName = distributor?.org_name || buyer?.org_name || ''

      if (!distributorName && seller?.org_name && order?.seller_org_id && order.seller_org_id !== profile.organization_id) {
        distributorId = order.seller_org_id
        distributorName = seller.org_name
      }

      if (!distributorName) {
        distributorName = 'Unassigned Distributor'
      }
      
      // Get master and unique codes for this session
      const masterCodes = session.master_codes_scanned || []
      masterCodes.forEach((mc: string) => {
        if (!mc) return
        if (!masterToDistributor.has(mc)) {
          masterToDistributor.set(mc, { id: distributorId, name: distributorName })
        }
      })
      const uniqueCodes = session.unique_codes_scanned || []
      const allCodes = [...masterCodes, ...uniqueCodes]
      
      // Aggregate products across all codes in this session
      const productBreakdown: Record<string, number> = {}
      let totalUnits = 0
      let caseNumber = 0
      let masterCode = ''
      
      allCodes.forEach((code: string) => {
        const productInfo = codeProductMap.get(code)
        if (productInfo) {
          const label = productInfo.product_label || buildProductLabel(productInfo.product_name, productInfo.variant_name) || productInfo.product_name || 'Unknown Product'
          productBreakdown[label] = (productBreakdown[label] || 0) + 1
          totalUnits++
          
          if (productInfo.case_number && !caseNumber) {
            caseNumber = productInfo.case_number
          }
          if (productInfo.master_code && !masterCode) {
            masterCode = productInfo.master_code
          }
          if (productInfo.master_code && label && label !== 'Unknown Product') {
            masterToProductLabel.set(productInfo.master_code, label)
          }
        }
      })

      if (!masterCode && masterCodes.length > 0) {
        masterCode = masterCodes[0]
      }

      // Count ACTUAL units: for master codes, use their actual_unit_count; for unique codes, count them directly
      let actualUnits = uniqueCodes.length  // Direct unique codes
      
      // For each master code, use its actual_unit_count from the database
      if (masterCodes.length > 0) {
        for (const masterCode of masterCodes) {
          const masterRecord = masterRecords.find(m => m.master_code === masterCode)
          if (masterRecord && masterRecord.actual_unit_count) {
            // Use the actual_unit_count stored in the master code record
            actualUnits += masterRecord.actual_unit_count
          } else if (masterRecord) {
            // Fallback: count child codes if actual_unit_count is not set
            const childCount = masterChildCodes.filter(c => c.master_code_id === masterRecord.id).length
            actualUnits += childCount > 0 ? childCount : 1
          } else {
            // Fallback: if master not found, count as 1
            actualUnits += 1
          }
        }
      }
      
      // Skip sessions with no codes (e.g., after all codes have been unlinked)
      if (actualUnits === 0) {
        console.log(`⏭️ Skipping session ${session.id} - no codes remaining`)
        continue
      }
      
      // Determine actual status by checking if ANY codes in this session are shipped
      // Query the actual QR code statuses to get the real state
      let actualStatus = 'warehouse_packed'  // Default
      
      // Check if session is approved (already confirmed/shipped)
      if (session.validation_status === 'approved') {
        actualStatus = 'shipped_distributor'
      } else if (allCodes.length > 0) {
        // For non-approved sessions, check actual code statuses
        // Check unique codes first
        if (uniqueCodes.length > 0) {
          const samplCodes = uniqueCodes.slice(0, Math.min(10, uniqueCodes.length))
          const { data: statusChecks } = await supabase
            .from('qr_codes')
            .select('status')
            .in('code', samplCodes)
          
          // If ANY unique code is shipped, consider the shipment as shipped
          const hasShippedCodes = statusChecks?.some(c => c.status === 'shipped_distributor')
          if (hasShippedCodes) {
            actualStatus = 'shipped_distributor'
          }
        }
        
        // Also check master codes
        if (actualStatus === 'warehouse_packed' && masterCodes.length > 0) {
          const sampleMasters = masterCodes.slice(0, Math.min(10, masterCodes.length))
          const { data: masterStatusChecks } = await supabase
            .from('qr_master_codes')
            .select('status')
            .in('master_code', sampleMasters)
          
          // If ANY master code is shipped, consider the shipment as shipped
          const hasShippedMasters = masterStatusChecks?.some(m => m.status === 'shipped_distributor')
          if (hasShippedMasters) {
            actualStatus = 'shipped_distributor'
          }
        }
      }
      
      // Get primary product name from product_breakdown
      const productNames = Object.keys(productBreakdown)
      let primaryProduct = 'Unknown Product'
      if (productNames.length > 0) {
        primaryProduct = productNames[0]
      } else if (masterCode && masterToProductLabel.has(masterCode)) {
        primaryProduct = masterToProductLabel.get(masterCode) as string
      } else if (masterCode) {
        primaryProduct = masterCode
      }
      if (masterCode && primaryProduct && primaryProduct !== masterCode) {
        masterToProductLabel.set(masterCode, primaryProduct)
      }
      
      history.push({
        id: session.id,
        master_code: masterCode || `SESSION-${session.id.substring(0, 8)}`,
        product_name: primaryProduct,  // NEW: Add product name for display
        case_number: caseNumber || masterCodes.length,
        actual_unit_count: actualUnits,  // Count of codes in THIS session only
        scanned_at: session.approved_at || session.updated_at || session.created_at,
        order_id: session.destination_order_id,
        order_no: orderNo,
  distributor_id: distributorId || session.distributor_org_id,
        distributor_name: distributorName,
        status: actualStatus,  // Use actual QR code status, not session status
        validation_status: session.validation_status,  // Keep original for UI logic
        product_breakdown: productBreakdown
      })
    }

    console.log('✅ Formatted history:', history.length, 'sessions')

    // NEW: Also fetch warehouse_packed codes that haven't been shipped yet
    console.log('🔍 Fetching unshipped warehouse_packed codes...')
    
    let unshippedQuery = supabase
      .from('qr_master_codes')
      .select(`
        id,
        master_code,
        case_number,
        status,
        actual_unit_count,
        expected_unit_count,
        created_at,
        warehouse_org_id,
        shipped_to_distributor_id,
        shipped_to_distributor:organizations!qr_master_codes_shipped_to_distributor_id_fkey (
          id,
          org_name
        ),
        qr_batches (
          order_id,
          orders (
            id,
            order_no,
            buyer_org_id,
            seller_org_id,
            buyer:organizations!orders_buyer_org_id_fkey (
              id,
              org_name
            ),
            seller:organizations!orders_seller_org_id_fkey (
              id,
              org_name
            )
          )
        )
      `)
      .eq('status', 'warehouse_packed')  // ONLY warehouse_packed - not received_warehouse (which is after unlink)
      .order('created_at', { ascending: false })
      .limit(50)

    // Only filter by warehouse_org_id if not Super Admin
    if (!isSuperAdmin && warehouseOrgId) {
      unshippedQuery = unshippedQuery.eq('warehouse_org_id', warehouseOrgId)
    }

    const { data: unshippedMasters, error: unshippedError } = await unshippedQuery

    if (unshippedError) {
      console.warn('⚠️ Warning fetching unshipped codes:', unshippedError)
    } else if (unshippedMasters && unshippedMasters.length > 0) {
      console.log(`📦 Found ${unshippedMasters.length} unshipped warehouse_packed master codes`)
      
      // Get child codes count for each master

      const masterIds = unshippedMasters.map(m => m.id)

      const { data: unshippedCodes, error: unshippedCodesError } = await supabase
        .from('qr_codes')
        .select(`
          code,
          master_code_id,
          product_variants (
            variant_name,
            products (
              product_name
            )
          )
        `)
        .in('master_code_id', masterIds)
        .eq('status', 'warehouse_packed')
        .limit(5000)

      if (unshippedCodesError) {
        console.warn('⚠️ Warning fetching unshipped child codes:', unshippedCodesError)
      }

      const childCountMap = new Map<string, number>()
      const productBreakdownMap = new Map<string, Record<string, number>>()
      const uniqueDetailsMap = new Map<string, Array<{ code: string, product_name: string, variant_name: string }>>()

      ;(unshippedCodes || []).forEach(code => {
        if (!code.master_code_id) return

        const variant = Array.isArray(code.product_variants) ? code.product_variants[0] : code.product_variants
        const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null

        const productLabel = product?.product_name
          ? `${product.product_name}${variant?.variant_name ? ` - ${variant.variant_name}` : ''}`
          : 'Uncategorized Product'

        if (!productBreakdownMap.has(code.master_code_id)) {
          productBreakdownMap.set(code.master_code_id, {})
        }

        if (!uniqueDetailsMap.has(code.master_code_id)) {
          uniqueDetailsMap.set(code.master_code_id, [])
        }

        const breakdown = productBreakdownMap.get(code.master_code_id)!
        breakdown[productLabel] = (breakdown[productLabel] || 0) + 1

        uniqueDetailsMap.get(code.master_code_id)!.push({
          code: code.code,
          product_name: product?.product_name || 'Unknown Product',
          variant_name: variant?.variant_name || 'Unit'
        })

        childCountMap.set(code.master_code_id, (childCountMap.get(code.master_code_id) || 0) + 1)
      })

      // Add unshipped masters to history
      unshippedMasters.forEach((master: any) => {
        const batch = Array.isArray(master.qr_batches) ? master.qr_batches[0] : master.qr_batches
        const order = batch?.orders ? (Array.isArray(batch.orders) ? batch.orders[0] : batch.orders) : null
        const buyer = order?.buyer ? (Array.isArray(order.buyer) ? order.buyer[0] : order.buyer) : null
        const seller = order?.seller ? (Array.isArray(order.seller) ? order.seller[0] : order.seller) : null
        const shippedDistributor = master?.shipped_to_distributor ? (Array.isArray(master.shipped_to_distributor) ? master.shipped_to_distributor[0] : master.shipped_to_distributor) : null
        
        const childCount = childCountMap.get(master.id) || 0
        
        // CRITICAL: Skip masters with zero warehouse_packed child codes (they've been unlinked)
        if (childCount === 0) {
          console.log(`⏭️ Skipping master ${master.master_code} - no warehouse_packed child codes`)
          return
        }
        let breakdown = productBreakdownMap.get(master.id)
        if (!breakdown || Object.keys(breakdown).length === 0) {
          const fallbackLabel = masterToProductLabel.get(master.master_code)
          if (childCount > 0 && fallbackLabel) {
            breakdown = { [fallbackLabel]: childCount }
          } else if (childCount > 0) {
            breakdown = { [master.master_code]: childCount }
          } else {
            breakdown = {}
          }
        }

        let distributorId = master.shipped_to_distributor_id || order?.buyer_org_id || null
        let distributorName = 'Unassigned Distributor'
        if (master.shipped_to_distributor_id && shippedDistributor?.org_name) {
          distributorName = shippedDistributor.org_name
        } else if (order?.buyer_org_id && buyer?.org_name) {
          distributorId = order.buyer_org_id
          distributorName = buyer.org_name
        } else if (masterToDistributor.has(master.master_code)) {
          const info = masterToDistributor.get(master.master_code)!
          distributorId = info.id
          distributorName = info.name
        } else if (order?.seller_org_id && seller?.org_name && order.seller_org_id !== profile.organization_id) {
          distributorId = order.seller_org_id
          distributorName = seller.org_name
        }

        const uniqueDetails = uniqueDetailsMap.get(master.id) || []

        const existingEntry = history.find(item => item.master_code === master.master_code && item.status === 'warehouse_packed')

        const breakdownPrimary = Object.keys(breakdown || {})[0] || masterToProductLabel.get(master.master_code) || master.master_code

        if (existingEntry) {
          existingEntry.actual_unit_count = childCount
          existingEntry.order_id = existingEntry.order_id || order?.id || null
          existingEntry.order_no = order?.order_no || existingEntry.order_no || 'Unknown'
          existingEntry.distributor_id = distributorId || existingEntry.distributor_id || ''
          existingEntry.distributor_name = distributorName || existingEntry.distributor_name || 'Unknown'
          if (breakdownPrimary) {
            existingEntry.product_name = breakdownPrimary
          }

          if (Object.keys(breakdown).length > 0) {
            existingEntry.product_breakdown = breakdown
          }

          existingEntry.pending_master_codes = Array.from(new Set([...(existingEntry.pending_master_codes || []), master.master_code]))
          existingEntry.pending_unique_codes = [
            ...(existingEntry.pending_unique_codes || []),
            ...uniqueDetails
          ]
        } else {
          history.push({
            id: `unshipped-${master.id}`,
            master_code: master.master_code,
            case_number: master.case_number,
            actual_unit_count: childCount,
            scanned_at: master.created_at,
            order_id: order?.id || null,
            order_no: order?.order_no || 'Unknown',
            distributor_id: distributorId || null,
            distributor_name: distributorName,
            product_name: breakdownPrimary,
            status: 'warehouse_packed',  // Show as warehouse_packed (not yet shipped)
            validation_status: null,  // No session yet
            product_breakdown: breakdown,
            pending_master_codes: [master.master_code],
            pending_unique_codes: uniqueDetails
          })
        }
      })
      
      console.log(`✅ Total history (sessions + unshipped): ${history.length} records`)
    }

    return NextResponse.json({
      success: true,
      count: history.length,
      history: history
    })
  } catch (error: any) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}
