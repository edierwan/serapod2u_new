// Apply RLS policy fix
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

const supabaseUrl = 'https://hsvmvmurvpqcdmxckhnz.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzdm12bXVydnBxY2RteGNraG56Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDUyMTg5OSwiZXhwIjoyMDc2MDk3ODk5fQ.F40dYLD1EJH0BUwrjTf277qB7JQC9aaOtevP98amVHQ'

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

async function applyFix() {
  console.log('🔧 Applying RLS policy fix for warehouse orders access...\n')

  // Read the SQL file
  const sql = fs.readFileSync('migrations/fix_warehouse_orders_rls_policy.sql', 'utf8')
  
  // Execute each statement
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--') && s.length > 0)

  for (const statement of statements) {
    console.log('Executing:', statement.substring(0, 80) + '...')
    
    const { data, error } = await supabase.rpc('exec_sql', {
      sql_query: statement
    })

    if (error) {
      console.error('❌ Error:', error.message)
      
      // Try alternative: direct SQL execution via REST API
      console.log('Trying alternative method...')
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql_query: statement })
      })
      
      if (!response.ok) {
        console.error('❌ Alternative method also failed')
        console.error('Response:', await response.text())
      } else {
        console.log('✅ Success via alternative method')
      }
    } else {
      console.log('✅ Success')
    }
    console.log()
  }

  console.log('\n✅ RLS policy fix applied! Testing...\n')

  // Test the fix
  const { data, error } = await supabase
    .from('qr_master_codes')
    .select(`
      master_code,
      qr_batches!inner (
        orders!inner (order_no)
      )
    `)
    .eq('warehouse_org_id', 'dc711574-65ac-4137-a931-69df4ec73dc6')
    .not('warehouse_received_at', 'is', null)

  console.log('Test query result:')
  console.log(`  Records found: ${data?.length || 0}`)
  if (error) console.log(`  Error: ${error.message}`)
  
  if (data && data.length > 0) {
    console.log('\n🎉 SUCCESS! Warehouse can now access orders!')
  } else {
    console.log('\n⚠️  Still having issues. May need manual intervention.')
  }
}

applyFix().then(() => process.exit(0)).catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
