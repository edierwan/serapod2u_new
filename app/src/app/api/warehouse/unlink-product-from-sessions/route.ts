import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { session_ids, product_name, user_id } = await request.json()

    if (!session_ids || !Array.isArray(session_ids) || session_ids.length === 0) {
      return NextResponse.json(
        { error: 'session_ids array is required' },
        { status: 400 }
      )
    }

    if (!product_name) {
      return NextResponse.json(
        { error: 'product_name is required' },
        { status: 400 }
      )
    }

    if (!user_id) {
      return NextResponse.json(
        { error: 'user_id is required' },
        { status: 400 }
      )
    }

    console.log('🔓 Unlinking product:', product_name, 'from sessions:', session_ids)
    
    // Check if product_name looks like a master code
    const isMasterCodeLike = product_name.startsWith('MASTER-') || product_name.includes('-CASE-')
    console.log(`📝 Product name pattern: isMasterCodeLike=${isMasterCodeLike}`)

    const normalize = (value: string) => (value || '').trim().toLowerCase()
    const buildProductLabel = (product?: string | null, variant?: string | null) => {
      const productName = (product || '').trim()
      const variantName = (variant || '').trim()
      if (productName && variantName) {
        return `${productName} - ${variantName}`
      }
      return productName || variantName || ''
    }
    const normalizedProductTarget = normalize(product_name)

    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
    const realSessionIds = session_ids.filter((id: string) => uuidRegex.test(id))
    const unshippedEntries = session_ids.filter((id: string) => id.startsWith('unshipped-'))

    let totalUnlinked = 0

    let sessions: any[] = []
    if (realSessionIds.length > 0) {
      const { data: sessionData, error: sessionError } = await supabase
        .from('qr_validation_reports')
        .select('id, master_codes_scanned, unique_codes_scanned, warehouse_org_id, distributor_org_id')
        .in('id', realSessionIds)

      if (sessionError) {
        return NextResponse.json(
          { error: 'Failed to load sessions', details: sessionError.message },
          { status: 500 }
        )
      }

      sessions = sessionData || []
    }

    for (const session of sessions) {
      const masterCodes = Array.isArray(session.master_codes_scanned)
        ? session.master_codes_scanned.filter((code: string) => !!code)
        : []
      const uniqueCodes = Array.isArray(session.unique_codes_scanned)
        ? session.unique_codes_scanned.filter((code: string) => !!code)
        : []
      const codesToUnlinkSet = new Set<string>()
      const mastersToUnlink: Array<{
        id: string
        master_code: string
        status: string
        unitCount: number
        childCodes: string[]
      }> = []

      console.log(`🔄 Processing session ${session.id}:`, {
        masterCount: masterCodes.length,
        uniqueCount: uniqueCodes.length,
        masterCodes: masterCodes.slice(0, 2),
        uniqueCodes: uniqueCodes.slice(0, 2)
      })

      if (uniqueCodes.length > 0) {
        const { data: qrCodes, error: qrError } = await supabase
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
          .in('code', uniqueCodes)

        if (qrError) {
          console.error('Error querying QR codes:', qrError)
        } else {
          qrCodes?.forEach(qr => {
            const variant = Array.isArray(qr.product_variants) ? qr.product_variants[0] : qr.product_variants
            const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
            const label = buildProductLabel(product?.product_name, variant?.variant_name)

            if (label && normalize(label) === normalizedProductTarget) {
              codesToUnlinkSet.add(qr.code)
            }
          })
        }
      }

      let masterRecords: any[] = []
      if (masterCodes.length > 0) {
        const { data: masterData, error: masterLookupError } = await supabase
          .from('qr_master_codes')
          .select('id, master_code, status, actual_unit_count, expected_unit_count')
          .in('master_code', masterCodes)

        if (masterLookupError) {
          console.error('Error querying master codes:', masterLookupError)
        } else if (masterData) {
          masterRecords = masterData
        }
      }

      let childCodes: any[] = []
      if (masterRecords.length > 0) {
        const masterIds = masterRecords.map(record => record.id)
        const chunkSize = 100
        for (let i = 0; i < masterIds.length; i += chunkSize) {
          const chunk = masterIds.slice(i, i + chunkSize)
          const { data: chunkCodes, error: childError } = await supabase
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

          if (chunkCodes && chunkCodes.length > 0) {
            childCodes = childCodes.concat(chunkCodes)
          }
        }
      }

      const childrenByMaster = new Map<string, any[]>()
      childCodes.forEach(child => {
        if (!child.master_code_id) return
        if (!childrenByMaster.has(child.master_code_id)) {
          childrenByMaster.set(child.master_code_id, [])
        }
        childrenByMaster.get(child.master_code_id)!.push(child)
      })

      masterRecords.forEach(master => {
        const masterKey = normalize(master.master_code)
        const children = childrenByMaster.get(master.id) || []
        const hasMasterMatch = masterKey === normalizedProductTarget
        const hasProductMatch = children.some(child => {
          const variant = Array.isArray(child.product_variants) ? child.product_variants[0] : child.product_variants
          const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
          const label = buildProductLabel(product?.product_name, variant?.variant_name)
          return label && normalize(label) === normalizedProductTarget
        })

        if (!hasMasterMatch && !hasProductMatch) {
          return
        }

        // Include children with warehouse_packed OR shipped_distributor status
        // Users should be able to unlink already-shipped items
        const unlinkableChildren = children.filter(child => 
          child.status === 'warehouse_packed' || child.status === 'shipped_distributor'
        )
        unlinkableChildren.forEach(child => codesToUnlinkSet.add(child.code))

        const fallbackUnitCount =
          unlinkableChildren.length > 0
            ? unlinkableChildren.length
            : (master.actual_unit_count || master.expected_unit_count || children.length || 0)

        mastersToUnlink.push({
          id: master.id,
          master_code: master.master_code,
          status: master.status,
          unitCount: fallbackUnitCount,
          childCodes: unlinkableChildren.map(child => child.code)
        })
      })

      const codesToUnlink = Array.from(codesToUnlinkSet)

      if (codesToUnlink.length === 0 && mastersToUnlink.length === 0) {
        continue
      }

      console.log(`📦 Found ${codesToUnlink.length} unit codes and ${mastersToUnlink.length} master cases to unlink in session ${session.id}`)

      if (codesToUnlink.length > 0) {
        // Update codes - handle both warehouse_packed AND shipped_distributor statuses
        // Users should be able to unlink codes even after confirmation
        const { error: updateError } = await supabase
          .from('qr_codes')
          .update({
            status: 'received_warehouse',
            current_location_org_id: session.warehouse_org_id,
            updated_at: new Date().toISOString()
          })
          .in('code', codesToUnlink)
          .in('status', ['warehouse_packed', 'shipped_distributor'])  // Support both statuses

        if (updateError) {
          console.error('Error updating QR codes:', updateError)
          continue
        }
        
        console.log(`✅ Updated ${codesToUnlink.length} unique codes to received_warehouse`)
      }

      // Update master codes - handle both warehouse_packed AND shipped_distributor
      const masterIdsToUpdate = mastersToUnlink
        .filter(master => master.status === 'warehouse_packed' || master.status === 'shipped_distributor')
        .map(master => master.id)

      if (masterIdsToUpdate.length > 0) {
        const { error: masterError } = await supabase
          .from('qr_master_codes')
          .update({
            status: 'received_warehouse',
            shipped_to_distributor_id: null,
            updated_at: new Date().toISOString()
          })
          .in('id', masterIdsToUpdate)
          .in('status', ['warehouse_packed', 'shipped_distributor'])  // Support both statuses

        if (masterError) {
          console.warn('Warning updating master codes:', masterError)
        } else {
          console.log(`✅ Updated ${masterIdsToUpdate.length} master codes to received_warehouse`)
        }
      }

      const normalizedMasterRemovalSet = new Set(
        mastersToUnlink.map(master => normalize(master.master_code))
      )
      const updatedMasterCodes = masterCodes.filter(
        (mc: string) => !normalizedMasterRemovalSet.has(normalize(mc))
      )
      const updatedUniqueCodes = uniqueCodes.filter((uc: string) => !codesToUnlinkSet.has(uc))

      const { error: sessionUpdateError } = await supabase
        .from('qr_validation_reports')
        .update({
          master_codes_scanned: updatedMasterCodes,
          unique_codes_scanned: updatedUniqueCodes,
          updated_at: new Date().toISOString()
        })
        .eq('id', session.id)

      if (sessionUpdateError) {
        console.error('Error updating session:', sessionUpdateError)
        continue
      }

      const uniqueUnitsRemoved = codesToUnlink.length
      const masterUnitsFallback = mastersToUnlink.reduce((sum, master) => {
        if (master.childCodes.length > 0) {
          return sum
        }
        return sum + master.unitCount
      }, 0)

      totalUnlinked += uniqueUnitsRemoved + masterUnitsFallback
    }

    // Handle warehouse_packed entries without sessions (unshipped)
    for (const fakeId of unshippedEntries) {
      const masterId = fakeId.replace('unshipped-', '')

      const { data: masterRecord, error: masterFetchError } = await supabase
        .from('qr_master_codes')
        .select('id, master_code, status, warehouse_org_id, actual_unit_count, expected_unit_count')
        .eq('id', masterId)
        .single()

      if (masterFetchError || !masterRecord) {
        console.error('Error loading master record for unlink:', masterFetchError)
        continue
      }

      if (masterRecord.status !== 'warehouse_packed') {
        continue
      }

      const { data: childCodes, error: childError } = await supabase
        .from('qr_codes')
        .select(`
          code,
          status,
          product_variants (
            variant_name,
            products (
              product_name
            )
          )
        `)
        .eq('master_code_id', masterId)

      if (childError) {
        console.error('Error loading child codes for unshipped master:', childError)
        continue
      }

      // Include children with warehouse_packed OR shipped_distributor status
      const unlinkableChildren = (childCodes || []).filter(child => 
        child.status === 'warehouse_packed' || child.status === 'shipped_distributor'
      )

      const matchingUnitCodes: string[] = []

      unlinkableChildren.forEach(child => {
        const variant = Array.isArray(child.product_variants) ? child.product_variants[0] : child.product_variants
        const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
        const label = buildProductLabel(product?.product_name, variant?.variant_name)
        if (label && normalize(label) === normalizedProductTarget) {
          matchingUnitCodes.push(child.code)
        }
      })

      const masterMatches = normalize(masterRecord.master_code) === normalizedProductTarget

      if (matchingUnitCodes.length === 0 && masterMatches) {
        matchingUnitCodes.push(...unlinkableChildren.map(child => child.code))
      }

      const fallbackUnitCount =
        matchingUnitCodes.length > 0
          ? matchingUnitCodes.length
          : masterMatches
            ? (masterRecord.actual_unit_count || masterRecord.expected_unit_count || unlinkableChildren.length || 0)
            : 0

      if (matchingUnitCodes.length === 0 && !masterMatches) {
        continue
      }

      if (matchingUnitCodes.length > 0) {
        // Update unshipped codes - handle both warehouse_packed AND shipped_distributor
        const { error: unshippedUpdateError } = await supabase
          .from('qr_codes')
          .update({
            status: 'received_warehouse',
            current_location_org_id: masterRecord.warehouse_org_id,
            updated_at: new Date().toISOString()
          })
          .in('code', matchingUnitCodes)
          .in('status', ['warehouse_packed', 'shipped_distributor'])  // Support both statuses

        if (unshippedUpdateError) {
          console.error('Error updating unshipped codes:', unshippedUpdateError)
          continue
        }
        
        console.log(`✅ Updated ${matchingUnitCodes.length} unshipped codes to received_warehouse`)
      }

      // Update master status - allow unlinking from both warehouse_packed AND shipped_distributor
      const shouldUpdateMasterStatus = (masterRecord.status === 'warehouse_packed' || masterRecord.status === 'shipped_distributor') && (masterMatches || matchingUnitCodes.length > 0)

      if (shouldUpdateMasterStatus) {
        const { error: unshippedMasterUpdateError } = await supabase
          .from('qr_master_codes')
          .update({
            status: 'received_warehouse',
            shipped_to_distributor_id: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', masterId)
          .in('status', ['warehouse_packed', 'shipped_distributor'])  // Support both statuses

        if (unshippedMasterUpdateError) {
          console.warn('Warning updating unshipped master code:', unshippedMasterUpdateError)
        } else {
          console.log(`✅ Updated unshipped master code to received_warehouse`)
        }
      }

      totalUnlinked += fallbackUnitCount
    }

    console.log(`✅ Successfully unlinked ${totalUnlinked} codes`)

    return NextResponse.json({
      success: true,
      message: `Successfully unlinked ${totalUnlinked} units of ${product_name}`,
      unlinked_count: totalUnlinked
    })

  } catch (error: any) {
    console.error('Error unlinking product:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
