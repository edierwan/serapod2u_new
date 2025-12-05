
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

// Load env from app/.env.local
dotenv.config({ path: path.resolve(__dirname, '../app/.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing credentials. Ensure app/.env.local exists and has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function applyMigration() {
  const migrationPath = path.resolve(__dirname, '../supabase/migrations/084_fix_stock_adjustment_trigger.sql')
  const sql = fs.readFileSync(migrationPath, 'utf8')

  console.log('Applying migration...')
  const { error } = await supabase.rpc('exec_sql', { sql })

  if (error) {
    console.error('Migration failed:', error)
  } else {
    console.log('Migration applied successfully!')
  }
}

applyMigration()
