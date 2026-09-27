import { createAdminClient } from '@/lib/supabase/admin'

type ActiveAccountRecord = { is_active?: boolean | null } | null | undefined

export function isActiveAccountRecord(record: ActiveAccountRecord, error?: unknown): boolean {
  return !error && record?.is_active === true
}

export async function isActiveSecurityAccessAccount(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('users')
    .select('is_active')
    .eq('id', userId)
    .maybeSingle()

  return isActiveAccountRecord(data, error)
}
