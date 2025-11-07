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
      const masterCodes = session.master_codes_scanned || []
      const uniqueCodes = session.unique_codes_scanned || []
      const codesToUnlinkSet = new Set<string>()
      const mastersToUnlink: { id: string, master_code: string }[] = []

      // Query QR codes to find unique/unit codes that match this product
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
            
            if (product && variant) {
              const fullProductName = `${product.product_name} - ${variant.variant_name}`
              if (fullProductName === product_name) {
                codesToUnlinkSet.add(qr.code)
              }
            }
          })
        }
      }

      // Handle master cases that match this product
      if (masterCodes.length > 0) {
        const { data: masterRecords, error: masterLookupError } = await supabase
          .from('qr_master_codes')
          .select('id, master_code, status')
          .in('master_code', masterCodes)

        if (masterLookupError) {
          console.error('Error querying master codes:', masterLookupError)
        } else if (masterRecords && masterRecords.length > 0) {
          const masterIds = masterRecords.map(record => record.id)

          const { data: childCodes, error: childError } = await supabase
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

          if (childError) {
            console.error('Error loading child codes for masters:', childError)
          } else {
            const childMap = new Map<string, any[]>()
            childCodes?.forEach(child => {
              if (!child.master_code_id) return
              if (!childMap.has(child.master_code_id)) {
                childMap.set(child.master_code_id, [])
              }
              childMap.get(child.master_code_id)!.push(child)
            })

            masterRecords.forEach(master => {
              if (master.status !== 'warehouse_packed') return
              const children = childMap.get(master.id) || []
              const matchesChild = children.some(child => {
                const variant = Array.isArray(child.product_variants) ? child.product_variants[0] : child.product_variants
                const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
                if (!product || !variant) return false
                const fullProductName = `${product.product_name} - ${variant.variant_name}`
                return fullProductName === product_name
              })

              if (matchesChild || master.master_code === product_name) {
                mastersToUnlink.push({ id: master.id, master_code: master.master_code })
                children.forEach(child => codesToUnlinkSet.add(child.code))
              }
            })
          }
        }
      }

      const codesToUnlink = Array.from(codesToUnlinkSet)

      if (codesToUnlink.length === 0 && mastersToUnlink.length === 0) {
        continue
      }

      console.log(`📦 Found ${codesToUnlink.length} unit codes and ${mastersToUnlink.length} master cases to unlink in session ${session.id}`)

      if (codesToUnlink.length > 0) {
        const { error: updateError } = await supabase
          .from('qr_codes')
          .update({
            status: 'received_warehouse',
            current_location_org_id: session.warehouse_org_id,
            updated_at: new Date().toISOString()
          })
          .in('code', codesToUnlink)
          .eq('status', 'warehouse_packed')

        if (updateError) {
          console.error('Error updating QR codes:', updateError)
          continue
        }
      }

      if (mastersToUnlink.length > 0) {
        const masterIds = mastersToUnlink.map(m => m.id)

        const { error: masterError } = await supabase
          .from('qr_master_codes')
          .update({
            status: 'received_warehouse',
            shipped_to_distributor_id: null,
            updated_at: new Date().toISOString()
          })
          .in('id', masterIds)
          .eq('status', 'warehouse_packed')

        if (masterError) {
          console.warn('Warning updating master codes:', masterError)
        }
      }

      // Remove codes from session arrays
      const updatedMasterCodes = masterCodes.filter((mc: string) => !mastersToUnlink.some(m => m.master_code === mc))
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

      totalUnlinked += codesToUnlink.length
    }

    // Handle warehouse_packed entries without sessions (unshipped)
    for (const fakeId of unshippedEntries) {
      const masterId = fakeId.replace('unshipped-', '')

      const { data: masterRecord, error: masterFetchError } = await supabase
        .from('qr_master_codes')
        .select('id, master_code, status, warehouse_org_id')
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
          product_variants (
            variant_name,
            products (
              product_name
            )
          )
        `)
        .eq('master_code_id', masterId)
        .eq('status', 'warehouse_packed')

      if (childError) {
        console.error('Error loading child codes for unshipped master:', childError)
        continue
      }

      const codesToUnlink: string[] = []

      childCodes?.forEach(child => {
        const variant = Array.isArray(child.product_variants) ? child.product_variants[0] : child.product_variants
        const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
        if (!product || !variant) return
        const fullProductName = `${product.product_name} - ${variant.variant_name}`
        if (fullProductName === product_name) {
          codesToUnlink.push(child.code)
        }
      })

      if (codesToUnlink.length === 0 && product_name === masterRecord.master_code) {
        codesToUnlink.push(...(childCodes?.map(child => child.code) || []))
      }

      if (codesToUnlink.length === 0) {
        continue
      }

      const { error: unshippedUpdateError } = await supabase
        .from('qr_codes')
        .update({
          status: 'received_warehouse',
          current_location_org_id: masterRecord.warehouse_org_id,
          updated_at: new Date().toISOString()
        })
        .in('code', codesToUnlink)
        .eq('status', 'warehouse_packed')

      if (unshippedUpdateError) {
        console.error('Error updating unshipped codes:', unshippedUpdateError)
        continue
      }

      const { error: unshippedMasterUpdateError } = await supabase
        .from('qr_master_codes')
        .update({
          status: 'received_warehouse',
          shipped_to_distributor_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', masterId)
        .eq('status', 'warehouse_packed')

      if (unshippedMasterUpdateError) {
        console.warn('Warning updating unshipped master code:', unshippedMasterUpdateError)
      }

      totalUnlinked += codesToUnlink.length
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
