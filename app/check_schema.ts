
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Adjust path to .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.log('Missing credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function test() {
  // We can't use exec_sql if it's not defined. 
  // But we can use the service role to query pg_catalog or information_schema if exposed?
  // Usually not exposed via API.
  // But we can try to insert a dummy record and see the error?
  // Or just assume org_id is NOT NULL based on typical design.
  
  // Let's try to use the exec_sql RPC if it exists (the file name test_exec_sql.ts suggests it might)
  const { data, error } = await supabase.rpc('exec_sql', { 
      sql: "SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'scratch_card_campaigns'" 
  })

  if (error) {
    console.log('RPC error:', error)
  } else {
    console.log('Schema:', JSON.stringify(data, null, 2))
  }
}

test()
