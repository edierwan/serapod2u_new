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
            
            // Helper to check if target enabled (supports new 'recipient_targets' and legacy 'type')
            const isEnabled = (target: string) => {
                if (config.recipient_targets) {
                    return !!config.recipient_targets[target]
                }
                // Legacy fallback
                if (target === 'roles') return config.type === 'roles'
                if (target === 'dynamic_org') return config.type === 'dynamic'
                if (target === 'users') return config.type === 'users'
                if (target === 'consumer') return config.include_consumer
                return false
            }

            // 1. Dynamic Organization (Manufacturer/Distributor/Warehouse)
            if (isEnabled('dynamic_org')) {
                const targetType = config.dynamic_target // e.g. manufacturer
                
                if (targetType === 'manufacturer' && order.seller_org_id) {
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
                
                if (targetType === 'distributor' && order.buyer_org_id) {
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
            
            // 2. Specific Users
            if (isEnabled('users') && config.recipient_users?.length > 0) {
                 const { data: users } = await supabase
                    .from('users')
                    .select('id, full_name, email, phone')
                    .in('id', config.recipient_users)

                 if (users) recipients.push(...users.map(u => ({ 
                    user_id: u.id,
                    full_name: u.full_name,
                    email: u.email, 
                    phone: u.phone,
                    type: 'Specific User' 
                 })))
            }

            // 3. Roles (Best effort attempt if 'role' column exists or ignore for now)
            if (isEnabled('roles') && config.roles?.length > 0) {
                 // Trying to query by role if feasible. 
                 // Assuming 'role_code' column exists on users table based on UI selection
                 const { data: users, error } = await supabase
                    .from('users')
                    .select('id, full_name, email, phone, role_code')
                    .in('role_code', config.roles)
                 
                 if (!error && users) {
                     recipients.push(...users.map(u => ({
                         user_id: u.id,
                         full_name: u.full_name,
                         email: u.email,
                         phone: u.phone,
                         type: `Role: ${u.role_code}`
                     })))
                 }
            }

            // 4. Consumer
            if ((isEnabled('consumer') || config.include_consumer) && order.consumer) {
                const consumer = order.consumer as any
                recipients.push({
                    user_id: consumer.id,
                    full_name: consumer.full_name || 'Consumer',
                    email: consumer.email,
                    phone: consumer.phone,
                    type: 'Consumer'
                })
            }
            
            // Deduplicate recipients by user_id
            const uniqueRecipients = Array.from(new Map(recipients.map(item => [item.user_id, item])).values())
            
            // Replace recipients array
            recipients.length = 0
            recipients.push(...uniqueRecipients)
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
