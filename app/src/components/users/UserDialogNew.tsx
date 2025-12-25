'use client'

import { useState, useRef, useEffect } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Upload, X, Loader2, ImageIcon, AlertCircle } from 'lucide-react'
import { User, Role, Organization } from '@/types/user'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { normalizePhone, validatePhoneNumber, type PhoneValidationResult } from '@/lib/utils'

interface Bank {
  id: string
  short_name: string
  min_account_length: number
  max_account_length: number
  is_numeric_only: boolean
}

// Image compression utility for avatars
// Avatars are displayed very small (40-80px), so we aggressively compress to ~10KB
const compressImage = (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height
        
        // Avatar dimensions - small size since avatars are displayed at 40-80px
        const MAX_WIDTH = 200
        const MAX_HEIGHT = 200
        
        // Calculate new dimensions while maintaining aspect ratio
        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width)
            width = MAX_WIDTH
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height)
            height = MAX_HEIGHT
          }
        }
        
        canvas.width = width
        canvas.height = height
        
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0, width, height)
        
        // Convert to JPEG with aggressive compression (quality 0.6 = 60%)
        // This targets ~10KB file size for avatars
        canvas.toBlob(
          (blob) => {
            if (blob) {
              // Create a new File object with compressed blob
              const compressedFile = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
                type: 'image/jpeg',
                lastModified: Date.now(),
              })
              console.log(`🖼️ Avatar compressed: ${(file.size / 1024).toFixed(2)}KB → ${(compressedFile.size / 1024).toFixed(2)}KB`)
              resolve(compressedFile)
            } else {
              reject(new Error('Canvas to Blob conversion failed'))
            }
          },
          'image/jpeg',
          0.6 // Lower quality = smaller file size, perfect for small avatars
        )
      }
      img.onerror = () => reject(new Error('Image loading failed'))
    }
    reader.onerror = () => reject(new Error('File reading failed'))
  })
}

interface UserDialogNewProps {
  user: User | null
  roles: Role[]
  organizations: Organization[]
  open: boolean
  isSaving?: boolean
  currentUserRoleLevel?: number
  onOpenChange: (open: boolean) => void
  onSave: (userData: Partial<User>, avatarFile?: File | null, resetPassword?: { password: string }) => void
}

export default function UserDialogNew({
  user,
  roles,
  organizations,
  open,
  isSaving = false,
  currentUserRoleLevel = 100,
  onOpenChange,
  onSave
}: UserDialogNewProps) {
  const { supabase } = useSupabaseAuth()
  const [banks, setBanks] = useState<Bank[]>([])
  const [formData, setFormData] = useState<Partial<User> & { 
    password?: string; 
    confirmPassword?: string;
    bank_id?: string;
    bank_account_number?: string;
    bank_account_holder_name?: string;
  }>(
    user || {
      email: '',
      full_name: '',
      phone: '',
      password: '',
      confirmPassword: '',
      role_code: '',
      organization_id: '',
      is_active: true,
      avatar_url: null,
      bank_id: '',
      bank_account_number: '',
      bank_account_holder_name: ''
    }
  )
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar_url || null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [emailCheckStatus, setEmailCheckStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [isCheckingEmail, setIsCheckingEmail] = useState(false)
  const [phoneCheckStatus, setPhoneCheckStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const [isCheckingPhone, setIsCheckingPhone] = useState(false)
  const [phoneValidation, setPhoneValidation] = useState<PhoneValidationResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const emailCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const phoneCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Password reset for Super Admin only
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  const [resetPassword, setResetPassword] = useState('')
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('')
  const isSuperAdmin = currentUserRoleLevel === 1

  // Filter roles based on current user's role level
  const availableRoles = roles.filter(role => role.role_level >= currentUserRoleLevel)

  // Check if selected organization is a Shop
  const selectedOrg = organizations.find(o => o.id === formData.organization_id)
  const selectedOrgIsShop = selectedOrg?.org_type_code === 'SHOP'

  // Fetch banks
  useEffect(() => {
    const fetchBanks = async () => {
      const { data, error } = await supabase
        .from('msia_banks')
        .select('*')
        .eq('is_active', true)
        .order('short_name')
      
      if (data) {
        setBanks(data)
      }
    }
    
    if (open) {
      fetchBanks()
    }
  }, [open, supabase])

  // Check if email exists in database
  const checkEmailAvailability = async (email: string) => {
    if (!email || !email.includes('@') || !!user) {
      setEmailCheckStatus('idle')
      return
    }

    setIsCheckingEmail(true)
    setEmailCheckStatus('checking')

    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email')
        .ilike('email', email.trim())
        .limit(1)

      if (error) {
        console.error('Error checking email:', error)
        setEmailCheckStatus('idle')
        setIsCheckingEmail(false)
        return
      }

      if (data && data.length > 0) {
        setEmailCheckStatus('taken')
        setErrors(prev => ({ 
          ...prev, 
          email: 'This email address is already registered. Please use a different email.' 
        }))
      } else {
        setEmailCheckStatus('available')
        setErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors.email
          return newErrors
        })
      }
    } catch (err) {
      console.error('Error checking email availability:', err)
      setEmailCheckStatus('idle')
    } finally {
      setIsCheckingEmail(false)
    }
  }

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
          phone: 'This phone number is already registered to another user.' 
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
        // Clean avatar URL (remove cache-busting params for display)
        setAvatarPreview(user.avatar_url ? user.avatar_url.split('?')[0] : null)
      } else {
        setFormData({
          email: '',
          full_name: '',
          phone: '',
          password: '',
          confirmPassword: '',
          role_code: '',
          organization_id: '',
          is_active: true,
          avatar_url: null,
          bank_id: '',
          bank_account_number: '',
          bank_account_holder_name: ''
        })
        setAvatarPreview(null)
      }
      setAvatarFile(null)
      setErrors({})
      setEmailCheckStatus('idle')
      setIsCheckingEmail(false)
      setPhoneCheckStatus('idle')
      setIsCheckingPhone(false)
      setPhoneValidation(null)
      setShowPasswordReset(false)
      setResetPassword('')
      setResetPasswordConfirm('')
    }
  }, [user, open])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (emailCheckTimeoutRef.current) {
        clearTimeout(emailCheckTimeoutRef.current)
      }
      if (phoneCheckTimeoutRef.current) {
        clearTimeout(phoneCheckTimeoutRef.current)
      }
    }
  }, [])

  const getInitials = (name: string | null) => {
    if (!name) return 'U'
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setErrors({ avatar: 'Please select an image file' })
      return
    }

    // Check for AVIF format - not supported by Supabase Storage
    if (file.type === 'image/avif') {
      setErrors({ avatar: 'AVIF format is not supported. Please use JPG, PNG, GIF, or WebP instead.' })
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }

    // Initial file size check
    if (file.size > 5 * 1024 * 1024) {
      setErrors({ avatar: 'Image must be less than 5MB' })
      return
    }

    // Always compress avatar images to optimize size (target ~10KB)
    // Avatars are displayed small (40-80px), so we don't need high resolution
    let finalFile = file
    try {
      finalFile = await compressImage(file)
      console.log(`✅ Avatar optimized for storage (target: ~10KB)`)
    } catch (error) {
      console.error('Image compression failed:', error)
      setErrors({ avatar: 'Failed to process image. Please try a smaller file.' })
      return
    }

    setAvatarFile(finalFile)
    
    // Clear errors
    if (errors.avatar) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors.avatar
        return newErrors
      })
    }
    
    // Create preview
    const reader = new FileReader()
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const resetAvatarUpload = () => {
    setAvatarFile(null)
    setAvatarPreview(user?.avatar_url?.split('?')[0] || null)
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

    // Check email availability with debounce
    if (field === 'email' && !user) {
      setEmailCheckStatus('idle')
      if (emailCheckTimeoutRef.current) {
        clearTimeout(emailCheckTimeoutRef.current)
      }
      emailCheckTimeoutRef.current = setTimeout(() => {
        checkEmailAvailability(newValue)
      }, 500) // 500ms debounce
    }

    // Check phone availability with debounce
    if (field === 'phone') {
      setPhoneCheckStatus('idle')
      if (phoneCheckTimeoutRef.current) {
        clearTimeout(phoneCheckTimeoutRef.current)
      }
      phoneCheckTimeoutRef.current = setTimeout(() => {
        checkPhoneAvailability(newValue)
      }, 500) // 500ms debounce
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.email) {
      newErrors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format'
    } else if (emailCheckStatus === 'taken') {
      newErrors.email = 'This email address is already registered. Please use a different email.'
    }

    // Validate phone format for Malaysia/China
    if (formData.phone && formData.phone.trim()) {
      const phoneValidationResult = validatePhoneNumber(formData.phone)
      if (!phoneValidationResult.isValid) {
        newErrors.phone = phoneValidationResult.error || 'Invalid phone number format'
      } else if (phoneCheckStatus === 'taken') {
        newErrors.phone = 'This phone number is already registered to another user.'
      }
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

    // Validate confirm password for new users
    if (!user && !formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password'
    }

    if (!user && formData.password && formData.confirmPassword && formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match'
    }

    // Validate Bank Account for Shop
    if (selectedOrgIsShop) {
      if (formData.bank_id) {
        const selectedBank = banks.find(b => b.id === formData.bank_id)
        if (selectedBank) {
          if (formData.bank_account_number) {
            if (selectedBank.is_numeric_only && !/^\d+$/.test(formData.bank_account_number)) {
              newErrors.bank_account_number = 'Account number must contain digits only'
            }
            if (formData.bank_account_number.length < selectedBank.min_account_length) {
              newErrors.bank_account_number = `Account number must be at least ${selectedBank.min_account_length} digits`
            }
            if (formData.bank_account_number.length > selectedBank.max_account_length) {
              newErrors.bank_account_number = `Account number must be at most ${selectedBank.max_account_length} digits`
            }
          }
        }
      }
    }

    // Validate password reset for existing users (Super Admin only)
    if (user && showPasswordReset) {
      if (!resetPassword) {
        newErrors.resetPassword = 'New password is required'
      } else if (resetPassword.length < 6) {
        newErrors.resetPassword = 'Password must be at least 6 characters'
      }

      if (!resetPasswordConfirm) {
        newErrors.resetPasswordConfirm = 'Please confirm the new password'
      } else if (resetPassword !== resetPasswordConfirm) {
        newErrors.resetPasswordConfirm = 'Passwords do not match'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = () => {
    if (validateForm()) {
      // Remove confirmPassword before saving
      const { confirmPassword, ...dataToSave } = formData
      
      // Include password reset if Super Admin is resetting password
      const passwordReset = (user && showPasswordReset && resetPassword) 
        ? { password: resetPassword }
        : undefined
      
      onSave(dataToSave, avatarFile, passwordReset)
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    resetAvatarUpload()
    setErrors({})
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg max-h-screen overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">
            {user ? 'Edit User' : 'Add New User'}
          </h2>
          <button 
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={isSaving}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Avatar Upload Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Profile Picture</h3>
            
            <div className="flex items-start gap-6">
              {/* Avatar Preview */}
              <div className="flex-shrink-0">
                <Avatar className="w-24 h-24 border-2 border-gray-200">
                  <AvatarImage src={avatarPreview || undefined} />
                  <AvatarFallback className="text-2xl bg-gradient-to-br from-blue-500 to-purple-500 text-white">
                    {getInitials(formData.full_name as string | null)}
                  </AvatarFallback>
                </Avatar>
              </div>

              {/* Upload Controls */}
              <div className="flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
                
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSaving}
                      className="flex items-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      {avatarFile ? 'Change Image' : 'Upload Image'}
                    </Button>
                    
                    {(avatarFile || avatarPreview) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={resetAvatarUpload}
                        disabled={isSaving}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <X className="w-4 h-4 mr-1" />
                        Remove
                      </Button>
                    )}
                  </div>
                  
                  {avatarFile && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 bg-blue-50 px-3 py-2 rounded">
                      <ImageIcon className="w-4 h-4 text-blue-600" />
                      <span className="truncate flex-1">{avatarFile.name}</span>
                      <span className="text-xs text-gray-500">
                        {(avatarFile.size / 1024).toFixed(1)}KB
                      </span>
                    </div>
                  )}
                  
                  <p className="text-xs text-gray-500">
                    JPG, PNG, GIF, or WebP (max 5MB). AVIF not supported. Recommended: 400×400px
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    ✨ Images will be automatically compressed to ~10KB (200×200px JPEG) for optimal performance
                  </p>
                  
                  {errors.avatar && (
                    <p className="text-xs text-red-500">{errors.avatar}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Basic Information</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">
                  Email <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email address"
                    value={formData.email || ''}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    disabled={!!user || isSaving}
                    className={`${errors.email ? 'border-red-500' : ''} ${
                      emailCheckStatus === 'available' ? 'border-green-500' : ''
                    } placeholder:text-gray-400 placeholder:italic`}
                  />
                  {!user && isCheckingEmail && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    </div>
                  )}
                  {!user && emailCheckStatus === 'available' && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                        <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                  )}
                  {!user && emailCheckStatus === 'taken' && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    </div>
                  )}
                </div>
                {errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
                {!errors.email && emailCheckStatus === 'available' && (
                  <p className="text-xs text-green-600">✓ Email is available</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="full_name">
                  Full Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="full_name"
                  placeholder="Enter your full name"
                  value={formData.full_name || ''}
                  onChange={(e) => handleInputChange('full_name', e.target.value)}
                  disabled={isSaving}
                  className={`${errors.full_name ? 'border-red-500' : ''} placeholder:text-gray-400 placeholder:italic`}
                />
                {errors.full_name && <p className="text-xs text-red-500">{errors.full_name}</p>}
              </div>
            </div>

            {!user && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="password">
                    Password <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter a secure password"
                    value={formData.password || ''}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    disabled={isSaving}
                    className={`${errors.password ? 'border-red-500' : ''} placeholder:text-gray-400 placeholder:italic`}
                  />
                  {errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
                  <p className="text-xs text-gray-500">Minimum 6 characters</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">
                    Confirm Password <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Re-enter your password"
                    value={formData.confirmPassword || ''}
                    onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                    disabled={isSaving}
                    className={`${errors.confirmPassword ? 'border-red-500' : ''} placeholder:text-gray-400 placeholder:italic`}
                  />
                  {errors.confirmPassword && <p className="text-xs text-red-500">{errors.confirmPassword}</p>}
                  {!errors.confirmPassword && formData.password && formData.confirmPassword && formData.password === formData.confirmPassword && (
                    <p className="text-xs text-green-600">✓ Passwords match</p>
                  )}
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <div className="relative">
                <Input
                  id="phone"
                  placeholder="e.g., 0123456789 (MY) or 13800138000 (CN)"
                  value={formData.phone || ''}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                  disabled={isSaving}
                  className={`${errors.phone ? 'border-red-500' : ''} ${
                    phoneCheckStatus === 'available' ? 'border-green-500' : ''
                  } ${phoneCheckStatus === 'invalid' ? 'border-amber-500' : ''} placeholder:text-gray-400 placeholder:italic`}
                />
                {isCheckingPhone && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
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
                <p className="text-xs text-gray-500">
                  Supported: Malaysia (+60) and China (+86) mobile numbers
                </p>
              )}
              {!formData.phone && (
                <p className="text-xs text-gray-400">
                  Malaysia: 01x-xxxxxxx • China: 1xxxxxxxxxx
                </p>
              )}
            </div>
          </div>

          {/* Role & Organization */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Role & Access</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="role_code">
                  Role <span className="text-red-500">*</span>
                </Label>
                <Select 
                  value={formData.role_code || ''} 
                  onValueChange={(value) => handleInputChange('role_code', value)}
                  disabled={isSaving}
                >
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
                <Select 
                  value={formData.organization_id || ''} 
                  onValueChange={(value) => handleInputChange('organization_id', value)}
                  disabled={isSaving}
                >
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
          </div>

          {/* Bank Account (Shop Only) */}
          {selectedOrgIsShop && (
            <div className="space-y-4 border-t pt-4">
              <h3 className="text-lg font-semibold text-gray-900">Bank Account</h3>
              <p className="text-sm text-gray-500">Enter bank details for this shop.</p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bank_account_holder_name">
                    Full Name (Account Holder)
                  </Label>
                  <Input
                    id="bank_account_holder_name"
                    placeholder="e.g., ALI BIN ABU"
                    value={formData.bank_account_holder_name || ''}
                    onChange={(e) => handleInputChange('bank_account_holder_name', e.target.value)}
                    disabled={isSaving}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bank_id">
                      Bank Name
                    </Label>
                    <Select 
                      value={formData.bank_id || ''} 
                      onValueChange={(value) => handleInputChange('bank_id', value)}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Bank" />
                      </SelectTrigger>
                      <SelectContent>
                        {banks.map(bank => (
                          <SelectItem key={bank.id} value={bank.id}>
                            {bank.short_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bank_account_number">
                      Account Number
                    </Label>
                    <Input
                      id="bank_account_number"
                      placeholder="e.g., 1234567890"
                      value={formData.bank_account_number || ''}
                      onChange={(e) => handleInputChange('bank_account_number', e.target.value)}
                      disabled={isSaving}
                      className={errors.bank_account_number ? 'border-red-500' : ''}
                    />
                    {errors.bank_account_number && <p className="text-xs text-red-500">{errors.bank_account_number}</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Password Reset (Super Admin only - for existing users) */}
          {user && isSuperAdmin && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Reset User Password</h3>
                <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded">
                  Super Admin Only
                </span>
              </div>
              
              {!showPasswordReset ? (
                <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                  <p className="text-sm text-gray-600 mb-3">
                    Reset this user's password without knowing their current password.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowPasswordReset(true)}
                    disabled={isSaving}
                    className="border-red-300 text-red-700 hover:bg-red-50"
                  >
                    Reset Password
                  </Button>
                </div>
              ) : (
                <div className="space-y-4 p-4 border-2 border-red-200 rounded-lg bg-red-50">
                  <div className="flex items-start gap-2 text-sm text-red-700 mb-4">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Warning: Password Reset</p>
                      <p className="text-xs text-red-600 mt-1">
                        This will change the user's password. They will need to use the new password to log in.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="resetPassword">
                      New Password <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="resetPassword"
                      type="password"
                      placeholder="Enter new password"
                      value={resetPassword}
                      onChange={(e) => {
                        setResetPassword(e.target.value)
                        if (errors.resetPassword) {
                          setErrors(prev => {
                            const newErrors = { ...prev }
                            delete newErrors.resetPassword
                            return newErrors
                          })
                        }
                      }}
                      disabled={isSaving}
                      className={`${errors.resetPassword ? 'border-red-500' : ''} bg-white placeholder:text-gray-400 placeholder:italic`}
                    />
                    {errors.resetPassword && <p className="text-xs text-red-500">{errors.resetPassword}</p>}
                    <p className="text-xs text-gray-600">Minimum 6 characters</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="resetPasswordConfirm">
                      Confirm New Password <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="resetPasswordConfirm"
                      type="password"
                      placeholder="Re-enter new password"
                      value={resetPasswordConfirm}
                      onChange={(e) => {
                        setResetPasswordConfirm(e.target.value)
                        if (errors.resetPasswordConfirm) {
                          setErrors(prev => {
                            const newErrors = { ...prev }
                            delete newErrors.resetPasswordConfirm
                            return newErrors
                          })
                        }
                      }}
                      disabled={isSaving}
                      className={`${errors.resetPasswordConfirm ? 'border-red-500' : ''} bg-white placeholder:text-gray-400 placeholder:italic`}
                    />
                    {errors.resetPasswordConfirm && <p className="text-xs text-red-500">{errors.resetPasswordConfirm}</p>}
                    {!errors.resetPasswordConfirm && resetPassword && resetPasswordConfirm && resetPassword === resetPasswordConfirm && (
                      <p className="text-xs text-green-600">✓ Passwords match</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowPasswordReset(false)
                        setResetPassword('')
                        setResetPasswordConfirm('')
                        setErrors(prev => {
                          const newErrors = { ...prev }
                          delete newErrors.resetPassword
                          delete newErrors.resetPasswordConfirm
                          return newErrors
                        })
                      }}
                      disabled={isSaving}
                    >
                      Cancel Reset
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Settings</h3>

            <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div className="space-y-0.5 flex-1">
                <Label htmlFor="is_active" className="text-base">Active Status</Label>
                <p className="text-sm text-gray-500">
                  Inactive users cannot log in
                </p>
              </div>
              <Checkbox
                id="is_active"
                checked={formData.is_active || false}
                onCheckedChange={(checked) => handleInputChange('is_active', checked)}
                disabled={isSaving}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end p-6 border-t border-gray-200 sticky bottom-0 bg-white">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSaving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400"
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
      </div>
    </div>
  )
}
