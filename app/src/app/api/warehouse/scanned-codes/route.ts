import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface ScannedCodeDetail {
  code: string
  codeType: 'master' | 'unique'
  productName: string | null
  variantName: string | null
  variantId: string | null
  quantity: number
  scannedAt: string
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const sessionId = searchParams.get('session_id')

    if (!sessionId) {
      return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
    }

    // Fetch the validation session
    const { data: session, error: sessionError } = await supabase
      .from('qr_validation_reports')
      .select('master_codes_scanned, unique_codes_scanned, scanned_quantities, created_at')
      .eq('id', sessionId)
      .maybeSingle()

    if (sessionError || !session) {
      console.error('❌ Failed to load session:', sessionError)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const masterCodes: string[] = Array.isArray(session.master_codes_scanned) ? session.master_codes_scanned : []
    const uniqueCodes: string[] = Array.isArray(session.unique_codes_scanned) ? session.unique_codes_scanned : []
    const scannedQuantities = (session.scanned_quantities || {}) as {
      per_variant?: Record<string, { units: number; cases: number }>
    }

    const details: ScannedCodeDetail[] = []

    // Process master codes
    if (masterCodes.length > 0) {
      const { data: masterData } = await supabase
        .from('qr_master_codes')
        .select(`
          master_code,
          case_number,
          actual_unit_count,
          expected_unit_count,
          qr_batches!inner (
            products!inner (
              product_name
            )
          )
        `)
        .in('master_code', masterCodes)

      for (const master of masterData || []) {
        const batch = Array.isArray(master.qr_batches)
          ? master.qr_batches[0]
          : master.qr_batches
        const product = batch ? (Array.isArray((batch as any).products) ? (batch as any).products[0] : (batch as any).products) : null

        details.push({
          code: master.master_code,
          codeType: 'master',
          productName: product?.product_name || null,
          variantName: `Case ${master.case_number || '?'}`,
          variantId: null,
          quantity: master.actual_unit_count || master.expected_unit_count || 0,
          scannedAt: session.created_at || new Date().toISOString()
        })
      }
    }

    // Process unique codes
    if (uniqueCodes.length > 0) {
      const { data: uniqueData } = await supabase
        .from('qr_codes')
        .select(`
          qr_code,
          product_variant_id,
          product_variants!inner (
            variant_name,
            products!inner (
              product_name
            )
          )
        `)
        .in('qr_code', uniqueCodes)

      for (const unique of uniqueData || []) {
        const variant = unique.product_variants
        const variantObj = Array.isArray(variant) ? variant[0] : variant
        const product = variantObj?.products
        const productObj = Array.isArray(product) ? product[0] : product

        details.push({
          code: unique.qr_code,
          codeType: 'unique',
          productName: productObj?.product_name || null,
          variantName: variantObj?.variant_name || null,
          variantId: unique.product_variant_id || null,
          quantity: 1,
          scannedAt: session.created_at || new Date().toISOString()
        })
      }
    }

    return NextResponse.json({
      session_id: sessionId,
      scanned_codes: details,
      summary: {
        total_master: masterCodes.length,
        total_unique: uniqueCodes.length,
        total_codes: details.length,
        per_variant: scannedQuantities.per_variant || {}
      }
    })
  } catch (error: any) {
    console.error('❌ Failed to fetch scanned codes:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch scanned codes' },
      { status: 500 }
    )
  }
}
