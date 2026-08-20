import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

function loadEnvFile(envPath: string): Record<string, string> {
  const env: Record<string, string> = {}
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/)
    if (!match) continue
    const key = match[1].trim()
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

const envCandidates = [
  path.join(process.cwd(), '.env.local'),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), '../.env'),
]

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    const loaded = loadEnvFile(envPath)
    for (const [key, value] of Object.entries(loaded)) {
      if (!process.env[key]) process.env[key] = value
    }
    console.log(`Loaded env: ${envPath}`)
    break
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const EMAIL = process.argv[2] || 'testapp@dev.com'
const PASSWORD = process.argv[3] || 'pass123'
const FULL_NAME = process.argv[4] || 'Test App Distributor'
const ORG_CODE = process.argv[5] || 'DIST-TESTAPP'
const ORG_NAME = process.argv[6] || 'Test App Distributor'

async function findHqOrgId(): Promise<string> {
  const { data, error } = await admin
    .from('organizations')
    .select('id, org_code, org_name')
    .eq('org_type_code', 'HQ')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) throw error
  if (!data?.[0]?.id) throw new Error('No active HQ organization found')
  console.log(`Using HQ: ${data[0].org_code} (${data[0].org_name})`)
  return data[0].id
}

async function ensureDistOrg(hqId: string): Promise<string> {
  const { data: existing, error: existingError } = await admin
    .from('organizations')
    .select('id, org_code, org_name, is_active')
    .eq('org_code', ORG_CODE)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.id) {
    console.log(`Using existing DIST org: ${existing.org_code} (${existing.org_name})`)
    if (!existing.is_active) {
      const { error: activateError } = await admin
        .from('organizations')
        .update({ is_active: true })
        .eq('id', existing.id)
      if (activateError) throw activateError
    }
    return existing.id
  }

  const { data, error } = await admin
    .from('organizations')
    .insert({
      org_type_code: 'DIST',
      org_code: ORG_CODE,
      org_name: ORG_NAME,
      parent_org_id: hqId,
      country_code: 'MY',
      is_active: true,
      contact_email: EMAIL,
    })
    .select('id, org_code, org_name')
    .single()

  if (error) throw error
  console.log(`Created DIST org: ${data.org_code} (${data.org_name})`)
  return data.id
}

async function resolveDistRoleCode(): Promise<string> {
  const preferred = ['MANAGER', 'DIST_ADMIN', 'USER']
  for (const roleCode of preferred) {
    const { data, error } = await admin
      .from('roles')
      .select('role_code')
      .eq('role_code', roleCode)
      .eq('is_active', true)
      .maybeSingle()
    if (error) throw error
    if (data?.role_code) return data.role_code
  }

  const { data, error } = await admin
    .from('roles')
    .select('role_code, role_level')
    .eq('is_active', true)
    .eq('role_level', 30)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data?.role_code) throw new Error('No distributor role found (expected MANAGER level 30)')
  return data.role_code
}

async function ensurePortalUser(distOrgId: string): Promise<void> {
  const roleCode = await resolveDistRoleCode()

  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) throw listError
  const existingAuth = listed.users.find((user) => user.email?.toLowerCase() === EMAIL.toLowerCase())

  let userId = existingAuth?.id

  if (existingAuth) {
    const { error: updateError } = await admin.auth.admin.updateUserById(existingAuth.id, {
      password: PASSWORD,
      email_confirm: true,
    })
    if (updateError) throw updateError
    console.log(`Updated auth password for ${EMAIL}`)
  } else {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: FULL_NAME },
    })
    if (createError) throw createError
    userId = created.user?.id
    if (!userId) throw new Error('Auth user created without id')
    console.log(`Created auth user ${EMAIL}`)
  }

  const { error: syncError } = await admin.rpc('sync_user_profile', {
    p_user_id: userId,
    p_email: EMAIL,
    p_role_code: roleCode,
    p_organization_id: distOrgId,
    p_full_name: FULL_NAME,
  })
  if (syncError) throw syncError

  const { error: scopeError } = await admin
    .from('users')
    .update({
      account_scope: 'portal',
      organization_id: distOrgId,
      role_code: roleCode,
      is_active: true,
      full_name: FULL_NAME,
    })
    .eq('id', userId)
  if (scopeError) throw scopeError

  const { data: profile, error: profileError } = await admin
    .from('users')
    .select('id, email, full_name, role_code, account_scope, organization_id, organizations!fk_users_organization(org_code, org_name, org_type_code)')
    .eq('id', userId)
    .single()

  if (profileError) throw profileError

  console.log('\nDistributor account ready:')
  console.log(`  Email: ${EMAIL}`)
  console.log(`  Password: ${PASSWORD}`)
  console.log(`  Role: ${profile.role_code}`)
  console.log(`  Scope: ${profile.account_scope}`)
  console.log(`  Org: ${(profile.organizations as { org_code?: string; org_name?: string } | null)?.org_code}`)
  console.log('  Login → /serapp/conversation')
}

async function main() {
  const hqId = await findHqOrgId()
  const distOrgId = await ensureDistOrg(hqId)
  await ensurePortalUser(distOrgId)
}

main().catch((error) => {
  console.error('Failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
