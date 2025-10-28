import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type ScannedQuantities = {
  total_units: number
  total_cases: number
  per_variant: Record<string, { units: number; cases: number }>
}

type DiscrepancyDetails = {
  inventory_shortfalls?: Array<{
    code: string
    variant_id: string
    expected_units: number
    removed_units: number
    shortfall: number
  }>
  warnings?: string[]
}

type ExpectedSummary = {
  master_cases_available?: number
  units_available?: number
  generated_at?: string
  [key: string]: unknown
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      shipment_session_id: sessionId,
      approve_discrepancy: approveDiscrepancy = false,
      approval_notes: approvalNotes,
      user_id: overrideUserId
    } = body || {}

    if (!sessionId) {
      return NextResponse.json({ message: 'shipment_session_id is required' }, { status: 400 })
    }

    const { data: session, error: sessionError } = await supabase
      .from('qr_validation_reports')
      .select(
        `id,
         validation_status,
         scanned_quantities,
         expected_quantities,
         discrepancy_details,
         is_matched,
         approved_by,
         approved_at,
         created_by`
      )
      .eq('id', sessionId)
      .maybeSingle()

    if (sessionError) {
      console.error('❌ Failed to load shipment session for completion:', sessionError)
      return NextResponse.json(
        { message: 'Failed to load shipment session', details: sessionError },
        { status: 500 }
      )
    }

    if (!session) {
      return NextResponse.json({ message: 'Shipment session not found' }, { status: 404 })
    }

    const scannedSummary = (session.scanned_quantities as ScannedQuantities) || {
      total_units: 0,
      total_cases: 0,
      per_variant: {}
    }
    const expectedSummary = (session.expected_quantities as ExpectedSummary) || {}
    const discrepancyDetails = (session.discrepancy_details as DiscrepancyDetails) || {}

    const hasShortfalls = Boolean(discrepancyDetails.inventory_shortfalls?.length)
    const hasWarnings = Boolean(discrepancyDetails.warnings?.length)
    const hasAnyDiscrepancy = hasShortfalls || hasWarnings

    const currentStatus = session.validation_status
    const requestingUserId = overrideUserId || user.id

    if (currentStatus === 'approved') {
      return NextResponse.json(
        {
          success: true,
          shipment_session_id: sessionId,
          validation_status: currentStatus,
          approved: true,
          message: 'Shipment session already approved',
          scanned_summary: scannedSummary,
          expected_summary: expectedSummary,
          discrepancy_details: discrepancyDetails
        },
        { status: 200 }
      )
    }

    if (currentStatus === 'matched' && !hasAnyDiscrepancy && !approveDiscrepancy) {
      return NextResponse.json(
        {
          success: true,
          shipment_session_id: sessionId,
          validation_status: currentStatus,
          approved: false,
          message: 'Shipment session already marked as matched',
          scanned_summary: scannedSummary,
          expected_summary: expectedSummary,
          discrepancy_details: discrepancyDetails
        },
        { status: 200 }
      )
    }

    let nextStatus = currentStatus
    let approvedBy: string | null = null
    let approvedAt: string | null = null
    let isMatched = session.is_matched

    if (!hasAnyDiscrepancy) {
      nextStatus = 'matched'
      isMatched = true
    } else if (approveDiscrepancy) {
      nextStatus = 'approved'
      approvedBy = requestingUserId
      approvedAt = new Date().toISOString()
      isMatched = false
    } else {
      nextStatus = 'discrepancy'
      isMatched = false
    }

    const updates: Record<string, any> = {
      validation_status: nextStatus,
      is_matched: isMatched,
      updated_at: new Date().toISOString()
    }

    if (approvedBy) {
      updates.approved_by = approvedBy
      updates.approved_at = approvedAt
      updates.approval_notes = approvalNotes || null
    } else {
      updates.approved_by = null
      updates.approved_at = null
      updates.approval_notes = approvalNotes || null
    }

    const { error: updateError } = await supabase
      .from('qr_validation_reports')
      .update(updates)
      .eq('id', sessionId)

    if (updateError) {
      console.error('❌ Failed to complete shipment session:', updateError)
      return NextResponse.json(
        { message: 'Failed to complete shipment session', details: updateError },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      shipment_session_id: sessionId,
      validation_status: nextStatus,
      approved: nextStatus === 'approved',
      has_discrepancy: hasAnyDiscrepancy,
      scanned_summary: scannedSummary,
      expected_summary: expectedSummary,
      discrepancy_details: discrepancyDetails,
      message:
        nextStatus === 'approved'
          ? 'Shipment discrepancies approved'
          : nextStatus === 'matched'
            ? 'Shipment validated with no discrepancies'
            : 'Shipment completed with outstanding discrepancies'
    })
  } catch (error: any) {
    console.error('❌ Warehouse shipment completion error:', error)
    return NextResponse.json(
      { message: error?.message || 'Failed to complete shipment session', details: error },
      { status: error?.status || 500 }
    )
  }
}
