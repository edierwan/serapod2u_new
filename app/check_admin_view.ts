
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// Load env vars manually
try {
  const envPath = path.resolve(__dirname, '.env.local')
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8')
    envConfig.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/)
      if (match) {
        const key = match[1].trim()
        const value = match[2].trim().replace(/^["']|["']$/g, '')
        process.env[key] = value
      }
    })
  }
} catch (e) {
  console.error('Error loading .env.local', e)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkAdminView() {
  // 1. Get super@dev.com user and organization
  const { data: users, error: userError } = await supabase
    .from('users')
    .select('id, email, organization_id')
    .eq('email', 'super@dev.com')
  
  if (userError || !users || users.length === 0) {
    console.error('Error fetching user:', userError)
    return
  }

  const adminUser = users[0]
  console.log('Admin User:', adminUser)

  const { data: adminOrg, error: orgError } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', adminUser.organization_id)
    .single()
  
  if (orgError) {
    console.error('Error fetching admin org:', orgError)
    return
  }

  console.log('Admin Organization:', adminOrg)

  // 2. Check shop@dev.com user and organization
  const { data: shopUsers, error: shopUserError } = await supabase
    .from('users')
    .select('id, email, organization_id')
    .eq('email', 'shop@dev.com')
  
  if (shopUserError || !shopUsers || shopUsers.length === 0) {
    console.error('Error fetching shop user:', shopUserError)
    return
  }

  const shopUser = shopUsers[0]
  console.log('Shop User:', shopUser)

  const { data: shopOrg, error: shopOrgError } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', shopUser.organization_id)
    .single()
  
  if (shopOrgError) {
    console.error('Error fetching shop org:', shopOrgError)
    return
  }

  console.log('Shop Organization:', shopOrg)

  // 3. Check redemptions for shop@dev.com
  const { data: redemptions, error: redemptionsError } = await supabase
    .from('points_transactions')
    .select('*')
    .eq('transaction_type', 'redeem')
    .eq('company_id', shopOrg.id) // points_transactions.company_id is usually the shop_id
  
  if (redemptionsError) {
    console.error('Error fetching redemptions:', redemptionsError)
    return
  }

  console.log(`Found ${redemptions.length} redemptions for shop ${shopOrg.org_name}`)
  if (redemptions.length > 0) {
    console.log('Sample redemption:', redemptions[0])
  }

  // 4. Check v_admin_redemptions view content
  console.log('Checking v_admin_redemptions view...')
  const { data: viewData, error: viewError } = await supabase
    .from('v_admin_redemptions')
    .select('*')
    //.eq('company_id', adminOrg.id) // Let's see all first
    .limit(5)

  if (viewError) {
    console.error('Error fetching from view:', viewError)
  } else {
    console.log('View Data Sample:', viewData)
    
    // Check if any row matches adminOrg.id
    const matchingRows = viewData?.filter(r => r.company_id === adminOrg.id)
    console.log(`Found ${matchingRows?.length} rows matching admin org id ${adminOrg.id} in sample`)
  }

  // 5. Check specifically for admin org id in view
  const { data: viewDataFiltered, error: viewErrorFiltered } = await supabase
    .from('v_admin_redemptions')
    .select('*')
    .eq('company_id', adminOrg.id)

  if (viewErrorFiltered) {
    console.error('Error fetching filtered view:', viewErrorFiltered)
  } else {
    console.log(`Total rows in view for admin org ${adminOrg.id}:`, viewDataFiltered?.length)
    if (viewDataFiltered && viewDataFiltered.length > 0) {
      console.log('Sample row:', viewDataFiltered[0])
    }
  }
}

checkAdminView()
