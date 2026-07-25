'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Key, Eye, EyeOff, AlertTriangle, Info } from 'lucide-react'

interface ChangePasswordCardProps {
  userEmail: string
  userPhone?: string | null
}

export default function ChangePasswordCard({ userEmail, userPhone }: ChangePasswordCardProps) {
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const { toast } = useToast()
  const { supabase } = useSupabaseAuth()

  const handleChangePassword = async () => {
    // Validation
    if (!passwordData.currentPassword) {
      toast({
        title: 'Validation Error',
        description: 'Please enter your current password',
        variant: 'destructive'
      })
      return
    }

    if (!passwordData.newPassword) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a new password',
        variant: 'destructive'
      })
      return
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({
        title: 'Validation Error',
        description: 'New passwords do not match',
        variant: 'destructive'
      })
      return
    }
    
    if (passwordData.newPassword.length < 6) {
      toast({
        title: 'Validation Error',
        description: 'Password must be at least 6 characters long',
        variant: 'destructive'
      })
      return
    }

    if (passwordData.currentPassword === passwordData.newPassword) {
      toast({
        title: 'Validation Error',
        description: 'New password must be different from current password',
        variant: 'destructive'
      })
      return
    }

    setLoading(true)

    try {
      console.log('🔐 Step 1: Verifying current password for:', userEmail)

      // Step 1: Verify current password using API endpoint
      const verifyResponse = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          password: passwordData.currentPassword
        })
      })

      console.log('🔐 API Response Status:', verifyResponse.status, verifyResponse.statusText)

      if (!verifyResponse.ok) {
        const errorText = await verifyResponse.text()
        console.error('❌ API request failed:', errorText)
        toast({
          title: 'Verification Error',
          description: 'Failed to verify password. Please try again.',
          variant: 'destructive'
        })
        return
      }

      const verifyData = await verifyResponse.json()
      console.log('🔐 Password verification result:', JSON.stringify(verifyData, null, 2))

      // CRITICAL: Check if password is valid
      if (verifyData.valid !== true) {
        console.error('❌ Current password is INCORRECT')
        toast({
          title: 'Authentication Failed',
          description: verifyData.error || 'Current password is incorrect. Please try again.',
          variant: 'destructive'
        })
        return
      }

      console.log('✅ Step 2: Current password VERIFIED, updating to new password...')

      // Step 2: Current password is correct, now update to new password
      const { error: updateError } = await supabase.auth.updateUser({
        password: passwordData.newPassword
      })

      if (updateError) {
        console.error('❌ Password update error:', updateError)
        toast({
          title: 'Update Failed',
          description: updateError.message || 'Failed to update password. Please try again.',
          variant: 'destructive'
        })
        return
      }

      console.log('✅ Step 3: Password updated successfully in Supabase Auth')

      // Step 3: Success - clear form and show success message
      const userId = userPhone || userEmail
      toast({
        title: 'Password Updated Successfully',
        description: `Your password for ID ${userId} has been updated.`,
        variant: 'success',
        duration: 3000
      })

      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      })

    } catch (error: any) {
      console.error('❌ Unexpected error changing password:', error)
      toast({
        title: 'Error',
        description: error.message || 'An unexpected error occurred. Please try again.',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="sera-sc-panel overflow-hidden border-[var(--sera-line)] shadow-none">
      <CardHeader className="space-y-1.5 border-b border-[var(--sera-line)] bg-[var(--sera-mist)]/40 p-0 px-6 py-5">
        <CardTitle className="font-display flex items-center gap-2 text-lg text-[var(--sera-ink)]">
          <Key className="h-5 w-5 text-[var(--sera-orange)]" />
          Change Password
        </CardTitle>
        <CardDescription className="text-[var(--sera-muted)]">
          Update your password to keep your account secure
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 p-0 px-6 pb-6 pt-5">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current Password <span className="text-red-500">*</span></Label>
            <div className="relative">
              <Input
                id="currentPassword"
                type={showPassword ? 'text' : 'password'}
                value={passwordData.currentPassword}
                onChange={(e) => setPasswordData({...passwordData, currentPassword: e.target.value})}
                placeholder="Enter current password"
                className="pr-10"
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-[var(--sera-muted)]">
              Enter your current password to verify your identity
            </p>
          </div>
          
          <div className="border-t pt-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password <span className="text-red-500">*</span></Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                  placeholder="Enter new password (min 6 characters)"
                  className="pr-10"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              {passwordData.newPassword && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <div className={`h-1.5 flex-1 rounded-full ${
                      passwordData.newPassword.length < 6 ? 'bg-red-200' :
                      passwordData.newPassword.length < 8 ? 'bg-amber-200' :
                      passwordData.newPassword.length < 12 ? 'bg-[var(--sera-orange)]/20' :
                      'bg-emerald-200'
                    }`}>
                      <div className={`h-full rounded-full transition-all ${
                        passwordData.newPassword.length < 6 ? 'bg-red-500 w-1/4' :
                        passwordData.newPassword.length < 8 ? 'bg-amber-500 w-2/4' :
                        passwordData.newPassword.length < 12 ? 'bg-[var(--sera-orange)] w-3/4' :
                        'bg-emerald-500 w-full'
                      }`} />
                    </div>
                    <span className={`font-medium ${
                      passwordData.newPassword.length < 6 ? 'text-red-600' :
                      passwordData.newPassword.length < 8 ? 'text-amber-600' :
                      passwordData.newPassword.length < 12 ? 'text-[var(--sera-orange)]' :
                      'text-emerald-600'
                    }`}>
                      {passwordData.newPassword.length < 6 ? 'Weak' :
                       passwordData.newPassword.length < 8 ? 'Fair' :
                       passwordData.newPassword.length < 12 ? 'Good' :
                       'Strong'}
                    </span>
                  </div>
                </div>
              )}
            </div>
            
            <div className="space-y-2 mt-4">
              <Label htmlFor="confirmPassword">Confirm New Password <span className="text-red-500">*</span></Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                  placeholder="Confirm new password"
                  className="pr-10"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              {passwordData.confirmPassword && passwordData.newPassword !== passwordData.confirmPassword && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Passwords do not match
                </p>
              )}
              {passwordData.confirmPassword && passwordData.newPassword === passwordData.confirmPassword && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  ✓ Passwords match
                </p>
              )}
            </div>
          </div>
        </div>
        
        <div className="rounded-lg border border-[var(--sera-orange)]/20 bg-[var(--sera-orange)]/[0.06] p-4">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--sera-orange)]" />
            <div className="text-sm text-[var(--sera-ink-soft)]">
              <p className="mb-1 font-semibold text-[var(--sera-ink)]">Password Requirements</p>
              <ul className="space-y-1 text-[var(--sera-muted)]">
                <li>• Minimum 6 characters (8+ recommended)</li>
                <li>• Must be different from current password</li>
                <li>• Will be synced with Supabase Auth</li>
                <li>• You'll remain logged in after changing</li>
              </ul>
            </div>
          </div>
        </div>
        
        <div className="flex justify-end gap-3">
          <Button 
            variant="outline" 
            onClick={() => setPasswordData({
              currentPassword: '',
              newPassword: '',
              confirmPassword: ''
            })}
            disabled={loading || (!passwordData.currentPassword && !passwordData.newPassword && !passwordData.confirmPassword)}
          >
            Clear
          </Button>
          <Button 
            onClick={handleChangePassword} 
            disabled={loading || !passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword}
            className="bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white"
          >
            <Key className="w-4 h-4 mr-2" />
            {loading ? 'Changing Password...' : 'Change Password'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
