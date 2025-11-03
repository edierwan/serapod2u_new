// Test warehouse user permissions
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://hsvmvmurvpqcdmxckhnz.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzdm12bXVydnBxY2RteGNraG56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjcyNzUwNTEsImV4cCI6MjA0Mjg1MTA1MX0.0n0-PWJZ_iGOvZurcxJr9-9XPEVaNnAM0tptzx1Oo6g'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testPermissions() {
  console.log('Testing warehouse user permissions...\n')
  
  // You need to be logged in as warehouse user
  // Replace with actual warehouse credentials
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'ware@dev.com', // Replace with actual warehouse email
    password: 'password' // Replace with actual password
  })
  
  if (authError) {
    console.error('❌ Login failed:', authError.message)
    return
  }
  
  console.log('✅ Logged in as:', authData.user.email)
  console.log()
  
  // Test 1: Can query qr_master_codes?
  console.log('Test 1: Query qr_master_codes')
  const { data: masterData, error: masterError } = await supabase
    .from('qr_master_codes')
    .select('id, master_code, status')
    .limit(1)
  
  if (masterError) {
    console.error('❌ Error querying qr_master_codes:', masterError.message, masterError.code)
  } else {
    console.log('✅ Can query qr_master_codes:', masterData?.length || 0, 'records')
  }
  console.log()
  
  // Test 2: Can query qr_codes?
  console.log('Test 2: Query qr_codes')
  const { data: codeData, error: codeError } = await supabase
    .from('qr_codes')
    .select('id, code, status')
    .limit(1)
  
  if (codeError) {
    console.error('❌ Error querying qr_codes:', codeError.message, codeError.code)
  } else {
    console.log('✅ Can query qr_codes:', codeData?.length || 0, 'records')
  }
  console.log()
  
  // Test 3: Can query qr_validation_reports?
  console.log('Test 3: Query qr_validation_reports')
  const { data: reportData, error: reportError } = await supabase
    .from('qr_validation_reports')
    .select('id, validation_status')
    .limit(1)
  
  if (reportError) {
    console.error('❌ Error querying qr_validation_reports:', reportError.message, reportError.code)
  } else {
    console.log('✅ Can query qr_validation_reports:', reportData?.length || 0, 'records')
  }
  
  console.log('\n=== Summary ===')
  console.log('If you see 403/PGRST301 errors, the RLS policies are blocking access.')
  console.log('This means the database security settings need to be updated.')
}

testPermissions()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Fatal error:', e)
    process.exit(1)
  })
