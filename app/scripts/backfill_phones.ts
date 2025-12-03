import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

// Load env vars
const envPath = fs.existsSync('.env.local') 
  ? '.env.local' 
  : path.join(process.cwd(), 'app/.env.local');

console.log(`Loading env from: ${envPath}`)
dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials. Make sure app/.env.local exists and has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function backfillPhones() {
  console.log('Starting phone number backfill...')

  // 1. Fetch all users from public.users with phone numbers
  const { data: publicUsers, error: publicError } = await supabase
    .from('users')
    .select('id, email, phone')
    .not('phone', 'is', null)
    .neq('phone', '')

  if (publicError) {
    console.error('Error fetching public users:', publicError)
    return
  }

  console.log(`Found ${publicUsers.length} users with phone numbers in public.users`)

  // 2. Process each user
  let updatedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const user of publicUsers) {
    const { id, email, phone } = user
    
    // Skip if phone is invalid or dummy
    if (!phone || phone.length < 8) {
        console.log(`Skipping invalid phone for ${email}: ${phone}`)
        skippedCount++
        continue
    }

    // Check for test accounts
    if (email.endsWith('@dev.com') || email.endsWith('@example.com') || phone.includes('123456789')) {
        console.log(`Skipping test account: ${email} (${phone})`)
        skippedCount++
        continue
    }

    try {
      // Get auth user
      const { data: { user: authUser }, error: authError } = await supabase.auth.admin.getUserById(id)

      if (authError || !authUser) {
        console.error(`Auth user not found for ${email} (${id})`)
        errorCount++
        continue
      }

      // Check if phone is already set in auth
      if (authUser.phone) {
        // console.log(`Phone already set for ${email}: ${authUser.phone}`)
        skippedCount++
        continue
      }

      // Update auth user
      console.log(`Updating phone for ${email}: ${phone}`)
      const { error: updateError } = await supabase.auth.admin.updateUserById(id, {
        phone: phone,
        phone_confirm: true // Auto-confirm since it's from our trusted DB
      })

      if (updateError) {
        console.error(`Failed to update ${email}: ${updateError.message}`)
        errorCount++
      } else {
        updatedCount++
      }

    } catch (err) {
      console.error(`Exception processing ${email}:`, err)
      errorCount++
    }
  }

  console.log('Backfill complete!')
  console.log(`Updated: ${updatedCount}`)
  console.log(`Skipped: ${skippedCount}`)
  console.log(`Errors: ${errorCount}`)
}

backfillPhones()
