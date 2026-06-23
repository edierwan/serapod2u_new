'use client'

import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'

interface UserPasswordResetSectionProps {
  targetUserId: string
  targetUserName: string
  targetUserEmail: string
  currentUserRoleLevel: number
}

export default function UserPasswordResetSection({
  targetUserId,
  targetUserName,
  targetUserEmail,
  currentUserRoleLevel,
}: UserPasswordResetSectionProps) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (currentUserRoleLevel !== 10) return null

  const passwordTooShort = newPassword.length > 0 && newPassword.length < 8
  const passwordsMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  const canSubmit = newPassword.length >= 8 && newPassword === confirmPassword && !submitting

  const resetForm = () => {
    setNewPassword('')
    setConfirmPassword('')
    setShowNewPassword(false)
    setShowConfirmPassword(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (submitting) return
    setOpen(next)
    if (!next) resetForm()
  }

  const handleReset = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const response = await fetch('/api/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: targetUserId, new_password: newPassword }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Failed to reset password.')

      toast({ title: 'Password reset', description: `Password reset successfully for ${targetUserName}.` })
      setOpen(false)
      resetForm()
    } catch (error) {
      toast({
        title: 'Password reset failed',
        description: error instanceof Error ? error.message : 'Failed to reset password.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <section className="rounded-lg border border-red-100 bg-red-50/30 p-4" aria-labelledby="security-password-heading">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 id="security-password-heading" className="text-sm font-semibold text-gray-900">Security &amp; Password</h3>
            <p className="mt-1 text-xs text-gray-500">Set a new login password for this user.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
            onClick={() => setOpen(true)}
          >
            <KeyRound className="mr-2 h-4 w-4" />
            Reset Password
          </Button>
        </div>
      </section>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="z-[120] sm:max-w-md"
          overlayClassName="password-reset-overlay z-[110]"
          data-testid="password-reset-modal"
        >
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for {targetUserName} ({targetUserEmail}). This does not change any other user details.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="reset-new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="reset-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  className="pr-10"
                  disabled={submitting}
                />
                <button
                  type="button"
                  aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                  onClick={() => setShowNewPassword((value) => !value)}
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className={`text-xs ${passwordTooShort ? 'text-red-600' : 'text-gray-500'}`}>Minimum 8 characters</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reset-confirm-password">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="reset-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                  disabled={submitting}
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {passwordsMismatch ? <p className="text-xs text-red-600">Passwords do not match.</p> : null}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={handleReset} disabled={!canSubmit}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
