
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

// Load env from app/.env.local
dotenv.config({ path: path.resolve(__dirname, '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing credentials. Ensure app/.env.local exists and has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function applyMigration() {
  const migrationPath = path.resolve(__dirname, '../update_admin_redemptions_view.sql')
  const sql = fs.readFileSync(migrationPath, 'utf8')

  console.log('Applying migration...')
  const { error } = await supabase.rpc('exec_sql', { sql })

  if (error) {
    console.error('Migration failed:', error)
    // Fallback: try splitting by statement if exec_sql doesn't support multiple statements well
    // But usually it does.
  } else {
    console.log('Migration applied successfully!')
  }
}

applyMigration()
