import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function getScanPageContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Consumer may or may not be logged in - scan page is public
  let consumerProfile = null
  if (user) {
    const { data } = await supabase
      .from('users')
      .select('id, full_name, email, phone, organization_id')
      .eq('id', user.id)
      .single()
    consumerProfile = data
  }

  return { user, consumerProfile }
}
