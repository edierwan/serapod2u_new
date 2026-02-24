'use client'

import { useState, useRef, useEffect } from 'react'
import { getOrgTypeName } from '@/lib/utils/orgHierarchy'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  Upload, X, Loader2, ImageIcon, AlertCircle, Building2, UserCheck,
  User as UserIcon, Shield, Briefcase, CreditCard, Store, MapPin, Phone,
  Settings, Lock, KeyRound
} from 'lucide-react'
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

interface Department {
  id: string
  dept_code: string | null
  dept_name: string
  is_active: boolean
}

interface OrgUser {
  id: string
  full_name: string | null
  email: string
}

interface PositionOption {
  id: string
  name: string
  is_active: boolean
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
  lockOrganization?: boolean
  defaultValues?: {
    organization_id?: string
    department_id?: string
    role_code?: string
  }
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
  lockOrganization = false,
  defaultValues,
  onOpenChange,
  onSave
}: UserDialogNewProps) {
  const { supabase } = useSupabaseAuth()
  const [banks, setBanks] = useState<Bank[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [positions, setPositions] = useState<PositionOption[]>([])
  const [orgTypeFilter, setOrgTypeFilter] = useState<string>('')
  const [activeTab, setActiveTab] = useState('profile')
  const [formData, setFormData] = useState<Partial<User> & {
    password?: string;
    confirmPassword?: string;
    bank_id?: string;
    bank_account_number?: string;
    bank_account_holder_name?: string;
    department_id?: string;
    manager_user_id?: string;
    position_id?: string;
    employment_type?: string;
    join_date?: string;
    employment_status?: string;
    shop_name?: string;
    address?: string;
    referral_phone?: string;
  }>(
    user || {
      email: '',
      full_name: '',
      phone: '',
      password: '',
      confirmPassword: '',
      role_code: defaultValues?.role_code || '',
      organization_id: defaultValues?.organization_id || '',
      is_active: true,
      avatar_url: null,
      bank_id: '',
      bank_account_number: '',
      bank_account_holder_name: '',
      department_id: defaultValues?.department_id || '',
      manager_user_id: '',
      position_id: '',
      employment_type: '',
      join_date: '',
      employment_status: 'active',
      shop_name: '',
      address: '',
      referral_phone: ''
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

  // Determine if user is an End User (independent user)
  const selectedRole = roles.find(r => r.role_code === formData.role_code)
  const selectedRoleLevel = selectedRole?.role_level
  const isEndUser = !formData.organization_id || selectedRoleLevel === 50

  // Determine if Department & Reports To fields should be shown
  const eligibleRoleLevels = [1, 10, 20, 30, 40]
  const isEligibleRole = selectedRoleLevel !== undefined && eligibleRoleLevels.includes(selectedRoleLevel)
  const isSeraOrg = selectedOrg?.org_code?.toUpperCase().includes('SERA') || selectedOrg?.org_name?.toLowerCase().includes('serapod')
  const showDepartmentFields = formData.organization_id && isEligibleRole && isSeraOrg

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

  // Fetch departments and users when organization changes
  useEffect(() => {
    const fetchDepartmentsAndUsers = async () => {
      const orgId = formData.organization_id
      if (!orgId) {
        setDepartments([])
        setOrgUsers([])
        return
      }

      // Fetch departments for the organization
      const { data: deptData } = await supabase
        .from('departments')
        .select('id, dept_code, dept_name, is_active')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('dept_name', { ascending: true })

      if (deptData) {
        setDepartments(deptData)
      }

      // Fetch users for the organization (for manager picker)
      const { data: userData } = await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('full_name', { ascending: true })

      if (userData) {
        // Exclude current user from manager options
        const filteredUsers = user?.id
          ? userData.filter((u: any) => u.id !== user.id)
          : userData
        setOrgUsers(filteredUsers)
      }

      // Fetch positions for the organization
      const { data: positionData } = await supabase
        .from('hr_positions')
        .select('id, name, is_active')
        .eq('organization_id', orgId)
        .order('level', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true })

      if (positionData) {
        setPositions(positionData)
      }
    }

    if (open && formData.organization_id) {
      fetchDepartmentsAndUsers()
    }
  }, [open, formData.organization_id, supabase, user?.id])

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
      setActiveTab('profile')
      if (user) {
        setFormData({
          ...user,
          department_id: (user as any).department_id || '',
          manager_user_id: (user as any).manager_user_id || '',
          position_id: (user as any).position_id || '',
          employment_type: (user as any).employment_type || '',
          join_date: (user as any).join_date || '',
          employment_status: (user as any).employment_status || 'active',
          shop_name: (user as any).shop_name || '',
          address: (user as any).address || '',
          referral_phone: (user as any).referral_phone || '',
          bank_id: (user as any).bank_id || '',
          bank_account_number: (user as any).bank_account_number || '',
          bank_account_holder_name: (user as any).bank_account_holder_name || '',
        })
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
          bank_account_holder_name: '',
          department_id: '',
          manager_user_id: '',
          position_id: '',
          employment_type: '',
          join_date: '',
          employment_status: 'active',
          shop_name: '',
          address: '',
          referral_phone: '',
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

  // Use shared getOrgTypeName from @/lib/utils/orgHierarchy

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

    // Validate Bank Account for Shop or end user
    if (selectedOrgIsShop || isEndUser) {
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

    // Navigate to the tab containing the first error
    if (Object.keys(newErrors).length > 0) {
      const errorKey = Object.keys(newErrors)[0]
      const profileFields = ['email', 'full_name', 'phone', 'password', 'confirmPassword']
      const roleFields = ['role_code', 'organization_id']
      const bankFields = ['bank_id', 'bank_account_number', 'bank_account_holder_name']
      const securityFields = ['resetPassword', 'resetPasswordConfirm']

      if (profileFields.includes(errorKey)) {
        setActiveTab('profile')
      } else if (isEndUser && bankFields.includes(errorKey)) {
        setActiveTab('banking')
      } else if (!isEndUser && roleFields.includes(errorKey)) {
        setActiveTab('role')
      } else if (!isEndUser && bankFields.includes(errorKey)) {
        setActiveTab('banking')
      } else if (securityFields.includes(errorKey)) {
        setActiveTab('security')
      }
    }

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

  // Define tab config based on user type
  const tabConfig = isEndUser
    ? [
        { value: 'profile', label: 'Profile', icon: 'user' },
        { value: 'business', label: 'Business', icon: 'store' },
        { value: 'banking', label: 'Banking', icon: 'credit-card' },
        { value: 'security', label: 'Security', icon: 'shield' },
      ]
    : [
        { value: 'profile', label: 'Profile', icon: 'user' },
        { value: 'role', label: 'Role & Access', icon: 'briefcase' },
        ...(showDepartmentFields ? [{ value: 'hr', label: 'HR', icon: 'building' }] : []),
        ...(selectedOrgIsShop ? [{ value: 'banking', label: 'Banking', icon: 'credit-card' }] : []),
        { value: 'security', label: 'Security', icon: 'shield' },
      ]

  const tabIcon = (icon: string) => {
    switch (icon) {
      case 'user': return <UserIcon className="w-3.5 h-3.5" />
      case 'store': return <Store className="w-3.5 h-3.5" />
      case 'credit-card': return <CreditCard className="w-3.5 h-3.5" />
      case 'shield': return <Shield className="w-3.5 h-3.5" />
      case 'briefcase': return <Briefcase className="w-3.5 h-3.5" />
      case 'building': return <Building2 className="w-3.5 h-3.5" />
      default: return null
    }
  }

  // Count errors per tab for badges
  const profileErrorFields = ['email', 'full_name', 'phone', 'password', 'confirmPassword']
  const roleErrorFields = ['role_code', 'organization_id']
  const bankErrorFields = ['bank_id', 'bank_account_number', 'bank_account_holder_name']
  const securityErrorFields = ['resetPassword', 'resetPasswordConfirm']
  const hrErrorFields = ['department_id', 'position_id', 'manager_user_id']
  const businessErrorFields = ['shop_name', 'address', 'referral_phone']

  const tabErrorCount = (tabValue: string): number => {
    const errorKeys = Object.keys(errors)
    switch (tabValue) {
      case 'profile': return errorKeys.filter(k => profileErrorFields.includes(k)).length
      case 'role': return errorKeys.filter(k => roleErrorFields.includes(k)).length
      case 'banking': return errorKeys.filter(k => bankErrorFields.includes(k)).length
      case 'security': return errorKeys.filter(k => securityErrorFields.includes(k)).length
      case 'hr': return errorKeys.filter(k => hrErrorFields.includes(k)).length
      case 'business': return errorKeys.filter(k => businessErrorFields.includes(k)).length
      default: return 0
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">
              {user ? 'Edit User' : 'Add New User'}
            </h2>
            {user && (
              <Badge variant={isEndUser ? 'secondary' : 'outline'} className={`text-[10px] px-2 py-0.5 ${isEndUser ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                {isEndUser ? 'End User' : 'Internal'}
              </Badge>
            )}
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors rounded-lg p-1 hover:bg-gray-100"
            disabled={isSaving}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Avatar Section - Always Visible */}
        <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Avatar className="w-16 h-16 border-2 border-white shadow-sm">
                <AvatarImage src={avatarPreview || undefined} />
                <AvatarFallback className="text-lg bg-gradient-to-br from-blue-500 to-purple-500 text-white font-medium">
                  {getInitials(formData.full_name as string | null)}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSaving}
                className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"
              >
                <Upload className="w-4 h-4 text-white" />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              onChange={handleAvatarChange}
              className="hidden"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {formData.full_name || 'New User'}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {formData.email || 'No email set'}
              </p>
              {avatarFile && (
                <div className="flex items-center gap-1.5 mt-1">
                  <ImageIcon className="w-3 h-3 text-blue-500" />
                  <span className="text-[10px] text-gray-500 truncate">{avatarFile.name}</span>
                  <span className="text-[10px] text-gray-400">({(avatarFile.size / 1024).toFixed(0)}KB)</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSaving}
                className="h-7 text-xs px-2.5"
              >
                <Upload className="w-3 h-3 mr-1" />
                {avatarFile ? 'Change' : 'Upload'}
              </Button>
              {(avatarFile || avatarPreview) && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={resetAvatarUpload}
                  disabled={isSaving}
                  className="h-7 text-xs px-2.5 text-red-500 hover:text-red-600 hover:bg-red-50"
                >
                  <X className="w-3 h-3 mr-1" />
                  Remove
                </Button>
              )}
            </div>
          </div>
          {errors.avatar && (
            <p className="text-xs text-red-500 mt-2">{errors.avatar}</p>
          )}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="px-6 pt-2 border-b border-gray-100">
            <TabsList className="h-9 bg-transparent p-0 gap-0 w-full justify-start">
              {tabConfig.map((tab) => {
                const errCount = tabErrorCount(tab.value)
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="relative h-9 px-3 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-blue-600 text-gray-500 hover:text-gray-700 text-xs font-medium gap-1.5 transition-colors"
                  >
                    {tabIcon(tab.icon)}
                    {tab.label}
                    {errCount > 0 && (
                      <span className="ml-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-medium">
                        {errCount}
                      </span>
                    )}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>

          {/* Tab Content - Scrollable */}
          <div className="flex-1 overflow-y-auto">

            {/* ==================== PROFILE TAB ==================== */}
            <TabsContent value="profile" className="p-6 space-y-5 mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-gray-700">
                  Email <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter email address"
                    value={formData.email || ''}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    disabled={!!user || isSaving}
                    className={`h-9 text-sm ${errors.email ? 'border-red-500' : ''} ${emailCheckStatus === 'available' ? 'border-green-500' : ''} placeholder:text-gray-400`}
                  />
                  {!user && isCheckingEmail && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    </div>
                  )}
                  {!user && emailCheckStatus === 'available' && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center">
                        <svg className="w-2.5 h-2.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                  )}
                  {!user && emailCheckStatus === 'taken' && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    </div>
                  )}
                </div>
                {errors.email && <p className="text-[11px] text-red-500">{errors.email}</p>}
                {!errors.email && emailCheckStatus === 'available' && (
                  <p className="text-[11px] text-green-600">Email is available</p>
                )}
              </div>

              {/* Full Name */}
              <div className="space-y-1.5">
                <Label htmlFor="full_name" className="text-xs font-medium text-gray-700">
                  Full Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="full_name"
                  placeholder="Enter full name"
                  value={formData.full_name || ''}
                  onChange={(e) => handleInputChange('full_name', e.target.value)}
                  disabled={isSaving}
                  className={`h-9 text-sm ${errors.full_name ? 'border-red-500' : ''} placeholder:text-gray-400`}
                />
                {errors.full_name && <p className="text-[11px] text-red-500">{errors.full_name}</p>}
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-xs font-medium text-gray-700">Phone Number</Label>
                <div className="relative">
                  <Input
                    id="phone"
                    placeholder="e.g., 0123456789 (MY) or 13800138000 (CN)"
                    value={formData.phone || ''}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    disabled={isSaving}
                    className={`h-9 text-sm ${errors.phone ? 'border-red-500' : ''} ${phoneCheckStatus === 'available' ? 'border-green-500' : ''} ${phoneCheckStatus === 'invalid' ? 'border-amber-500' : ''} placeholder:text-gray-400`}
                  />
                  {isCheckingPhone && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    </div>
                  )}
                  {phoneCheckStatus === 'available' && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center">
                        <svg className="w-2.5 h-2.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                  )}
                  {(phoneCheckStatus === 'taken' || phoneCheckStatus === 'invalid') && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <AlertCircle className={`w-4 h-4 ${phoneCheckStatus === 'taken' ? 'text-red-500' : 'text-amber-500'}`} />
                    </div>
                  )}
                </div>
                {errors.phone && <p className="text-[11px] text-red-500">{errors.phone}</p>}
                {!errors.phone && phoneCheckStatus === 'available' && phoneValidation?.country && (
                  <p className="text-[11px] text-green-600">
                    Phone available ({phoneValidation.country === 'MY' ? 'Malaysia' : 'China'})
                  </p>
                )}
                {!errors.phone && !formData.phone && (
                  <p className="text-[11px] text-gray-400">Malaysia (+60) or China (+86)</p>
                )}
              </div>

              {/* Password fields - new user only */}
              {!user && (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2 pb-1">
                    <Lock className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Password</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="password" className="text-xs font-medium text-gray-700">
                        Password <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="Min. 6 characters"
                        value={formData.password || ''}
                        onChange={(e) => handleInputChange('password', e.target.value)}
                        disabled={isSaving}
                        className={`h-9 text-sm ${errors.password ? 'border-red-500' : ''} placeholder:text-gray-400`}
                      />
                      {errors.password && <p className="text-[11px] text-red-500">{errors.password}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="confirmPassword" className="text-xs font-medium text-gray-700">
                        Confirm Password <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="Re-enter password"
                        value={formData.confirmPassword || ''}
                        onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                        disabled={isSaving}
                        className={`h-9 text-sm ${errors.confirmPassword ? 'border-red-500' : ''} placeholder:text-gray-400`}
                      />
                      {errors.confirmPassword && <p className="text-[11px] text-red-500">{errors.confirmPassword}</p>}
                      {!errors.confirmPassword && formData.password && formData.confirmPassword && formData.password === formData.confirmPassword && (
                        <p className="text-[11px] text-green-600">Passwords match</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Role selector - shown here for end users since they dont have Role tab */}
              {isEndUser && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center gap-2 pb-1">
                    <Briefcase className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Role</span>
                  </div>
                  <Select
                    value={formData.role_code || ''}
                    onValueChange={(value) => handleInputChange('role_code', value)}
                    disabled={isSaving}
                  >
                    <SelectTrigger className={`h-9 text-sm ${errors.role_code ? 'border-red-500' : ''}`}>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRoles.map(role => (
                        <SelectItem key={role.role_code} value={role.role_code}>
                          {role.role_name} (Level {role.role_level})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.role_code && <p className="text-[11px] text-red-500">{errors.role_code}</p>}
                </div>
              )}
            </TabsContent>

            {/* ==================== BUSINESS TAB (End User Only) ==================== */}
            {isEndUser && (
              <TabsContent value="business" className="p-6 space-y-5 mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                <div className="flex items-center gap-2 pb-1">
                  <Store className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium text-gray-700">Business Information</span>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="shop_name" className="text-xs font-medium text-gray-700">Shop Name</Label>
                  <Input
                    id="shop_name"
                    placeholder="Enter shop name"
                    value={(formData as any).shop_name || ''}
                    onChange={(e) => handleInputChange('shop_name', e.target.value)}
                    disabled={isSaving}
                    className="h-9 text-sm placeholder:text-gray-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="address" className="text-xs font-medium text-gray-700">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-gray-400" />
                      Address
                    </span>
                  </Label>
                  <Input
                    id="address"
                    placeholder="Enter shop address"
                    value={(formData as any).address || ''}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    disabled={isSaving}
                    className="h-9 text-sm placeholder:text-gray-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="referral_phone" className="text-xs font-medium text-gray-700">
                    <span className="flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-gray-400" />
                      Reference / Referral Phone
                    </span>
                  </Label>
                  <Input
                    id="referral_phone"
                    placeholder="Referral phone number"
                    value={(formData as any).referral_phone || ''}
                    onChange={(e) => handleInputChange('referral_phone', e.target.value)}
                    disabled={isSaving}
                    className="h-9 text-sm placeholder:text-gray-400"
                  />
                  <p className="text-[11px] text-gray-400">Phone number of the person who referred this user</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="organization_id_enduser" className="text-xs font-medium text-gray-700">Linked Organization</Label>
                  <Select
                    value={formData.organization_id || ''}
                    onValueChange={(value) => handleInputChange('organization_id', value)}
                    disabled={isSaving || lockOrganization}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="No organization (independent)" />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations.map(org => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.org_name} ({org.org_code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-gray-400">Optional: link to an organization</p>
                </div>
              </TabsContent>
            )}

            {/* ==================== ROLE & ACCESS TAB (Internal Only) ==================== */}
            {!isEndUser && (
              <TabsContent value="role" className="p-6 space-y-5 mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="role_code" className="text-xs font-medium text-gray-700">
                      Role <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={formData.role_code || ''}
                      onValueChange={(value) => handleInputChange('role_code', value)}
                      disabled={isSaving}
                    >
                      <SelectTrigger className={`h-9 text-sm ${errors.role_code ? 'border-red-500' : ''}`}>
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
                    {errors.role_code && <p className="text-[11px] text-red-500">{errors.role_code}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="organization_id" className="text-xs font-medium text-gray-700">Organization</Label>
                    {!lockOrganization && (
                      <div className="mb-1.5">
                        <Select
                          value={orgTypeFilter}
                          onValueChange={(value) => {
                            setOrgTypeFilter(value)
                            if (value && value !== 'ALL' && formData.organization_id) {
                              const currentOrg = organizations.find(o => o.id === formData.organization_id)
                              if (currentOrg && currentOrg.org_type_code !== value) {
                                handleInputChange('organization_id', '')
                              }
                            }
                          }}
                          disabled={isSaving}
                        >
                          <SelectTrigger className="h-7 text-[11px]">
                            <SelectValue placeholder="Filter by Type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL">All Types</SelectItem>
                            {Array.from(new Set(organizations.map(org => org.org_type_code)))
                              .filter((t): t is string => !!t)
                              .map(typeCode => (
                                <SelectItem key={typeCode} value={typeCode}>
                                  {getOrgTypeName(typeCode)}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <Select
                      value={formData.organization_id || ''}
                      onValueChange={(value) => {
                        handleInputChange('organization_id', value)
                        setFormData(prev => ({
                          ...prev,
                          organization_id: value,
                          department_id: '',
                          manager_user_id: ''
                        }))
                      }}
                      disabled={isSaving || lockOrganization}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select organization" />
                      </SelectTrigger>
                      <SelectContent>
                        {organizations
                          .filter(org => !orgTypeFilter || orgTypeFilter === 'ALL' || org.org_type_code === orgTypeFilter)
                          .map(org => (
                            <SelectItem key={org.id} value={org.id}>
                              {org.org_name} ({org.org_code})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>
            )}

            {/* ==================== HR TAB (Internal Only, Sera org) ==================== */}
            {!isEndUser && showDepartmentFields && (
              <TabsContent value="hr" className="p-6 space-y-5 mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                <div className="flex items-center gap-2 pb-1">
                  <Building2 className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-medium text-gray-700">HR & Organization</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="department_id" className="text-xs font-medium text-gray-700">Department</Label>
                    <Select
                      value={formData.department_id || ''}
                      onValueChange={(value) => handleInputChange('department_id', value === 'none' ? '' : value)}
                      disabled={isSaving}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Department</SelectItem>
                        {departments.map(dept => (
                          <SelectItem key={dept.id} value={dept.id}>
                            {dept.dept_code ? `${dept.dept_code} - ` : ''}{dept.dept_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="position_id" className="text-xs font-medium text-gray-700">Position</Label>
                    <Select
                      value={formData.position_id || ''}
                      onValueChange={(value) => handleInputChange('position_id', value === 'none' ? '' : value)}
                      disabled={isSaving}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select position" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Position</SelectItem>
                        {positions.filter(p => p.is_active).map(position => (
                          <SelectItem key={position.id} value={position.id}>
                            {position.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="manager_user_id" className="text-xs font-medium text-gray-700">Reports To</Label>
                    <Select
                      value={formData.manager_user_id || ''}
                      onValueChange={(value) => handleInputChange('manager_user_id', value === 'none' ? '' : value)}
                      disabled={isSaving}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select manager" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Manager</SelectItem>
                        {orgUsers.map(u => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.full_name || u.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-gray-400">Direct supervisor for approvals</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="employment_type" className="text-xs font-medium text-gray-700">Employment Type</Label>
                    <Select
                      value={(formData as any).employment_type || ''}
                      onValueChange={(value) => handleInputChange('employment_type', value === 'none' ? '' : value)}
                      disabled={isSaving}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not set</SelectItem>
                        <SelectItem value="Full-time">Full-time</SelectItem>
                        <SelectItem value="Part-time">Part-time</SelectItem>
                        <SelectItem value="Contract">Contract</SelectItem>
                        <SelectItem value="Intern">Intern</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="join_date" className="text-xs font-medium text-gray-700">Join Date</Label>
                    <Input
                      id="join_date"
                      type="date"
                      value={(formData as any).join_date || ''}
                      onChange={(e) => handleInputChange('join_date', e.target.value)}
                      disabled={isSaving}
                      className="h-9 text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="employment_status" className="text-xs font-medium text-gray-700">Status</Label>
                    <Select
                      value={(formData as any).employment_status || 'active'}
                      onValueChange={(value) => handleInputChange('employment_status', value)}
                      disabled={isSaving}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="resigned">Resigned</SelectItem>
                        <SelectItem value="terminated">Terminated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>
            )}

            {/* ==================== BANKING TAB ==================== */}
            <TabsContent value="banking" className="p-6 space-y-5 mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
              <div className="flex items-center gap-2 pb-1">
                <CreditCard className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-gray-700">Bank Account Details</span>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bank_account_holder_name" className="text-xs font-medium text-gray-700">Account Holder Name</Label>
                <Input
                  id="bank_account_holder_name"
                  placeholder="e.g., ALI BIN ABU"
                  value={formData.bank_account_holder_name || ''}
                  onChange={(e) => handleInputChange('bank_account_holder_name', e.target.value)}
                  disabled={isSaving}
                  className="h-9 text-sm placeholder:text-gray-400"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <Label htmlFor="bank_id" className="text-xs font-medium text-gray-700">Bank</Label>
                  <Select
                    value={formData.bank_id || ''}
                    onValueChange={(value) => handleInputChange('bank_id', value)}
                    disabled={isSaving}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select bank" />
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

                <div className="space-y-1.5">
                  <Label htmlFor="bank_account_number" className="text-xs font-medium text-gray-700">Account Number</Label>
                  <Input
                    id="bank_account_number"
                    placeholder="e.g., 1234567890"
                    value={formData.bank_account_number || ''}
                    onChange={(e) => handleInputChange('bank_account_number', e.target.value)}
                    disabled={isSaving}
                    className={`h-9 text-sm ${errors.bank_account_number ? 'border-red-500' : ''} placeholder:text-gray-400`}
                  />
                  {errors.bank_account_number && <p className="text-[11px] text-red-500">{errors.bank_account_number}</p>}
                </div>
              </div>
            </TabsContent>

            {/* ==================== SECURITY TAB ==================== */}
            <TabsContent value="security" className="p-6 space-y-5 mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
              {/* Active Status */}
              <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg bg-gray-50/50">
                <div className="space-y-0.5 flex-1">
                  <Label htmlFor="is_active" className="text-sm font-medium text-gray-700">Active Status</Label>
                  <p className="text-[11px] text-gray-500">Inactive users cannot log in</p>
                </div>
                <Checkbox
                  id="is_active"
                  checked={formData.is_active || false}
                  onCheckedChange={(checked) => handleInputChange('is_active', checked)}
                  disabled={isSaving}
                />
              </div>

              {/* Password Reset - Super Admin only, existing users */}
              {user && isSuperAdmin && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-red-500" />
                      <span className="text-sm font-medium text-gray-700">Password Reset</span>
                    </div>
                    <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200">
                      Super Admin
                    </Badge>
                  </div>

                  {!showPasswordReset ? (
                    <div className="p-3 border border-gray-200 rounded-lg bg-gray-50/50">
                      <p className="text-xs text-gray-500 mb-2.5">Reset without knowing current password.</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowPasswordReset(true)}
                        disabled={isSaving}
                        className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50"
                      >
                        <KeyRound className="w-3 h-3 mr-1.5" />
                        Reset Password
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3 p-4 border-2 border-red-200 rounded-lg bg-red-50/50">
                      <div className="flex items-start gap-2 text-xs text-red-600">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <p>This will change the user&apos;s password immediately.</p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="resetPassword" className="text-xs font-medium text-gray-700">
                            New Password <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="resetPassword"
                            type="password"
                            placeholder="Min. 6 characters"
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
                            className={`h-9 text-sm ${errors.resetPassword ? 'border-red-500' : ''} bg-white placeholder:text-gray-400`}
                          />
                          {errors.resetPassword && <p className="text-[11px] text-red-500">{errors.resetPassword}</p>}
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="resetPasswordConfirm" className="text-xs font-medium text-gray-700">
                            Confirm <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="resetPasswordConfirm"
                            type="password"
                            placeholder="Re-enter password"
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
                            className={`h-9 text-sm ${errors.resetPasswordConfirm ? 'border-red-500' : ''} bg-white placeholder:text-gray-400`}
                          />
                          {errors.resetPasswordConfirm && <p className="text-[11px] text-red-500">{errors.resetPasswordConfirm}</p>}
                          {!errors.resetPasswordConfirm && resetPassword && resetPasswordConfirm && resetPassword === resetPasswordConfirm && (
                            <p className="text-[11px] text-green-600">Passwords match</p>
                          )}
                        </div>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
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
                        className="h-7 text-xs text-gray-500"
                      >
                        Cancel Reset
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-6 py-3 border-t border-gray-100 bg-gray-50/30">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={isSaving}
            className="h-8 text-xs px-4"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isSaving}
            className="h-8 text-xs px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
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
