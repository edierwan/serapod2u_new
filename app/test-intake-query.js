// Test the exact intake history query
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://hsvmvmurvpqcdmxckhnz.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzdm12bXVydnBxY2RteGNraG56Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDUyMTg5OSwiZXhwIjoyMDc2MDk3ODk5fQ.F40dYLD1EJH0BUwrjTf277qB7JQC9aaOtevP98amVHQ'

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function testIntakeHistoryQuery() {
  const warehouseOrgId = 'dc711574-65ac-4137-a931-69df4ec73dc6'
  const startIso = '2015-11-01T00:00:00.000Z'
  const endIso = '2025-11-01T23:59:59.999Z'
  
  console.log('Testing intake history query...')
  console.log('Warehouse Org ID:', warehouseOrgId)
  console.log('Date Range:', startIso, 'to', endIso)
  console.log()

  const { data, error } = await supabase
    .from('qr_master_codes')
    .select(`
      id,
      master_code,
      warehouse_received_at,
      warehouse_org_id,
      actual_unit_count,
      expected_unit_count,
      qr_batches!inner (
        order_id,
        orders!inner (
          id,
          order_no,
          buyer_org_id,
          organizations!orders_buyer_org_id_fkey (
            org_name
          )
        )
      )
    `)
    .eq('warehouse_org_id', warehouseOrgId)
    .not('warehouse_received_at', 'is', null)
    .gte('warehouse_received_at', startIso)
    .lte('warehouse_received_at', endIso)
    .order('warehouse_received_at', { ascending: false })
    .limit(2000)

  if (error) {
    console.error('❌ Query Error:', error)
    return
  }

  console.log(`✅ Query Success! Found ${data?.length || 0} records`)
  console.log()

  if (data && data.length > 0) {
    console.log('Records:')
    data.forEach((record, index) => {
      console.log(`\n  Record ${index + 1}:`)
      console.log(`    Master Code: ${record.master_code}`)
      console.log(`    Received At: ${record.warehouse_received_at}`)
      console.log(`    Units: ${record.actual_unit_count || record.expected_unit_count || 0}`)
      
      const batches = Array.isArray(record.qr_batches) ? record.qr_batches : [record.qr_batches]
      const batch = batches[0]
      if (batch) {
        const orders = batch.orders
        const order = Array.isArray(orders) ? orders[0] : orders
        console.log(`    Order: ${order?.order_no || 'N/A'}`)
        console.log(`    Order ID: ${order?.id || batch.order_id || 'N/A'}`)
      }
    })
  } else {
    console.log('⚠️ No records found')
  }
}

testIntakeHistoryQuery()
