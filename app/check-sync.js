require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const testEmail = 'super@dev.com'
  
  // Get from auth.users
  const { data: { users } } = await admin.auth.admin.listUsers()
  const authUser = users.find(u => u.email === testEmail)
  
  // Get from public.users
  const { data: dbUser } = await admin
    .from('users')
    .select('phone')
    .eq('email', testEmail)
    .single()
  
  console.log('🔍 Sync Check:')
  console.log('   auth.users.phone:', authUser?.phone || '(empty)')
  console.log('   public.users.phone:', dbUser?.phone || '(empty)')
  console.log('')
  console.log('   Match:', authUser?.phone === dbUser?.phone ? '✅' : '❌')
}

main().catch(console.error)
