import fs from 'node:fs'
import pg from 'pg'

function loadEnv(p) {
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

loadEnv('.env')
loadEnv('../.env')

const connectionString = process.env.DATABASE_POOL_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('Missing DATABASE_POOL_URL or DATABASE_URL in app/.env')
  process.exit(1)
}

const sql = fs.readFileSync(
  new URL('../../supabase/migrations/20260728_password_reset_email_otp.sql', import.meta.url),
  'utf8',
)

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
})

await client.connect()
console.log('Connected to database')

try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  console.log('Migration applied successfully')
} catch (err) {
  await client.query('ROLLBACK')
  console.error('Migration failed:', err.message)
  process.exit(1)
} finally {
  await client.end()
}

// Verify via Supabase REST
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const probe = await admin.from('auth_verification_codes').select('email_normalized').limit(1)
console.log('email_normalized column:', probe.error ? probe.error.message : 'OK')

const nt = await admin
  .from('notification_types')
  .select('event_code, available_channels')
  .eq('event_code', 'password_reset_otp')
  .maybeSingle()
console.log('password_reset_otp type:', nt.data || nt.error)
