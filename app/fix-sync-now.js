require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const testEmail = 'super@dev.com'
  const testPhone = '60132277231' // Format without +
  
  console.log('🔧 Syncing phone for:', testEmail)
  console.log('   Target phone:', testPhone, '(display: +' + testPhone + ')')
  
  // Get user
  const { data: { users } } = await admin.auth.admin.listUsers()
  const user = users.find(u => u.email === testEmail)
  
  if (!user) {
    console.error('❌ User not found')
    process.exit(1)
  }
  
  // Update auth.users
  console.log('\n1️⃣ Updating auth.users...')
  const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
    phone: testPhone,
    phone_confirm: true
  })
  
  if (authError) {
    console.error('❌ Auth update failed:', authError)
    process.exit(1)
  }
  console.log('✅ auth.users updated')
  
  // Update public.users
  console.log('\n2️⃣ Updating public.users...')
  const { error: dbError } = await admin
    .from('users')
    .update({ phone: testPhone })
    .eq('id', user.id)
  
  if (dbError) {
    console.error('❌ DB update failed:', dbError)
    process.exit(1)
  }
  console.log('✅ public.users updated')
  
  // Verify
  console.log('\n3️⃣ Verifying sync...')
  const { data: authData } = await admin.auth.admin.getUserById(user.id)
  const { data: dbData } = await admin
    .from('users')
    .select('phone')
    .eq('id', user.id)
    .single()
  
  console.log('   auth.users.phone:', authData.user.phone)
  console.log('   public.users.phone:', dbData.phone)
  console.log('   Match:', authData.user.phone === dbData.phone ? '✅' : '❌')
  
  if (authData.user.phone === dbData.phone && authData.user.phone === testPhone) {
    console.log('\n�� SUCCESS! Both tables synced correctly')
    console.log('   Display format: +' + testPhone)
  } else {
    console.log('\n❌ Still out of sync!')
  }
}

main().catch(console.error)
