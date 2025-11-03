// Simpler test - step by step
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://hsvmvmurvpqcdmxckhnz.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzdm12bXVydnBxY2RteGNraG56Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDUyMTg5OSwiZXhwIjoyMDc2MDk3ODk5fQ.F40dYLD1EJH0BUwrjTf277qB7JQC9aaOtevP98amVHQ'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testStep() {
  const warehouseOrgId = 'dc711574-65ac-4137-a931-69df4ec73dc6'
  
  // Test 1: Simple query without joins
  console.log('Test 1: Simple query without joins')
  const { data: test1, error: error1 } = await supabase
    .from('qr_master_codes')
    .select('id, master_code, warehouse_received_at')
    .eq('warehouse_org_id', warehouseOrgId)
    .not('warehouse_received_at', 'is', null)
  
  console.log('Result:', test1?.length || 0, 'records')
  if (error1) console.log('Error:', error1.message)
  console.log()
  
  // Test 2: With qr_batches join
  console.log('Test 2: With qr_batches!inner join')
  const { data: test2, error: error2 } = await supabase
    .from('qr_master_codes')
    .select('id, master_code, qr_batches!inner(order_id)')
    .eq('warehouse_org_id', warehouseOrgId)
    .not('warehouse_received_at', 'is', null)
  
  console.log('Result:', test2?.length || 0, 'records')
  if (error2) console.log('Error:', error2.message)
  console.log()
  
  // Test 3: With orders join
  console.log('Test 3: With orders!inner join')
  const { data: test3, error: error3 } = await supabase
    .from('qr_master_codes')
    .select('id, master_code, qr_batches!inner(order_id, orders!inner(order_no))')
    .eq('warehouse_org_id', warehouseOrgId)
    .not('warehouse_received_at', 'is', null)
  
  console.log('Result:', test3?.length || 0, 'records')
  if (error3) console.log('Error:', error3.message)
  console.log()
  
  // Test 4: With organizations join (the problematic one)
  console.log('Test 4: With organizations join')
  const { data: test4, error: error4 } = await supabase
    .from('qr_master_codes')
    .select(`
      id,
      master_code,
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
  
  console.log('Result:', test4?.length || 0, 'records')
  if (error4) console.log('Error:', error4.message)
  if (test4 && test4.length > 0) {
    console.log('Sample:', JSON.stringify(test4[0], null, 2))
  }
}

testStep().then(() => process.exit(0)).catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
