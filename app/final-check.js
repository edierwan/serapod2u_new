require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

async function check() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  
  console.log('=' .repeat(60))
  console.log('COMPREHENSIVE PHONE CHECK FOR super@dev.com')
  console.log('='.repeat(60))
  console.log('')
  
  // Method 1: List users
  const { data: { users } } = await admin.auth.admin.listUsers()
  const user1 = users.find(u => u.email === 'super@dev.com')
  
  console.log('1️⃣  Via listUsers():')
  console.log('   phone:', user1?.phone || 'null')
  console.log('   phone_confirmed_at:', user1?.phone_confirmed_at || 'null')
  console.log('')
  
  // Method 2: Get user by ID
  if (user1) {
    const { data: user2 } = await admin.auth.admin.getUserById(user1.id)
    console.log('2️⃣  Via getUserById():')
    console.log('   phone:', user2.user?.phone || 'null')
    console.log('   phone_confirmed_at:', user2.user?.phone_confirmed_at || 'null')
    console.log('')
    
    // Check identities
    console.log('3️⃣  Identities:')
    if (user2.user.identities) {
      user2.user.identities.forEach((identity, i) => {
        console.log(`   [${i}] Provider: ${identity.provider}`)
        if (identity.identity_data?.phone) {
          console.log(`       Phone: ${identity.identity_data.phone}`)
          console.log(`       Phone verified: ${identity.identity_data.phone_verified}`)
        }
      })
    }
    console.log('')
  }
  
  // Method 3: Check DB
  const { data: dbUser } = await admin
    .from('users')
    .select('phone, email')
    .eq('email', 'super@dev.com')
    .single()
  
  console.log('4️⃣  In public.users table:')
  console.log('   phone:', dbUser?.phone || 'null')
  console.log('')
  
  // Summary
  console.log('=' .repeat(60))
  console.log('SUMMARY:')
  console.log('='.repeat(60))
  
  const authPhone = user1?.phone
  const dbPhone = dbUser?.phone
  
  if (authPhone) {
    console.log('✅ auth.users.phone IS SET:', authPhone)
    console.log('   Display format: +' + authPhone)
  } else {
    console.log('❌ auth.users.phone is NULL')
  }
  
  if (dbPhone) {
    console.log('✅ public.users.phone IS SET:', dbPhone)
  } else {
    console.log('❌ public.users.phone is NULL')
  }
  
  console.log('')
  
  if (authPhone && dbPhone) {
    if (authPhone === dbPhone) {
      console.log('🎉 BOTH TABLES SYNCED CORRECTLY!')
    } else {
      console.log('⚠️  Tables OUT OF SYNC:')
      console.log('   auth:', authPhone)
      console.log('   db:', dbPhone)
    }
  }
  
  console.log('')
  console.log('If Supabase Dashboard still shows "-" or null:')
  console.log('1. Hard refresh dashboard (Cmd+Shift+R)')
  console.log('2. Clear browser cache')
  console.log('3. Open in incognito window')
  console.log('4. The data IS there - dashboard UI might be cached')
}

check().catch(console.error)
