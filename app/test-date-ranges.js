// Test with actual date ranges
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://hsvmvmurvpqcdmxckhnz.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzdm12bXVydnBxY2RteGNraG56Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDUyMTg5OSwiZXhwIjoyMDc2MDk3ODk5fQ.F40dYLD1EJH0BUwrjTf277qB7JQC9aaOtevP98amVHQ'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testDateRanges() {
  const warehouseOrgId = 'dc711574-65ac-4137-a931-69df4ec73dc6'
  
  // Get the actual timestamps
  const { data: records } = await supabase
    .from('qr_master_codes')
    .select('master_code, warehouse_received_at')
    .eq('warehouse_org_id', warehouseOrgId)
    .not('warehouse_received_at', 'is', null)
  
  console.log('Actual records:')
  records.forEach(r => {
    console.log(`  ${r.master_code}`)
    console.log(`    Received: ${r.warehouse_received_at}`)
    console.log(`    Date object: ${new Date(r.warehouse_received_at)}`)
  })
  console.log()
  
  // Test with last 30 days (default)
  const now = new Date()
  const start30 = new Date()
  start30.setDate(start30.getDate() - 29)
  start30.setHours(0, 0, 0, 0)
  const end30 = new Date()
  end30.setHours(23, 59, 59, 999)
  
  console.log('Test: last30 days')
  console.log(`  Range: ${start30.toISOString()} to ${end30.toISOString()}`)
  
  const { data: test30, error: error30 } = await supabase
    .from('qr_master_codes')
    .select('master_code, warehouse_received_at')
    .eq('warehouse_org_id', warehouseOrgId)
    .not('warehouse_received_at', 'is', null)
    .gte('warehouse_received_at', start30.toISOString())
    .lte('warehouse_received_at', end30.toISOString())
  
  console.log(`  Result: ${test30?.length || 0} records`)
  if (error30) console.log(`  Error: ${error30.message}`)
  console.log()
  
  // Test with "all" (10 years)
  const startAll = new Date()
  startAll.setFullYear(startAll.getFullYear() - 10)
  startAll.setHours(0, 0, 0, 0)
  const endAll = new Date()
  endAll.setHours(23, 59, 59, 999)
  
  console.log('Test: all (10 years)')
  console.log(`  Range: ${startAll.toISOString()} to ${endAll.toISOString()}`)
  
  const { data: testAll, error: errorAll } = await supabase
    .from('qr_master_codes')
    .select('master_code, warehouse_received_at')
    .eq('warehouse_org_id', warehouseOrgId)
    .not('warehouse_received_at', 'is', null)
    .gte('warehouse_received_at', startAll.toISOString())
    .lte('warehouse_received_at', endAll.toISOString())
  
  console.log(`  Result: ${testAll?.length || 0} records`)
  if (errorAll) console.log(`  Error: ${errorAll.message}`)
}

testDateRanges().then(() => process.exit(0)).catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
