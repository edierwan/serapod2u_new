import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/admin/redemptions
 * Fetch all redemption transactions for admin management
 * 
 * Query params:
 *   status?: string - Filter by fulfillment status (pending, processing, fulfilled, cancelled)
 *   shop_id?: string - Filter by specific shop
 *   limit?: number - Limit results (default 100)
 *   offset?: number - Offset for pagination
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Check if user is HQ admin
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select(`
        id,
        organization_id
      `)
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      return NextResponse.json(
        { success: false, error: 'User profile not found' },
        { status: 404 }
      )
    }

    if (!userProfile.organization_id) {
      return NextResponse.json(
        { success: false, error: 'User has no organization assigned' },
        { status: 403 }
      )
    }

    // Separately fetch organization details
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('org_type_code')
      .eq('id', userProfile.organization_id)
      .single()

    if (orgError || !org) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      )
    }

    const orgType = org.org_type_code
    if (orgType !== 'HQ' && orgType !== 'MANUFACTURER') {
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      )
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const shopId = searchParams.get('shop_id')
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build query - fetch redemption transactions with all related data
    let query = supabase
      .from('points_transactions')
      .select(`
        id,
        transaction_date,
        created_at,
        points_amount,
        balance_after,
        description,
        consumer_phone,
        consumer_email,
        company_id,
        fulfillment_status,
        fulfilled_by,
        fulfilled_at,
        fulfillment_notes,
        redemption_code,
        redeem_items!inner(
          id,
          item_name,
          item_code,
          item_image_url,
          points_required
        )
      `)
      .eq('transaction_type', 'redeem')
      .order('transaction_date', { ascending: false })
      .range(offset, offset + limit - 1)

    // Apply filters
    if (status) {
      query = query.eq('fulfillment_status', status)
    }
    if (shopId) {
      query = query.eq('company_id', shopId)
    }

    const { data: transactions, error: txnError } = await query

    if (txnError) {
      console.error('Error fetching redemptions:', txnError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch redemptions' },
        { status: 500 }
      )
    }

    // Fetch shop and staff details for each transaction
    const enrichedTransactions = await Promise.all(
      (transactions || []).map(async (txn: any) => {
        // Get shop organization details
        const { data: shopOrg } = await supabase
          .from('organizations')
          .select('id, org_name, contact_phone, contact_email, address, address_line2, city, state_id, postal_code')
          .eq('id', txn.company_id)
          .single()

        // Get staff user details (who made the redemption)
        let staffUser = null
        if (txn.consumer_phone || txn.consumer_email) {
          const { data: user } = await supabase
            .from('users')
            .select('id, full_name, email, phone')
            .or(`phone.eq.${txn.consumer_phone},email.eq.${txn.consumer_email}`)
            .single()
          staffUser = user
        }

        // Get fulfilled by user details
        let fulfilledByUser = null
        if (txn.fulfilled_by) {
          const { data: user } = await supabase
            .from('users')
            .select('id, full_name, email')
            .eq('id', txn.fulfilled_by)
            .single()
          fulfilledByUser = user
        }

        return {
          id: txn.id,
          transaction_date: txn.transaction_date,
          created_at: txn.created_at,
          points_amount: Math.abs(txn.points_amount),
          balance_after: txn.balance_after,
          description: txn.description,
          redemption_code: txn.redemption_code || `RED-${txn.id.split('-')[0].toUpperCase()}`,
          fulfillment_status: txn.fulfillment_status || 'pending',
          fulfilled_at: txn.fulfilled_at,
          fulfillment_notes: txn.fulfillment_notes,
          // Reward details
          reward: txn.redeem_items ? {
            id: txn.redeem_items.id,
            name: txn.redeem_items.item_name,
            code: txn.redeem_items.item_code,
            image_url: txn.redeem_items.item_image_url,
            points_required: txn.redeem_items.points_required
          } : null,
          // Shop details
          shop: shopOrg ? {
            id: (shopOrg as any).id,
            name: (shopOrg as any).org_name,
            phone: (shopOrg as any).contact_phone,
            email: (shopOrg as any).contact_email,
            address: [
              (shopOrg as any).address,
              (shopOrg as any).address_line2,
              (shopOrg as any).city,
              (shopOrg as any).postal_code
            ].filter(Boolean).join(', ')
          } : null,
          // Staff details
          staff: staffUser ? {
            id: (staffUser as any).id,
            name: (staffUser as any).full_name,
            email: (staffUser as any).email,
            phone: (staffUser as any).phone
          } : null,
          // Fulfilled by details
          fulfilled_by: fulfilledByUser ? {
            id: (fulfilledByUser as any).id,
            name: (fulfilledByUser as any).full_name,
            email: (fulfilledByUser as any).email
          } : null
        }
      })
    )

    // Get summary counts
    const { count: totalCount } = await supabase
      .from('points_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('transaction_type', 'redeem')

    const { count: pendingCount } = await supabase
      .from('points_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('transaction_type', 'redeem')
      .or('fulfillment_status.is.null,fulfillment_status.eq.pending')

    const { count: processingCount } = await supabase
      .from('points_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('transaction_type', 'redeem')
      .eq('fulfillment_status', 'processing')

    const { count: fulfilledCount } = await supabase
      .from('points_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('transaction_type', 'redeem')
      .eq('fulfillment_status', 'fulfilled')

    return NextResponse.json({
      success: true,
      redemptions: enrichedTransactions,
      summary: {
        total: totalCount || 0,
        pending: pendingCount || 0,
        processing: processingCount || 0,
        fulfilled: fulfilledCount || 0
      },
      pagination: {
        limit,
        offset,
        has_more: (transactions?.length || 0) === limit
      }
    })

  } catch (error) {
    console.error('Error in admin/redemptions:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/admin/redemptions
 * Update redemption fulfillment status
 * 
 * Body:
 *   transaction_id: string - The transaction ID to update
 *   status: string - New status (pending, processing, fulfilled, cancelled)
 *   notes?: string - Optional fulfillment notes
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Check if user is HQ admin
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select(`
        id,
        full_name,
<<<<<<< HEAD
        organization_id,
        organizations!inner(org_type_code)
=======
        organization_id
>>>>>>> develop
      `)
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      return NextResponse.json(
        { success: false, error: 'User profile not found' },
        { status: 404 }
      )
    }

<<<<<<< HEAD
    const orgType = (userProfile.organizations as any)?.org_type_code
=======
    if (!userProfile.organization_id) {
      return NextResponse.json(
        { success: false, error: 'User has no organization assigned' },
        { status: 403 }
      )
    }

    // Separately fetch organization details
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('org_type_code')
      .eq('id', userProfile.organization_id)
      .single()

    if (orgError || !org) {
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      )
    }

    const orgType = org.org_type_code
>>>>>>> develop
    if (orgType !== 'HQ' && orgType !== 'MANUFACTURER') {
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      )
    }

    const { transaction_id, status, notes } = await request.json()

    // Validate required fields
    if (!transaction_id) {
      return NextResponse.json(
        { success: false, error: 'Transaction ID is required' },
        { status: 400 }
      )
    }

    if (!status) {
      return NextResponse.json(
        { success: false, error: 'Status is required' },
        { status: 400 }
      )
    }

    const validStatuses = ['pending', 'processing', 'fulfilled', 'cancelled']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    // Build update object
    const updateData: any = {
      fulfillment_status: status
    }

    // Set fulfilled_by and fulfilled_at when marking as fulfilled or cancelled
    if (status === 'fulfilled' || status === 'cancelled') {
      updateData.fulfilled_by = user.id
      updateData.fulfilled_at = new Date().toISOString()
    }

    if (notes) {
      updateData.fulfillment_notes = notes
    }

    // Update the transaction
    const { data: updated, error: updateError } = await supabase
      .from('points_transactions')
      .update(updateData)
      .eq('id', transaction_id)
      .eq('transaction_type', 'redeem')
      .select()
      .single()

    if (updateError) {
      console.error('Error updating redemption:', updateError)
      return NextResponse.json(
        { success: false, error: 'Failed to update redemption status' },
        { status: 500 }
      )
    }

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Redemption not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Redemption marked as ${status}`,
      transaction: {
        id: updated.id,
        fulfillment_status: status,
        fulfilled_by: status === 'fulfilled' || status === 'cancelled' ? {
          id: user.id,
          name: userProfile.full_name
        } : null,
        fulfilled_at: updateData.fulfilled_at,
        fulfillment_notes: notes
      }
    })

  } catch (error) {
    console.error('Error in admin/redemptions PATCH:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
