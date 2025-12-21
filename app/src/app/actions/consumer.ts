'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

export async function logoutConsumer() {
  try {
    const supabase = await createClient()
    await supabase.auth.signOut()
    
    const cookieStore = await cookies()
    const allCookies = cookieStore.getAll()
    
    // Delete all Supabase related cookies
    allCookies.forEach(cookie => {
      if (cookie.name.startsWith('sb-')) {
        cookieStore.delete(cookie.name)
      }
    })
    
    // Revalidate all paths to ensure fresh data
    revalidatePath('/')
    
    return { success: true }
  } catch (error) {
    console.error('Logout error:', error)
    return { success: false, error: 'Logout failed' }
  }
}
