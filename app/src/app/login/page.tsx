import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LoginForm from '@/components/auth/LoginForm'
import { Package } from 'lucide-react'
import Image from 'next/image'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function LoginPage() {
  const supabase = await createClient()
  
  // Check if user is already logged in
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  // If there's a token error, ignore it and show login page
  // This handles the refresh token error gracefully
  if (authError) {
    console.log('Auth error on login page (expected if session expired):', authError.message)
    // Don't redirect, just show login page
  } else if (user) {
    // User is authenticated, redirect to dashboard
    // Note: redirect() throws NEXT_REDIRECT internally - this is expected behavior
    redirect('/dashboard')
  }

  // Load branding settings from HQ organization
  let branding = {
    logoUrl: null as string | null,
    loginTitle: 'Welcome to Serapod2U',
    loginSubtitle: 'Supply Chain Management System',
    copyrightText: '© 2025 Serapod2U. All rights reserved.'
  }

  const applyBranding = (data: any) => {
    if (!data) return

    const {
      logoUrl,
      loginTitle,
      loginSubtitle,
      copyrightText,
      updatedAt
    } = data as {
      logoUrl?: string | null
      loginTitle?: string | null
      loginSubtitle?: string | null
      copyrightText?: string | null
      updatedAt?: string | null
    }

    if (loginTitle) {
      branding.loginTitle = loginTitle
    }
    if (loginSubtitle) {
      branding.loginSubtitle = loginSubtitle
    }
    if (copyrightText) {
      branding.copyrightText = copyrightText
    }

    if (logoUrl) {
      const trimmedLogo = logoUrl.trim()
      if (trimmedLogo) {
        if (/^https?:/i.test(trimmedLogo)) {
          const version = updatedAt ? new Date(updatedAt).getTime() : Date.now()
          branding.logoUrl = `${trimmedLogo.split('?')[0]}?t=${version}`
        } else {
          // Allow data URLs or other non-HTTP sources
          branding.logoUrl = trimmedLogo
        }
      }
    }
  }

  const logError = (label: string, err: unknown) => {
    if (err instanceof Error) {
      console.error(label, { message: err.message, stack: err.stack })
    } else {
      console.error(label, err)
    }
  }

  try {
    const { data: brandingData, error: brandingError } = await supabase.rpc('get_public_branding')

    if (brandingError) {
      throw brandingError
    }

    applyBranding(brandingData)
  } catch (error) {
    logError('Failed to load branding settings', error)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          {branding.logoUrl ? (
            <div className="mx-auto h-12 w-12 mb-4 relative">
              <Image
                src={branding.logoUrl}
                alt="Logo"
                width={48}
                height={48}
                className="rounded-lg object-cover"
                priority
              />
            </div>
          ) : (
            <div className="mx-auto h-12 w-12 bg-blue-600 rounded-lg flex items-center justify-center mb-4">
              <Package className="h-8 w-8 text-white" />
            </div>
          )}
          <h2 className="text-3xl font-bold text-gray-900">{branding.loginTitle}</h2>
          <p className="mt-2 text-sm text-gray-600">
            {branding.loginSubtitle}
          </p>
        </div>
        
        <LoginForm />
        
        <div className="text-center">
          <p className="text-xs text-gray-500">
            {branding.copyrightText}
          </p>
        </div>
      </div>
    </div>
  )
}