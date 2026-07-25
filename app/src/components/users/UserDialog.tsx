'use client'

import { useState, useRef, useEffect } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Upload, X, Loader2, AlertCircle } from 'lucide-react'
import { User, Role, Organization } from '@/types/user'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { normalizePhone, validatePhoneNumber, type PhoneValidationResult } from '@/lib/utils'
import {
  SeraModalOverlay,
  SeraModalPanel,
} from '@/components/ui/sera-modal'

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

interface UserDialogProps {
  user: User | null
  roles: Role[]
  organizations: Organization[]
  open: boolean
  isSaving?: boolean
  currentUserRoleLevel?: number
  onOpenChange: (open: boolean) => void
  onSave: (userData: Partial<User>, avatarFile?: File | null) => void
}

export default function UserDialog({
  user,
  roles,
  organizations,
  open,
  isSaving = false,
  currentUserRoleLevel = 100,
  onOpenChange,
  onSave
}: UserDialogProps) {
  const { supabase } = useSupabaseAuth()
  const [formData, setFormData] = useState<Partial<User> & { password?: string }>(
    user || {
      email: '',
      full_name: '',
      phone: '',
      password: '',
      role_code: '',
      organization_id: '',
      is_active: true,
      avatar_url: null
    }
  )
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar_url || null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Phone validation state
  const [phoneCheckStatus, setPhoneCheckStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const [isCheckingPhone, setIsCheckingPhone] = useState(false)
  const [phoneValidation, setPhoneValidation] = useState<PhoneValidationResult | null>(null)
  const phoneCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Filter roles based on current user's role level
  // Users can only assign roles equal to or lower than their own level (higher number = lower access)
  const availableRoles = roles.filter(role => role.role_level >= currentUserRoleLevel)

  // Check if phone exists in database
  const checkPhoneAvailability = async (phone: string) => {
    // First validate the phone format
    const validation = validatePhoneNumber(phone)
    setPhoneValidation(validation)

    // If phone is empty, reset status
    if (!phone || phone.trim() === '') {
      setPhoneCheckStatus('idle')
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors.phone
        return newErrors
      })
      return
    }

    // If phone format is invalid, show error and don't check availability
    if (!validation.isValid) {
      setPhoneCheckStatus('invalid')
      setErrors(prev => ({
        ...prev,
        phone: validation.error || 'Invalid phone number format'
      }))
      return
    }

    const normalizedPhone = normalizePhone(phone)

    if (!normalizedPhone || normalizedPhone.length < 10) {
      setPhoneCheckStatus('idle')
      return
    }

    // If editing and phone hasn't changed (normalized check), skip
    if (user && user.phone && normalizePhone(user.phone) === normalizedPhone) {
      setPhoneCheckStatus('idle')
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors.phone
        return newErrors
      })
      return
    }

    setIsCheckingPhone(true)
    setPhoneCheckStatus('checking')

    try {
      // Use RPC to check auth.users directly
      const { data: exists, error } = await supabase
        .rpc('check_phone_exists', {
          p_phone: normalizedPhone,
          p_exclude_user_id: user?.id || null
        })

      if (error) {
        console.error('Error checking phone:', error)
        setPhoneCheckStatus('idle')
        setIsCheckingPhone(false)
        return
      }

      if (exists) {
        setPhoneCheckStatus('taken')
        setErrors(prev => ({
          ...prev,
          phone: 'This phone number is already registered'
        }))
      } else {
        setPhoneCheckStatus('available')
        setErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors.phone
          return newErrors
        })
      }
    } catch (err) {
      console.error('Error checking phone availability:', err)
      setPhoneCheckStatus('idle')
    } finally {
      setIsCheckingPhone(false)
    }
  }

  // Re-initialize form when user prop changes
  useEffect(() => {
    if (open) {
      if (user) {
        setFormData(user)
        setAvatarPreview(user.avatar_url || null)
      } else {
        setFormData({
          email: '',
          full_name: '',
          phone: '',
          password: '',
          role_code: '',
          organization_id: '',
          is_active: true,
          avatar_url: null
        })
        setAvatarPreview(null)
      }
      setAvatarFile(null)
      setErrors({})
      setPhoneCheckStatus('idle')
      setIsCheckingPhone(false)
      setPhoneValidation(null)
    }
  }, [user, open])

  const getInitials = (name: string | null) => {
    if (!name) return 'U'
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setErrors({ avatar: 'Please select an image file' })
      return
    }

    // Check for AVIF format - not supported by Supabase Storage
    if (file.type === 'image/avif') {
      setErrors({ avatar: 'AVIF format is not supported. Please use JPG, PNG, GIF, or WebP instead.' })
      if (e.target) {
        e.target.value = ''
      }
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrors({ avatar: 'Image must be less than 5MB' })
      return
    }

    setAvatarFile(file)
    // Clear errors when file is selected
    if (errors.avatar) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors.avatar
        return newErrors
      })
    }

    const reader = new FileReader()
    reader.onloadend = () => {
      // Update preview with the new image
      setAvatarPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const resetAvatarUpload = () => {
    setAvatarFile(null)
    // Reset to current user's avatar or null, then trigger a re-render by updating the preview
    setAvatarPreview(null)
    setTimeout(() => {
      setAvatarPreview(user?.avatar_url || null)
    }, 0)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleInputChange = (field: string, value: any) => {
    let newValue = value

    // Auto-capitalize words in Full Name when space is pressed
    if (field === 'full_name' && typeof value === 'string') {
      if (value.endsWith(' ') && value.length > 1) {
        const words = value.split(' ')
        // The last element is empty string because of the trailing space
        // The second to last element is the word we just finished typing
        if (words.length >= 2) {
          const lastWordIndex = words.length - 2
          const lastWord = words[lastWordIndex]
          if (lastWord) {
            words[lastWordIndex] = lastWord.charAt(0).toUpperCase() + lastWord.slice(1).toLowerCase()
            newValue = words.join(' ')
          }
        }
      }
    }

    setFormData(prev => ({ ...prev, [field]: newValue }))
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[field]
        return newErrors
      })
    }

    // Phone availability check with debounce
    if (field === 'phone') {
      if (phoneCheckTimeoutRef.current) {
        clearTimeout(phoneCheckTimeoutRef.current)
      }
      phoneCheckTimeoutRef.current = setTimeout(() => {
        checkPhoneAvailability(newValue)
      }, 500)
    }
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (phoneCheckTimeoutRef.current) {
        clearTimeout(phoneCheckTimeoutRef.current)
      }
    }
  }, [])

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.email) {
      newErrors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format'
    }

    if (!formData.full_name) {
      newErrors.full_name = 'Full name is required'
    }

    if (!formData.role_code) {
      newErrors.role_code = 'Role is required'
    }

    // Password required for new users only
    if (!user && !formData.password) {
      newErrors.password = 'Password is required for new users'
    }

    if (!user && formData.password && formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = () => {
    if (validateForm()) {
      onSave(formData, avatarFile)
      // Don't close dialog here - let the parent component handle it
      // Dialog will close after successful save
      resetAvatarUpload()
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    resetAvatarUpload()
    setErrors({})
  }

  if (!open) return null

  return (
    <SeraModalOverlay onBackdropClick={() => !isSaving && handleClose()}>
      <SeraModalPanel className="overflow-y-auto">
        <div className="sera-modal-header is-sticky">
          <h2 className="sera-modal-title">
            {user ? 'Edit User' : 'Add New User'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="sera-modal-close"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="sera-modal-body space-y-6">
          <div className="sera-sc-page space-y-6">
            <h3 className="text-lg font-semibold text-[var(--sera-ink)]">Basic Information</h3>

            <div className="border-2 border-dashed border-[var(--sera-line)] rounded-lg p-6 text-center hover:border-[var(--sera-orange)]/40 transition-colors">
              <div className="flex flex-col items-center">
                <Avatar className="w-20 h-20 mb-4">
                  <AvatarImage src={avatarPreview || undefined} />
                  <AvatarFallback className="text-lg bg-gradient-to-br from-[var(--sera-orange)] to-[var(--sera-orange-deep)] text-white">
                    {getInitials(formData.full_name as string | null)}
                  </AvatarFallback>
                </Avatar>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 mb-2"
                >
                  <Upload className="w-4 h-4" />
                  Upload Avatar
                </Button>
                <p className="text-xs text-[var(--sera-muted)] mb-2">PNG, JPG or GIF (max 5MB)</p>
                {avatarFile && (
                  <div className="mt-3 flex items-center gap-2 w-full justify-center">
                    <span className="text-sm text-[var(--sera-ink)]/80 truncate flex-1">{avatarFile.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={resetAvatarUpload}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                {errors.avatar && <p className="text-xs text-red-500 mt-2">{errors.avatar}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@company.com"
                  value={formData.email || ''}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  disabled={!!user}
                  className={errors.email ? 'border-red-500' : ''}
                />
                {errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="full_name">Full Name <span className="text-red-500">*</span></Label>
                <Input
                  id="full_name"
                  placeholder="John Doe"
                  value={formData.full_name || ''}
                  onChange={(e) => handleInputChange('full_name', e.target.value)}
                  className={errors.full_name ? 'border-red-500' : ''}
                />
                {errors.full_name && <p className="text-xs text-red-500">{errors.full_name}</p>}
              </div>
            </div>

            {!user && (
              <div className="space-y-2">
                <Label htmlFor="password">Password <span className="text-red-500">*</span></Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter a secure password"
                  value={formData.password || ''}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  className={errors.password ? 'border-red-500' : ''}
                />
                {errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
                <p className="text-xs text-[var(--sera-muted)]">Minimum 6 characters</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <div className="relative">
                <Input
                  id="phone"
                  placeholder="e.g., 0123456789 (MY) or 13800138000 (CN)"
                  value={formData.phone || ''}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                  className={`${errors.phone ? 'border-red-500' : ''} ${phoneCheckStatus === 'available' ? 'border-green-500' : ''
                    } ${phoneCheckStatus === 'invalid' ? 'border-amber-500' : ''}`}
                />
                {isCheckingPhone && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--sera-muted)]/70" />
                  </div>
                )}
                {phoneCheckStatus === 'available' && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                      <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                )}
                {(phoneCheckStatus === 'taken' || phoneCheckStatus === 'invalid') && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <AlertCircle className={`w-5 h-5 ${phoneCheckStatus === 'taken' ? 'text-red-500' : 'text-amber-500'}`} />
                  </div>
                )}
              </div>
              {errors.phone && <p className="text-xs text-red-500">{errors.phone}</p>}
              {!errors.phone && phoneCheckStatus === 'available' && phoneValidation?.country && (
                <p className="text-xs text-green-600">
                  ✓ Phone number is available ({phoneValidation.country === 'MY' ? '🇲🇾 Malaysia' : '🇨🇳 China'})
                </p>
              )}
              {!errors.phone && phoneCheckStatus === 'idle' && formData.phone && formData.phone.trim() && (
                <p className="text-xs text-[var(--sera-muted)]">
                  Supported: Malaysia (+60) and China (+86) mobile numbers
                </p>
              )}
              {!formData.phone && (
                <p className="text-xs text-[var(--sera-muted)]/70">
                  Supported: Malaysia (+60) and China (+86) mobile numbers
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-[var(--sera-line)]">
            <h3 className="text-lg font-semibold text-[var(--sera-ink)]">Role & Access</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="role_code">Role <span className="text-red-500">*</span></Label>
                <Select value={formData.role_code || ''} onValueChange={(value) => handleInputChange('role_code', value)}>
                  <SelectTrigger className={errors.role_code ? 'border-red-500' : ''}>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map(role => (
                      <SelectItem key={role.role_code} value={role.role_code}>
                        {role.role_name} (Level {role.role_level})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.role_code && <p className="text-xs text-red-500">{errors.role_code}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="organization_id">Organization</Label>
                <Select value={formData.organization_id || ''} onValueChange={(value) => handleInputChange('organization_id', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map(org => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.org_name} ({org.org_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Card className="bg-[var(--sera-orange)]/[0.06] border-[var(--sera-orange)]/20">
              <CardContent className="pt-6">
                <p className="text-xs text-[var(--sera-orange-deep)]">
                  <strong>Role Levels:</strong> Super Admin (1) → HQ Admin (10) → Power User (20) → Manager (30) → User (40) → Guest (50)
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 pt-4 border-t border-[var(--sera-line)]">
            <h3 className="text-lg font-semibold text-[var(--sera-ink)]">Settings</h3>

            <div className="flex items-center justify-between p-4 border border-[var(--sera-line)] rounded-lg">
              <div className="space-y-0.5 flex-1">
                <Label htmlFor="is_active" className="text-base">Active Status</Label>
                <p className="text-sm text-[var(--sera-muted)]">
                  Inactive users cannot log in
                </p>
              </div>
              <Checkbox
                id="is_active"
                checked={formData.is_active || false}
                onCheckedChange={(checked) => handleInputChange('is_active', checked)}
              />
            </div>

            {user && (
              <Card className="bg-gray-50 border-[var(--sera-line)]">
                <CardContent className="pt-6">
                  <h4 className="text-sm text-[var(--sera-ink)]/80 font-medium mb-4">Account Information</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-[var(--sera-muted)]">Created</span>
                      <p className="text-[var(--sera-ink)] font-medium">
                        {formatDate(user.created_at)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[var(--sera-muted)]">Updated</span>
                      <p className="text-[var(--sera-ink)] font-medium">
                        {formatDate(user.updated_at)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <div className="sera-modal-footer">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSaving}
            className="border-[var(--sera-line)]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSaving}
            className="bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              user ? 'Update User' : 'Add User'
            )}
          </Button>
        </div>
      </SeraModalPanel>
    </SeraModalOverlay>
  )
}
