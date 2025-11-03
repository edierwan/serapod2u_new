// Check warehouse_received_at records
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://hsvmvmurvpqcdmxckhnz.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzdm12bXVydnBxY2RteGNraG56Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDUyMTg5OSwiZXhwIjoyMDc2MDk3ODk5fQ.F40dYLD1EJH0BUwrjTf277qB7JQC9aaOtevP98amVHQ'

console.log('🔍 Checking warehouse_received_at records...\n')

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function checkWarehouseData() {
  try {
    // Query 1: Count all master codes with warehouse_received_at
    console.log('=== Query 1: Total master codes with warehouse_received_at ===')
    const { count, error: countError } = await supabase
      .from('qr_master_codes')
      .select('*', { count: 'exact', head: true })
      .not('warehouse_received_at', 'is', null)

    if (countError) {
      console.error('❌ Error:', countError.message)
    } else {
      console.log(`✅ Total records with warehouse_received_at: ${count}`)
    }
    console.log('')

    // Query 2: Get actual records
    console.log('=== Query 2: Actual records with warehouse_received_at ===')
    const { data, error } = await supabase
      .from('qr_master_codes')
      .select('master_code, status, warehouse_org_id, warehouse_received_at')
      .not('warehouse_received_at', 'is', null)
      .order('warehouse_received_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('❌ Error:', error.message)
    } else if (data && data.length > 0) {
      console.log(`✅ Found ${data.length} records:`)
      data.forEach((record, index) => {
        console.log(`\n  Record ${index + 1}:`)
        console.log(`    Master Code: ${record.master_code}`)
        console.log(`    Status: ${record.status}`)
        console.log(`    Warehouse Org ID: ${record.warehouse_org_id}`)
        console.log(`    Received At: ${record.warehouse_received_at}`)
      })
    } else {
      console.log('⚠️ No records found with warehouse_received_at set')
    }
    console.log('')

    // Query 3: Check master codes that SHOULD be receivable
    console.log('=== Query 3: Master codes ready to be received ===')
    const { data: ready, error: readyError } = await supabase
      .from('qr_master_codes')
      .select('master_code, status, warehouse_org_id')
      .in('status', ['packed', 'ready_to_ship'])
      .limit(10)

    if (readyError) {
      console.error('❌ Error:', readyError.message)
    } else if (ready && ready.length > 0) {
      console.log(`✅ Found ${ready.length} master codes ready to be received:`)
      ready.forEach((record, index) => {
        console.log(`\n  Record ${index + 1}:`)
        console.log(`    Master Code: ${record.master_code}`)
        console.log(`    Status: ${record.status}`)
        console.log(`    Warehouse Org ID: ${record.warehouse_org_id || 'NULL'}`)
      })
    } else {
      console.log('⚠️ No master codes in packed/ready_to_ship status')
    }
    console.log('')

    // Query 4: Check ALL master codes status distribution
    console.log('=== Query 4: Status distribution of all master codes ===')
    const { data: allStatus, error: statusError } = await supabase
      .from('qr_master_codes')
      .select('status')

    if (statusError) {
      console.error('❌ Error:', statusError.message)
    } else if (allStatus) {
      const statusCounts = {}
      allStatus.forEach(record => {
        const status = record.status || 'null'
        statusCounts[status] = (statusCounts[status] || 0) + 1
      })
      console.log('✅ Status distribution:')
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`    ${status}: ${count}`)
      })
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error.message)
  }
}

checkWarehouseData()
