import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

type PaymentRequestRow = {
  id: string
  status: string
}

type PaymentDocumentRow = {
  doc_no: string | null
}
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const [{ data: userOrgId, error: orgIdError }, { data: isHQAdminFlag, error: isHQAdminError }, { data: isPowerUserFlag, error: isPowerUserError }] = await Promise.all([
      supabase.rpc('current_user_org_id'),
      supabase.rpc('is_hq_admin'),
      supabase.rpc('is_power_user')
    ])

    if (orgIdError) {
      console.error('Error resolving current user org:', orgIdError)
    }

    if (isHQAdminError) {
      console.error('Error checking HQ admin flag:', isHQAdminError)
    }

    if (isPowerUserError) {
      console.error('Error checking power user flag:', isPowerUserError)
    }

    let orgType: string | null = null
    if (userOrgId) {
      const { data: fetchedOrgType, error: orgTypeError } = await supabase.rpc('get_org_type', {
        p_org_id: userOrgId
      } as any)

      if (orgTypeError) {
        console.error('Error fetching org type:', orgTypeError)
      } else if (typeof fetchedOrgType === 'string') {
        orgType = fetchedOrgType
      }
    }

    const isHQOrg = (orgType ?? '').toUpperCase() === 'HQ'
    const isPowerUser = Boolean(isPowerUserFlag)
    const isHQAdmin = Boolean(isHQAdminFlag)

    if (!isHQOrg || !(isHQAdmin || isPowerUser)) {
      return NextResponse.json(
        { error: 'Only HQ Admin or Power User can approve payment requests' },
        { status: 403 }
      )
    }

  const { id: requestId } = await context.params

    const adminSupabase = createAdminClient()

    // Verify the payment request exists and is pending
    const { data: paymentRequest, error: fetchError } = await adminSupabase
      .from('documents')
      .select('id, status')
      .eq('id', requestId)
      .eq('doc_type', 'PAYMENT_REQUEST')
      .maybeSingle()

    const paymentRequestRow = paymentRequest as PaymentRequestRow | null

    if (fetchError || !paymentRequestRow) {
      if (fetchError) {
        console.error('Error fetching payment request with admin client:', fetchError)
      }
      return NextResponse.json(
        { error: 'Payment request not found' },
        { status: 404 }
      )
    }

    if (paymentRequestRow.status !== 'pending') {
      return NextResponse.json(
        { error: `Payment request is already ${paymentRequestRow.status}` },
        { status: 400 }
      )
    }

    const { data: attachment, error: attachmentError } = await adminSupabase
      .from('document_files')
      .select('id')
      .eq('document_id', requestId)
      .limit(1)
      .maybeSingle()

    if (attachmentError) {
      console.error('Error verifying balance payment attachment:', attachmentError)
      return NextResponse.json(
        { error: 'Unable to verify required payment document. Please try again.' },
        { status: 500 }
      )
    }

    if (!attachment) {
      return NextResponse.json(
        { error: 'Attach the final 50% payment document before approving this request.' },
        { status: 400 }
      )
    }

    // Call the database function to approve the payment request
    const { data: result, error: approveError } = await supabase
      .rpc('approve_payment_request', {
        p_request_id: requestId
      } as any)

    if (approveError) {
      console.error('Error approving payment request:', approveError)
      return NextResponse.json(
        { error: approveError.message || 'Failed to approve payment request' },
        { status: 500 }
      )
    }

    // The function returns the new payment document ID
    const paymentId = result

    // Fetch the newly created payment document
    const { data: paymentDoc, error: paymentError } = await adminSupabase
      .from('documents')
      .select('doc_no')
      .eq('id', paymentId)
      .maybeSingle()

    const paymentDocRow = paymentDoc as PaymentDocumentRow | null

    if (paymentError) {
      console.error('Error fetching payment document with admin client:', paymentError)
    }

    return NextResponse.json({
      success: true,
      request_id: requestId,
      payment_id: paymentId,
      payment_doc_no: paymentDocRow?.doc_no || null,
      message: 'Balance payment request approved successfully'
    })

  } catch (error: any) {
    console.error('Error in approve payment request API:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
