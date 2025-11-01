// Check current logged in user's organization
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://hsvmvmurvpqcdmxckhnz.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzdm12bXVydnBxY2RteGNraG56Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDUyMTg5OSwiZXhwIjoyMDc2MDk3ODk5fQ.F40dYLD1EJH0BUwrjTf277qB7JQC9aaOtevP98amVHQ'

console.log('🔍 Checking warehouse organizations...\n')

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function checkOrganizations() {
  try {
    // Get all organizations and their types
    console.log('=== All Organizations ===')
    const { data: orgs, error: orgError } = await supabase
      .from('organizations')
      .select('id, org_name, org_type_code')
      .order('org_name')

    if (orgError) {
      console.error('❌ Error:', orgError.message)
      return
    }

    console.log(`Found ${orgs.length} organizations:\n`)
    orgs.forEach(org => {
      console.log(`  ${org.org_name} (${org.org_type_code})`)
      console.log(`    ID: ${org.id}`)
      console.log()
    })

    // Find the warehouse org that has the received data
    const targetWarehouseId = 'dc711574-65ac-4137-a931-69df4ec73dc6'
    const targetWarehouse = orgs.find(o => o.id === targetWarehouseId)
    
    if (targetWarehouse) {
      console.log('=== Target Warehouse (with received data) ===')
      console.log(`  Name: ${targetWarehouse.org_name}`)
      console.log(`  Type: ${targetWarehouse.org_type_code}`)
      console.log(`  ID: ${targetWarehouse.id}`)
      console.log()
    }

    // Get users and their organizations
    console.log('=== Users and Their Organizations ===')
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, email, full_name, organization_id, role_code')
      .order('email')

    if (userError) {
      console.error('❌ Error:', userError.message)
      return
    }

    users.forEach(user => {
      const userOrg = orgs.find(o => o.id === user.organization_id)
      const matchesWarehouse = user.organization_id === targetWarehouseId
      console.log(`  ${user.email} (${user.role_code})`)
      console.log(`    Organization: ${userOrg?.org_name || 'NULL'}`)
      console.log(`    Org ID: ${user.organization_id || 'NULL'}`)
      if (matchesWarehouse) {
        console.log(`    ✅ MATCHES warehouse with received data!`)
      }
      console.log()
    })

  } catch (error) {
    console.error('❌ Unexpected error:', error.message)
  }
}

checkOrganizations()
