'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export async function signOut() {
  const supabase = createClient()
  
  // Sign out from Supabase
  const { error } = await supabase.auth.signOut()
  
  if (error) {
    console.error('Sign out error:', error)
  }
  
  // Clear all Supabase cookies manually
  const cookieStore = cookies()
  const allCookies = cookieStore.getAll()
  
  // Delete all cookies that start with 'sb-'
  allCookies.forEach(cookie => {
    if (cookie.name.startsWith('sb-')) {
      cookieStore.delete(cookie.name)
    }
  })
  
  // Revalidate all paths to clear server cache
  revalidatePath('/', 'layout')
  
  // Redirect to login
  redirect('/login')
}
