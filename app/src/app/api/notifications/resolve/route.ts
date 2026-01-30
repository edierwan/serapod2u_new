import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const eventCode = searchParams.get('eventCode')
  // We use 'sampleId' generic param, but it could be orderId, sku, etc.
  const sampleId = searchParams.get('sampleId') 
  const recipientConfigStr = searchParams.get('recipientConfig')
  
  if (!eventCode) {
    return NextResponse.json({ error: 'Missing eventCode' }, { status: 400 })
  }

  const supabase = await createClient()
  
  try {
    let recipientConfig = {}
    if (recipientConfigStr) {
        try { recipientConfig = JSON.parse(recipientConfigStr) } catch(e) {}
    }

    const recipients = []
    
    // Mock sample data if no sampleId provided, or resolve real data
    // Case 1: Order Events
    if (eventCode.startsWith('order') && sampleId) {
        // Fetch order to get relations
        const { data: order } = await supabase
            .from('orders')
            .select('*, consumer:users!orders_created_by_fkey(*)')
            .or(`order_no.eq.${sampleId},id.eq.${sampleId}`)
            .single()
            
        if (order) {
            // Logic based on recipientConfig
            const config = recipientConfig as any
            
            // 1. Dynamic Manufacturer (Mapped to Seller)
            if (config.type === 'dynamic' && config.dynamic_target === 'manufacturer') {
                if (order.seller_org_id) {
                    // Fetch users of this org
                    const { data: users } = await supabase
                        .from('users')
                        .select('id, full_name, email, phone')
                        .eq('organization_id', order.seller_org_id)
                    
                    if (users) recipients.push(...users.map(u => ({ 
                        user_id: u.id,
                        full_name: u.full_name,
                        email: u.email,
                        phone: u.phone,
                        type: 'Manufacturer Staff' 
                    })))
                }
            }
            
            // 2. Dynamic Distributor (Mapped to Buyer)
            if (config.type === 'dynamic' && config.dynamic_target === 'distributor') {
                 if (order.buyer_org_id) {
                    const { data: users } = await supabase
                        .from('users')
                        .select('id, full_name, email, phone')
                        .eq('organization_id', order.buyer_org_id)
                        
                     if (users) recipients.push(...users.map(u => ({ 
                        user_id: u.id,
                        full_name: u.full_name,
                        email: u.email,
                        phone: u.phone,
                        type: 'Distributor Staff' 
                    })))
                 }
            }

            // 3. Consumer
            if (config.include_consumer && order.consumer) {
                // Supabase joint result 'consumer' is single object or array depending on relation? 
                // Using single() on main query, OneToOne on relation?
                // orders_created_by_fkey is Many-to-One (Many orders, One User). So consumer is single object.
                const consumer = order.consumer as any
                recipients.push({
                    user_id: consumer.id,
                    full_name: consumer.full_name || 'Consumer',
                    email: consumer.email,
                    phone: consumer.phone,
                    type: 'Consumer'
                })
            }
        }
    }  
    
    // Fallback/Mock for preview if real resolution returns empty or for other events
    if (recipients.length === 0) {
        // Return dummy data for UI preview purposes if we can't resolve real data
        recipients.push(
            { user_id: 'mock-1', full_name: 'Alice Manager', email: 'alice@manufacturer.com', phone: '+60123456789', type: 'Manufacturer Admin' },
            { user_id: 'mock-2', full_name: 'Bob Warehouse', email: 'bob@warehouse.com', phone: '+60198765432', type: 'Warehouse Staff' }
        )
    }

    return NextResponse.json({ success: true, recipients })

  } catch (error: any) {
    console.error('Resolve error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
