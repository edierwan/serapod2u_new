'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { normalizePhone } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react'

export default function LoginForm() {
  const [email, setEmail] = useState('super@dev.com')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const supabase = createClient()

      // Suppress Supabase console errors by temporarily overriding console.error
      const originalConsoleError = console.error
      const errorMessages: any[] = []
      console.error = (...args: any[]) => {
        // Capture but don't display AuthApiError for invalid credentials
        if (args.some((arg: any) => arg?.name === 'AuthApiError' ||
          (typeof arg === 'string' && arg.includes('AuthApiError')))) {
          errorMessages.push(args)
          return
        }
        originalConsoleError(...args)
      }

      let credentials: any = { password }
      
      // Check if input looks like an email
      if (email.includes('@')) {
        credentials.email = email
      } else {
        // Assume phone number - lookup email first
        const normalizedPhone = normalizePhone(email)
        
        // Use the RPC function to find the email associated with this phone number
        const { data: userEmail, error: lookupError } = await supabase
          .rpc('get_email_by_phone', { p_phone: normalizedPhone })

        if (lookupError) {
          console.error('Phone lookup error:', lookupError)
          setError('Error verifying phone number. Please try again.')
          setIsLoading(false)
          return
        }

        if (!userEmail) {
          setError('Phone number not found. Please check your number or contact administrator.')
          setIsLoading(false)
          return
        }

        // Use the found email for login
        credentials.email = userEmail
      }

      const { error: signInError } = await supabase.auth.signInWithPassword(credentials)

      // Restore console.error
      console.error = originalConsoleError

      if (signInError) {
        // Only log to console in development for debugging, not the full error object
        if (process.env.NODE_ENV === 'development') {
          console.log('� Login failed:', signInError.message)
        }

        // Handle specific error types with user-friendly messages
        if (signInError.message.includes('Invalid login credentials')) {
          setError('Invalid email or password. Please check your credentials and try again.')
        } else if (signInError.status === 429 || signInError.message.toLowerCase().includes('rate limit')) {
          setError('Too many login attempts. Please wait a few minutes and try again.')
        } else if (signInError.message.includes('refresh_token_not_found') ||
          signInError.message.includes('Invalid Refresh Token') ||
          signInError.message.includes('Refresh Token Not Found')) {
          // Clear session and allow retry
          await supabase.auth.signOut()
          setError('Your session has expired. Please try logging in again.')
        } else {
          setError(signInError.message)
        }
        return
      }

      // Get user profile after successful login
      const { data: { user: authUser } } = await supabase.auth.getUser()

      if (!authUser) {
        setError('Authentication failed. Please try again.')
        return
      }

      console.log('Auth User ID:', authUser.id)
      console.log('Auth User Email:', authUser.email)

      // Get user profile directly by ID
      let { data: userProfile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single()

      console.log('Profile Error:', profileError)
      console.log('User Profile:', userProfile)

      if (profileError && profileError.code !== 'PGRST116') { // PGRST116 is "The result contains 0 rows"
        console.error('Profile lookup error:', profileError)
        setError(`Database error: ${profileError.message}`)
        await supabase.auth.signOut()
        return
      }

      if (!userProfile) {
        console.warn('⚠️ No user profile found, waiting for trigger to create user record')
        // Wait briefly for trigger to create the user record
        await new Promise(resolve => setTimeout(resolve, 500))

        // Retry profile lookup
        const { data: retryProfile, error: retryError } = await supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single()

        if (retryError || !retryProfile) {
          setError(`User record not found. Please contact administrator to create user record for ID: ${authUser.id}`)
          await supabase.auth.signOut()
          return
        }

        userProfile = retryProfile
      }

      const profile = userProfile

      if (!profile || !profile.is_active) {
        await supabase.auth.signOut()
        setError('Your account is inactive or not found. Please contact your administrator.')
        return
      }

      // Update last_login_at timestamp
      try {
        console.log('🔍 Updating last_login for user:', authUser.id)
        const { error: updateError } = await supabase.rpc('update_last_login', { user_id: authUser.id } as any) as any
        if (updateError) {
          console.error('🔍 Failed to update last_login:', updateError)
        } else {
          console.log('🔍 Successfully updated last_login')
        }
      } catch (error) {
        console.error('🔍 Exception updating last_login:', error)
        // Don't fail login if this fails
      }

      // Capture and store client IP address (fire and forget - don't block login)
      fetch('/api/update-login-ip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }).then(async ipResponse => {
        if (ipResponse.ok) {
          try {
            const ipData = await ipResponse.json()
            const friendlyIp = ipData.displayIp || ipData.ip || 'Unknown'
            console.log('🌐 IP captured:', friendlyIp)
          } catch (parseError) {
            console.error('🌐 Failed to parse IP response:', parseError)
          }
        } else {
          console.error('🌐 Failed to capture IP:', ipResponse.status)
        }
      }).catch(ipError => {
        console.error('🌐 Exception capturing IP:', ipError)
      })

      // Successful login - force refresh and redirect to dashboard
      // This ensures server components fetch fresh data for the new user
      router.refresh()
      router.push('/dashboard')

    } catch (err) {
      console.error('Login error:', err)
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="shadow-xl">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl text-center">Sign in</CardTitle>
        <CardDescription className="text-center">
          Enter your credentials to access your account
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-700">{error}</div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email or phone number</Label>
            <Input
              id="email"
              type="text"
              placeholder="Enter your email or phone number"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full"
              disabled={isLoading}
            />
            <p className="text-xs text-gray-500">You can log in using your email or your phone number.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="pr-10"
                disabled={isLoading}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-gray-400" />
                ) : (
                  <Eye className="h-4 w-4 text-gray-400" />
                )}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Authorized Access Only
            </span>
          </div>
        </div>

        <div className="text-center text-sm text-gray-600">
          <p>For access issues, contact your system administrator</p>
        </div>
      </CardContent>
    </Card>
  )
}