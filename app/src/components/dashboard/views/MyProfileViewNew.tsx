'use client'

import { useState, useEffect, useRef } from 'react'
import { getOrgTypeName } from '@/lib/utils/orgHierarchy'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  User, Mail, Building2, Shield, Calendar, Phone, Edit2, Save, X,
  Loader2, Camera, CheckCircle, XCircle, Clock, MapPin, AlertCircle, CreditCard, Landmark, Home, UserCheck, Briefcase
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import SignatureUpload from '@/components/profile/SignatureUpload'
import ChangePasswordCard from '@/components/profile/ChangePasswordCard'
import { updateUserWithAuth } from '@/lib/actions'
import { normalizePhone, validatePhoneNumber, getStorageUrl, type PhoneValidationResult } from '@/lib/utils'
import { compressAvatar, formatFileSize } from '@/lib/utils/imageCompression'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface UserProfile {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  address: string | null
  location: string | null
  shop_name: string | null
  role_code: string
  organization_id: string
  avatar_url: string | null
  signature_url: string | null
  is_active: boolean
  is_verified: boolean
  email_verified_at: string | null
  phone_verified_at: string | null
  last_login_at: string | null
  last_login_ip: string | null
  created_at: string
  updated_at: string
  bank_id: string | null
  bank_account_number: string | null
  bank_account_holder_name: string | null
  referral_phone: string | null
  // Account scope
  account_scope?: 'store' | 'portal' | null
  // HR Foundation fields
  department_id?: string | null
  manager_user_id?: string | null
  organizations?: {
    id: string
    org_name: string
    org_type_code: string
    org_code: string
  }
  roles?: {
    role_name: string
    role_level: number
  }
  msia_banks?: {
    id: string
    short_name: string
  }
  // Joined data for display
  departments?: {
    id: string
    dept_code: string | null
    dept_name: string
  } | null
  manager?: {
    id: string
    full_name: string | null
    email: string
  } | null
}

interface MsiaBank {
  id: string
  short_name: string
  is_active: boolean
}

const MALAYSIA_STATES = [
  "Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan",
  "Pahang", "Penang", "Perak", "Perlis", "Sabah", "Sarawak",
  "Selangor", "Terengganu", "Kuala Lumpur", "Labuan", "Putrajaya"
]

interface MyProfileViewNewProps {
  userProfile: UserProfile
}

export default function MyProfileViewNew({ userProfile: initialProfile }: MyProfileViewNewProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [userProfile, setUserProfile] = useState<UserProfile>(initialProfile)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    address: '',
    location: '',
    shop_name: '',
    bank_id: '',
    bank_account_number: '',
    bank_account_holder_name: '',
    referral_phone: ''
  })
  const [phoneCheckStatus, setPhoneCheckStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const [referralCheckStatus, setReferralCheckStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const [referralName, setReferralName] = useState('')
  const phoneCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const referralCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [banks, setBanks] = useState<MsiaBank[]>([])
  const [isSavingBank, setIsSavingBank] = useState(false)
  const [isEditingBank, setIsEditingBank] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const { toast } = useToast()
  const supabase = createClient()

  // Load fresh user data on mount and when editing is cancelled
  useEffect(() => {
    loadUserProfile()
    loadBanks()

    return () => {
      if (phoneCheckTimeoutRef.current) clearTimeout(phoneCheckTimeoutRef.current)
      if (referralCheckTimeoutRef.current) clearTimeout(referralCheckTimeoutRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadBanks = async () => {
    const { data, error } = await supabase
      .from('msia_banks')
      .select('id, short_name, is_active')
      .eq('is_active', true)
      .order('short_name')

    if (data) {
      setBanks(data)
    }
  }

  const loadUserProfile = async () => {
    try {
      setIsLoading(true)

      let targetUserId = initialProfile?.id

      // If no initial profile or ID, fall back to current session user
      if (!targetUserId) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          toast({
            title: "Error",
            description: "Not authenticated",
            variant: "destructive",
          })
          return
        }
        targetUserId = user.id
      }

      // Fetch complete user profile with related data including HR Foundation fields
      // First try full query with all joins
      let profile: any = null
      let queryError: any = null

      const { data: fullProfile, error: fullError } = await supabase
        .from('users')
        .select(`
          *,
          organizations:organization_id (
            id,
            org_name,
            org_type_code,
            org_code
          ),
          roles:role_code (
            role_name,
            role_level
          ),
          msia_banks:bank_id (
            id,
            short_name
          ),
          departments:department_id!users_department_id_fkey (
            id,
            dept_code,
            dept_name
          ),
          manager:manager_user_id!users_manager_user_id_fkey (
            id,
            full_name,
            email
          )
        `)
        .eq('id', targetUserId)
        .single()

      if (fullError) {
        // FK joins might fail if columns don't exist yet — fallback to basic query
        console.warn('Full profile query failed, trying fallback:', fullError.message || fullError.code)
        const { data: basicProfile, error: basicError } = await supabase
          .from('users')
          .select(`
            *,
            organizations:organization_id (
              id,
              org_name,
              org_type_code,
              org_code
            ),
            roles:role_code (
              role_name,
              role_level
            ),
            msia_banks:bank_id (
              id,
              short_name
            )
          `)
          .eq('id', targetUserId)
          .single()

        if (basicError) {
          queryError = basicError
        } else {
          profile = basicProfile
        }
      } else {
        profile = fullProfile
      }

      if (queryError) throw queryError

      if (profile) {
        // Transform the data structure
        const transformedProfile: UserProfile = {
          ...(profile as any),
          organizations: Array.isArray((profile as any).organizations)
            ? (profile as any).organizations[0]
            : (profile as any).organizations,
          roles: Array.isArray((profile as any).roles)
            ? (profile as any).roles[0]
            : (profile as any).roles,
          msia_banks: Array.isArray((profile as any).msia_banks)
            ? (profile as any).msia_banks[0]
            : (profile as any).msia_banks,
          departments: Array.isArray((profile as any).departments)
            ? (profile as any).departments[0]
            : (profile as any).departments,
          manager: Array.isArray((profile as any).manager)
            ? (profile as any).manager[0]
            : (profile as any).manager
        }

        setUserProfile(transformedProfile)
        setFormData({
          full_name: transformedProfile.full_name || '',
          phone: transformedProfile.phone || '',
          address: transformedProfile.address || '',
          location: transformedProfile.location || '',
          shop_name: transformedProfile.shop_name || '',
          bank_id: transformedProfile.bank_id || '',
          bank_account_number: transformedProfile.bank_account_number || '',
          bank_account_holder_name: transformedProfile.bank_account_holder_name || '',
          referral_phone: transformedProfile.referral_phone || ''
        })
      }
    } catch (error: any) {
      console.error('Error loading profile:', error?.message || error?.code || JSON.stringify(error))
      toast({
        title: "Error",
        description: error?.message || "Failed to load profile data",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const checkPhoneAvailability = async (phone: string) => {
    // Validate phone format
    const validation = validatePhoneNumber(phone)
    if (!validation.isValid) {
      setPhoneCheckStatus('invalid')
      setValidationErrors(prev => ({ ...prev, phone: validation.error || 'Invalid phone format' }))
      return
    }

    const normalizedPhone = normalizePhone(phone)

    // If same as current user's phone, it's valid (their own)
    if (userProfile.phone && normalizePhone(userProfile.phone) === normalizedPhone) {
      setPhoneCheckStatus('available')
      setValidationErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors.phone
        return newErrors
      })
      return
    }

    setPhoneCheckStatus('checking')
    try {
      const { data: exists, error } = await supabase
        .rpc('check_phone_exists', {
          p_phone: normalizedPhone,
          p_exclude_user_id: userProfile.id
        })

      if (error) throw error

      if (exists) {
        setPhoneCheckStatus('taken')
        setValidationErrors(prev => ({ ...prev, phone: 'Phone number already exists' }))
      } else {
        setPhoneCheckStatus('available')
        setValidationErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors.phone
          return newErrors
        })
      }
    } catch (error) {
      console.error('Error checking phone:', error)
      setPhoneCheckStatus('idle')
    }
  }

  const checkReferralPhone = async (value: string) => {
    const rawValue = value?.trim() || ''
    if (!rawValue) {
      setReferralCheckStatus('idle')
      setReferralName('')
      return
    }

    const isEmail = rawValue.includes('@')
    if (isEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(rawValue)) {
        setReferralCheckStatus('invalid')
        setReferralName('')
        setValidationErrors(prev => ({ ...prev, referral_phone: 'Invalid email format' }))
        return
      }
    } else {
      const validation = validatePhoneNumber(rawValue)
      if (!validation.isValid) {
        setReferralCheckStatus('invalid')
        setReferralName('')
        setValidationErrors(prev => ({ ...prev, referral_phone: 'Invalid phone format' }))
        return
      }
    }

    const normalizedPhone = isEmail ? rawValue : normalizePhone(rawValue)
    setReferralCheckStatus('checking')

    try {
      const res = await fetch('/api/user/lookup-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: normalizedPhone })
      })

      const data = await res.json()

      if (res.ok && data?.success) {
        setReferralCheckStatus('valid')
        setReferralName(data?.name || '')
        setValidationErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors.referral_phone
          return newErrors
        })
      } else {
        setReferralCheckStatus('invalid')
        setReferralName('')
        setValidationErrors(prev => ({ ...prev, referral_phone: 'Referred user not found' }))
      }
    } catch (error) {
      console.error('Error checking referral:', error)
      setReferralCheckStatus('idle')
      setReferralName('')
    }
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid File",
          description: "Please select an image file.",
          variant: "destructive",
        })
        return
      }

      // Check for AVIF format - not supported by Supabase Storage
      if (file.type === 'image/avif') {
        toast({
          title: "Format Not Supported",
          description: "AVIF format is not supported. Please use JPG, PNG, GIF, or WebP instead.",
          variant: "destructive",
        })
        if (e.target) {
          e.target.value = ''
        }
        return
      }

      try {
        // Compress image to be under 5KB
        const compressedFile = await compressImage(file)

        setAvatarFile(compressedFile)

        // Create preview
        const reader = new FileReader()
        reader.onloadend = () => {
          setAvatarPreview(reader.result as string)
        }
        reader.readAsDataURL(compressedFile)
      } catch (error) {
        console.error('Compression error:', error)
        toast({
          title: "Error",
          description: "Failed to process image. Please try another one.",
          variant: "destructive",
        })
      }
    }
  }

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

          // Resize to max 150px to ensure small size
          const MAX_SIZE = 150
          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width
              width = MAX_SIZE
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height
              height = MAX_SIZE
            }
          }

          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx?.drawImage(img, 0, 0, width, height)

          // Start with quality 0.7
          let quality = 0.7

          const compress = () => {
            canvas.toBlob((blob) => {
              if (!blob) {
                reject(new Error('Canvas is empty'))
                return
              }

              // If still > 5KB and quality > 0.1, reduce quality and try again
              if (blob.size > 5 * 1024 && quality > 0.1) {
                quality -= 0.1
                compress()
              } else {
                // Create new file
                const newFile = new File([blob], file.name, {
                  type: 'image/jpeg',
                  lastModified: Date.now(),
                })
                resolve(newFile)
              }
            }, 'image/jpeg', quality)
          }

          compress()
        }
        img.onerror = (error) => reject(error)
      }
      reader.onerror = (error) => reject(error)
    })
  }

  const handleAvatarClick = () => {
    if (isEditing) {
      fileInputRef.current?.click()
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      // Validate phone number format if provided
      if (formData.phone && formData.phone.trim()) {
        const phoneValidation = validatePhoneNumber(formData.phone)
        if (!phoneValidation.isValid) {
          toast({
            title: "Invalid Phone Number",
            description: phoneValidation.error || "Please enter a valid Malaysian (+60) or Chinese (+86) phone number.",
            variant: "destructive",
          })
          setIsSaving(false)
          return
        }
      }

      // Check if phone is already in use if changed
      if (formData.phone && formData.phone !== userProfile.phone) {
        const normalizedPhone = normalizePhone(formData.phone)
        const { data: exists, error: checkError } = await supabase
          .rpc('check_phone_exists', {
            p_phone: normalizedPhone,
            p_exclude_user_id: userProfile.id
          })

        if (checkError) throw checkError

        if (exists) {
          toast({
            title: "Error",
            description: "This phone number is already in use by another account.",
            variant: "destructive",
          })
          setIsSaving(false)
          return
        }
      }

      // Validate referred by if provided (phone or email)
      if (formData.referral_phone && formData.referral_phone.trim()) {
        const rawReferral = formData.referral_phone.trim()
        const isEmail = rawReferral.includes('@')
        if (isEmail) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
          if (!emailRegex.test(rawReferral)) {
            toast({
              title: "Invalid Referred By",
              description: "Please enter a valid email for the referred user.",
              variant: "destructive",
            })
            setIsSaving(false)
            return
          }
        } else {
          const validation = validatePhoneNumber(rawReferral)
          if (!validation.isValid) {
            toast({
              title: "Invalid Referred By",
              description: validation.error || "Please enter a valid phone number for the referred user.",
              variant: "destructive",
            })
            setIsSaving(false)
            return
          }
        }

        const lookupValue = isEmail ? rawReferral : normalizePhone(rawReferral)
        const lookupRes = await fetch('/api/user/lookup-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: lookupValue })
        })

        const lookupData = await lookupRes.json()

        if (!lookupRes.ok || !lookupData?.success) {
          toast({
            title: "Invalid Referred By",
            description: "Referred user not found.",
            variant: "destructive",
          })
          setIsSaving(false)
          return
        }
      }

      let updateData: any = {
        full_name: formData.full_name?.trim() || null,
        phone: formData.phone?.trim() || null,
        address: formData.address?.trim() || null,
        location: formData.location || null,
        shop_name: formData.shop_name?.trim() || null,
        referral_phone: formData.referral_phone?.trim() || null,
        updated_at: new Date().toISOString()
      }

      // Handle avatar upload if file is selected
      if (avatarFile) {
        try {
          // Compress the avatar first
          const compressionResult = await compressAvatar(avatarFile)

          toast({
            title: '🖼️ Avatar Compressed',
            description: `${formatFileSize(compressionResult.originalSize)} → ${formatFileSize(compressionResult.compressedSize)} (${compressionResult.compressionRatio.toFixed(1)}% smaller)`,
          })

          // Delete old avatar if exists
          if (userProfile.avatar_url) {
            const oldPath = userProfile.avatar_url.split('/').pop()?.split('?')[0]
            if (oldPath) {
              const pathToDelete = `${userProfile.id}/${oldPath}`
              await supabase.storage.from('avatars').remove([pathToDelete])
            }
          }

          // Upload new avatar
          const fileName = `${Date.now()}.jpg`
          const filePath = `${userProfile.id}/${fileName}`

          const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(filePath, compressionResult.file, {
              contentType: compressionResult.file.type,
              cacheControl: '3600',
              upsert: true
            })

          if (uploadError) throw uploadError

          // Get public URL
          const { data: urlData } = supabase.storage
            .from('avatars')
            .getPublicUrl(filePath)

          updateData.avatar_url = `${urlData.publicUrl}?v=${Date.now()}`
        } catch (avatarError: any) {
          console.error('Avatar upload error:', avatarError)
          toast({
            title: 'Warning',
            description: `Avatar upload failed: ${avatarError.message}`,
            variant: 'destructive'
          })
          // Don't return - continue with other updates
        }
      }

      // Update user profile in database (self-update - pass own profile info)
      const result = await updateUserWithAuth(userProfile.id, updateData, {
        id: userProfile.id,
        role_code: userProfile.role_code
      })

      if (!result.success) throw new Error(result.error || 'Failed to update profile')

      toast({
        title: "Success",
        description: "Your profile has been updated successfully.",
      })

      // Reset editing state
      setIsEditing(false)
      setAvatarFile(null)
      setAvatarPreview(null)

      // Reload fresh data from database
      await loadUserProfile()

    } catch (error: any) {
      console.error('Error updating profile:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to update profile. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setFormData({
      full_name: userProfile.full_name || '',
      phone: userProfile.phone || '',
      address: userProfile.address || '',
      bank_id: userProfile.bank_id || '',
      bank_account_number: userProfile.bank_account_number || '',
      bank_account_holder_name: userProfile.bank_account_holder_name || '',
      referral_phone: userProfile.referral_phone || ''
    })
    setAvatarFile(null)
    setAvatarPreview(null)
    setIsEditing(false)
  }

  // Helper function to convert text to title case
  const toTitleCase = (str: string): string => {
    return str.replace(/\b\w/g, (char) => char.toUpperCase())
  }

  const handleSaveBankDetails = async () => {
    setIsSavingBank(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('users')
        .update({
          bank_id: formData.bank_id || null,
          bank_account_number: formData.bank_account_number || null,
          bank_account_holder_name: formData.bank_account_holder_name || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (error) throw error

      toast({
        title: "Success",
        description: "Bank details saved successfully!",
      })

      // Update local state
      setUserProfile(prev => ({
        ...prev,
        bank_id: formData.bank_id || null,
        bank_account_number: formData.bank_account_number || null,
        bank_account_holder_name: formData.bank_account_holder_name || null
      }))
      setIsEditingBank(false)

      // Refresh profile to get updated bank name
      loadUserProfile()
    } catch (error: any) {
      console.error('Error saving bank details:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to save bank details",
        variant: "destructive",
      })
    } finally {
      setIsSavingBank(false)
    }
  }

  const handleCancelBankEdit = () => {
    setFormData(prev => ({
      ...prev,
      bank_id: userProfile.bank_id || '',
      bank_account_number: userProfile.bank_account_number || '',
      bank_account_holder_name: userProfile.bank_account_holder_name || ''
    }))
    setIsEditingBank(false)
  }

  const getInitials = (name: string | null, email: string): string => {
    if (name && name.trim()) {
      const parts = name.trim().split(' ')
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      return name.substring(0, 2).toUpperCase()
    }
    return email.substring(0, 2).toUpperCase()
  }

  const formatRelativeTime = (dateString: string | null): string => {
    if (!dateString) return 'Never'
    try {
      const date = new Date(dateString)
      const now = new Date()
      const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)
      if (seconds < 60) return 'just now'
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return `${minutes}m ago`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours}h ago`
      const days = Math.floor(hours / 24)
      if (days < 30) return `${days}d ago`
      const months = Math.floor(days / 30)
      if (months < 12) return `${months}mo ago`
      return `${Math.floor(months / 12)}y ago`
    } catch { return 'Unknown' }
  }

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return 'N/A'
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    } catch { return 'Invalid date' }
  }

  const formatDateTime = (dateString: string | null): string => {
    if (!dateString) return 'Never'
    try {
      return new Date(dateString).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch { return 'Invalid date' }
  }

  const formatLoginIp = (ip: string | null): string | null => {
    if (!ip) return null

    const normalized = ip.trim()
    if (!normalized) return null

    if (normalized === '127.0.0.1' || normalized === '::1' || normalized.toLowerCase() === 'localhost') {
      return '127.0.0.1 (localhost)'
    }

    return normalized
  }

  // Use shared getOrgTypeName from @/lib/utils/orgHierarchy

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  const displayLastLoginIp = formatLoginIp(userProfile.last_login_ip)

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Profile</h1>
          <p className="text-gray-600 mt-1">View and manage your personal information</p>
        </div>
        {!isEditing && (
          <Button onClick={() => setIsEditing(true)} className="gap-2 bg-blue-600 hover:bg-blue-700">
            <Edit2 className="h-4 w-4" />
            Edit Profile
          </Button>
        )}
      </div>

      {/* Verification Status Alert */}
      {(!userProfile.email_verified_at || !userProfile.phone_verified_at) && (
        <Alert className="border-yellow-500 bg-yellow-50">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            <strong>Action Required:</strong> Please verify your {' '}
            {!userProfile.email_verified_at && 'email'}
            {!userProfile.email_verified_at && !userProfile.phone_verified_at && ' and '}
            {!userProfile.phone_verified_at && 'phone number'} to complete your profile setup.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Profile Information Card */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Your personal details and avatar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar Section */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <Avatar className="h-24 w-24 cursor-pointer border-4 border-gray-100" onClick={handleAvatarClick}>
                  {(avatarPreview || userProfile.avatar_url) && (
                    <AvatarImage
                      src={avatarPreview || getStorageUrl(`${userProfile.avatar_url?.split('?')[0]}?v=${Date.now()}`) || userProfile.avatar_url}
                      alt={userProfile.full_name || 'User'}
                    />
                  )}
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white text-3xl font-semibold">
                    {getInitials(userProfile.full_name, userProfile.email)}
                  </AvatarFallback>
                </Avatar>
                {isEditing && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="absolute -bottom-2 -right-2 h-10 w-10 rounded-full p-0 shadow-lg hover:bg-blue-600 hover:text-white"
                    onClick={handleAvatarClick}
                  >
                    <Camera className="h-5 w-5" />
                  </Button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-semibold text-gray-900">
                  {userProfile.full_name || userProfile.email?.split('@')[0] || 'User'}
                </h2>
                <p className="text-sm text-gray-600">{userProfile.email}</p>
                {avatarFile && (
                  <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    New avatar selected
                  </p>
                )}
              </div>
            </div>

            {/* Editable Fields */}
            <div className="space-y-4 pt-4 border-t">
              {isEditing ? (
                <>
                  <div>
                    <Label htmlFor="full_name" className="text-sm font-medium">Full Name</Label>
                    <Input
                      id="full_name"
                      value={formData.full_name}
                      onChange={(e) => {
                        let newValue = e.target.value
                        // Auto-capitalize words in Full Name when space is pressed
                        if (newValue.endsWith(' ') && newValue.length > 1) {
                          const words = newValue.split(' ')
                          if (words.length >= 2) {
                            const lastWordIndex = words.length - 2
                            const lastWord = words[lastWordIndex]
                            if (lastWord) {
                              words[lastWordIndex] = lastWord.charAt(0).toUpperCase() + lastWord.slice(1).toLowerCase()
                              newValue = words.join(' ')
                            }
                          }
                        }
                        setFormData({ ...formData, full_name: newValue })
                      }}
                      placeholder="Enter your full name"
                      disabled={isSaving}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="phone" className="text-sm font-medium">Phone Number</Label>
                    <div className="relative">
                      <Input
                        id="phone"
                        value={formData.phone}
                        onChange={(e) => {
                          const val = e.target.value
                          setFormData({ ...formData, phone: val })
                          setPhoneCheckStatus('idle')

                          if (phoneCheckTimeoutRef.current) clearTimeout(phoneCheckTimeoutRef.current)
                          phoneCheckTimeoutRef.current = setTimeout(() => {
                            checkPhoneAvailability(val)
                          }, 500)
                        }}
                        placeholder="Enter your phone number"
                        disabled={isSaving}
                        className={`mt-1 pr-10 ${validationErrors.phone ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                      />
                      <div className="absolute right-3 top-3">
                        {phoneCheckStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                        {phoneCheckStatus === 'available' && <CheckCircle className="h-4 w-4 text-green-500" />}
                        {(phoneCheckStatus === 'taken' || phoneCheckStatus === 'invalid') && <XCircle className="h-4 w-4 text-red-500" />}
                      </div>
                    </div>
                    {phoneCheckStatus === 'available' && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Phone number is available</p>}
                    {validationErrors.phone && <p className="text-xs text-red-500 mt-1">{validationErrors.phone}</p>}
                  </div>

                  <div>
                    <Label htmlFor="referral_phone" className="text-sm font-medium">Referred By</Label>
                    <div className="relative">
                      <Input
                        id="referral_phone"
                        value={formData.referral_phone}
                        onChange={(e) => {
                          const val = e.target.value
                          setFormData({ ...formData, referral_phone: val })
                          setReferralCheckStatus('idle')
                          setReferralName('')

                          if (referralCheckTimeoutRef.current) clearTimeout(referralCheckTimeoutRef.current)
                          referralCheckTimeoutRef.current = setTimeout(() => {
                            checkReferralPhone(val)
                          }, 500)
                        }}
                        placeholder="Enter phone number or email"
                        disabled={isSaving}
                        className={`mt-1 pr-10 ${validationErrors.referral_phone ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                      />
                      <div className="absolute right-3 top-3">
                        {referralCheckStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                        {referralCheckStatus === 'valid' && <CheckCircle className="h-4 w-4 text-green-500" />}
                        {referralCheckStatus === 'invalid' && <XCircle className="h-4 w-4 text-red-500" />}
                      </div>
                    </div>
                    {referralCheckStatus === 'valid' && referralName && (
                      <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Representative found: {referralName}
                      </p>
                    )}
                    {validationErrors.referral_phone && <p className="text-xs text-red-500 mt-1">{validationErrors.referral_phone}</p>}
                  </div>
                  <div>
                    <Label htmlFor="address" className="text-sm font-medium">Address</Label>
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) => {
                        const value = e.target.value
                        // Convert to title case as user types
                        const titleCased = toTitleCase(value)
                        if (titleCased.length <= 255) {
                          setFormData({ ...formData, address: titleCased })
                        }
                      }}
                      placeholder="Enter your delivery address"
                      disabled={isSaving}
                      className="mt-1"
                      maxLength={255}
                    />
                    <p className="text-xs text-gray-500 mt-1">{formData.address.length}/255 characters</p>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">State</Label>
                    <Select
                      value={formData.location}
                      onValueChange={(value) => setFormData({ ...formData, location: value })}
                      disabled={isSaving}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select your state" />
                      </SelectTrigger>
                      <SelectContent>
                        {MALAYSIA_STATES.map((state) => (
                          <SelectItem key={state} value={state}>
                            {state}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {(!userProfile.organizations || !userProfile.organizations.org_name) && (
                    <div>
                      <Label htmlFor="shop_name" className="text-sm font-medium">Shop Name</Label>
                      <Input
                        id="shop_name"
                        value={formData.shop_name}
                        onChange={(e) => {
                          const value = e.target.value
                          const titleCased = toTitleCase(value)
                          if (titleCased.length <= 50) {
                            setFormData({ ...formData, shop_name: titleCased })
                          }
                        }}
                        placeholder="Enter your shop name"
                        disabled={isSaving}
                        className="mt-1"
                        maxLength={50}
                      />
                      <p className="text-xs text-gray-500 mt-1">{formData.shop_name.length}/50 characters</p>
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                    <Button
                      onClick={handleSave}
                      className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
                      disabled={isSaving}
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Save Changes
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleCancel}
                      variant="outline"
                      className="flex-1 gap-2"
                      disabled={isSaving}
                    >
                      <X className="h-4 w-4" />
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-3 text-gray-700">
                    <User className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-500 font-medium">Full Name</p>
                        <button
                          onClick={() => setIsEditing(true)}
                          className="text-xs italic text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          [Edit]
                        </button>
                      </div>
                      <p className="text-base font-medium text-gray-900 mt-1">
                        {userProfile.full_name || (
                          <span className="text-gray-400 italic">Not set</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 text-gray-700">
                    <Phone className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-500 font-medium">Phone Number</p>
                        <button
                          onClick={() => setIsEditing(true)}
                          className="text-xs italic text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          [Edit]
                        </button>
                      </div>
                      <p className="text-base font-medium text-gray-900 mt-1">
                        {userProfile.phone || (
                          <span className="text-gray-400 italic">Not set</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 text-gray-700">
                    <Shield className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-500 font-medium">Reference</p>
                        <button
                          onClick={() => setIsEditing(true)}
                          className="text-xs italic text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          [Edit]
                        </button>
                      </div>
                      <p className="text-base font-medium text-gray-900 mt-1">
                        {userProfile.referral_phone || (
                          <span className="text-gray-400 italic">Not set</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 text-gray-700">
                    <Home className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-500 font-medium">Address</p>
                        <button
                          onClick={() => setIsEditing(true)}
                          className="text-xs italic text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          [Edit]
                        </button>
                      </div>
                      <p className="text-base font-medium text-gray-900 mt-1">
                        {userProfile.address || (
                          <span className="text-gray-400 italic">Not set</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 text-gray-700">
                    <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-500 font-medium">State</p>
                        <button
                          onClick={() => setIsEditing(true)}
                          className="text-xs italic text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          [Edit]
                        </button>
                      </div>
                      <p className="text-base font-medium text-gray-900 mt-1">
                        {userProfile.location || (
                          <span className="text-gray-400 italic">Not set</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {(!userProfile.organizations || !userProfile.organizations.org_name) && (
                    <div className="flex items-start gap-3 text-gray-700">
                      <Building2 className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-gray-500 font-medium">Shop Name</p>
                          <button
                            onClick={() => setIsEditing(true)}
                            className="text-xs italic text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            [Edit]
                          </button>
                        </div>
                        <p className="text-base font-medium text-gray-900 mt-1">
                          {userProfile.shop_name || (
                            <span className="text-gray-400 italic">Not set</span>
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Account Information Card */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
            <CardDescription>Your account details and role</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 text-gray-700">
              <Mail className="h-5 w-5 text-gray-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-gray-500 font-medium">Email Address</p>
                <p className="text-base font-medium text-gray-900 mt-1 break-all">
                  {userProfile.email}
                </p>
                {userProfile.email_verified_at ? (
                  <Badge variant="outline" className="mt-2 bg-green-50 text-green-700 border-green-200">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Verified {formatRelativeTime(userProfile.email_verified_at)}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="mt-2 bg-yellow-50 text-yellow-700 border-yellow-200">
                    <XCircle className="h-3 w-3 mr-1" />
                    Not Verified
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3 text-gray-700">
              <Phone className="h-5 w-5 text-gray-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-gray-500 font-medium">Phone Verification</p>
                {userProfile.phone ? (
                  userProfile.phone_verified_at ? (
                    <Badge variant="outline" className="mt-2 bg-green-50 text-green-700 border-green-200">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Verified {formatRelativeTime(userProfile.phone_verified_at)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="mt-2 bg-yellow-50 text-yellow-700 border-yellow-200">
                      <XCircle className="h-3 w-3 mr-1" />
                      Not Verified
                    </Badge>
                  )
                ) : (
                  <p className="text-sm text-gray-400 italic mt-1">No phone number set</p>
                )}
              </div>
            </div>

            <div className="border-t pt-4"></div>

            <div className="flex items-start gap-3 text-gray-700">
              <Shield className="h-5 w-5 text-gray-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-gray-500 font-medium">Role</p>
                <p className="text-base font-medium text-gray-900 mt-1">
                  {userProfile.roles?.role_name || userProfile.role_code}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Level: {userProfile.roles?.role_level || 'Unknown'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 text-gray-700">
              <Building2 className="h-5 w-5 text-gray-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-gray-500 font-medium">Organization</p>
                <p className="text-base font-medium text-gray-900 mt-1">
                  {userProfile.organizations?.org_name || 'N/A'}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-xs">
                    {userProfile.organizations?.org_code || 'N/A'}
                  </Badge>
                  <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                    {getOrgTypeName(userProfile.organizations?.org_type_code || '')}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Department & Reports To — portal-only blocks */}
            {userProfile.account_scope === 'portal' && userProfile.organization_id && (
              <>
                {/* Department (HR Foundation) */}
                <div className="flex items-start gap-3 text-gray-700">
                  <Briefcase className="h-5 w-5 text-gray-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-gray-500 font-medium">Department</p>
                    {userProfile.departments ? (
                      <>
                        <p className="text-base font-medium text-gray-900 mt-1">
                          {userProfile.departments.dept_name}
                        </p>
                        {userProfile.departments.dept_code && (
                          <Badge variant="outline" className="text-xs mt-1">
                            {userProfile.departments.dept_code}
                          </Badge>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-gray-400 italic mt-1">Not assigned</p>
                    )}
                  </div>
                </div>

                {/* Reports To (HR Foundation) */}
                <div className="flex items-start gap-3 text-gray-700">
                  <UserCheck className="h-5 w-5 text-gray-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-gray-500 font-medium">Reports To</p>
                    {userProfile.manager ? (
                      <>
                        <p className="text-base font-medium text-gray-900 mt-1">
                          {userProfile.manager.full_name || userProfile.manager.email}
                        </p>
                        {userProfile.manager.full_name && (
                          <p className="text-xs text-gray-500 mt-1">
                            {userProfile.manager.email}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-gray-400 italic mt-1">Not assigned</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity Information */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Activity & Timeline</CardTitle>
          <CardDescription>Your account activity and login history</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-start gap-3 text-gray-700">
              <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-gray-500 font-medium">Member Since</p>
                <p className="text-base font-medium text-gray-900 mt-1">
                  {formatDate(userProfile.created_at)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {formatRelativeTime(userProfile.created_at)}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 text-gray-700">
              <Clock className="h-5 w-5 text-gray-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-gray-500 font-medium">Last Login</p>
                <p className="text-base font-medium text-gray-900 mt-1">
                  {formatDateTime(userProfile.last_login_at)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {formatRelativeTime(userProfile.last_login_at)}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 text-gray-700">
              <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-gray-500 font-medium">Last Login IP</p>
                <p className="text-base font-medium text-gray-900 mt-1">
                  {displayLastLoginIp ? (
                    displayLastLoginIp
                  ) : (
                    <span className="text-gray-400 italic">Not available</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account Status Card */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Account Status</CardTitle>
          <CardDescription>Current verification and account status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-center gap-3">
              <div className={`h-4 w-4 rounded-full ${userProfile.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
              <div>
                <p className="text-sm text-gray-500 font-medium">Account Status</p>
                <p className="text-base font-medium text-gray-900">
                  {userProfile.is_active ? 'Active' : 'Inactive'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className={`h-4 w-4 rounded-full ${userProfile.is_verified ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <div>
                <p className="text-sm text-gray-500 font-medium">Verification Status</p>
                <p className="text-base font-medium text-gray-900">
                  {userProfile.is_verified ? 'Verified' : 'Pending'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500 font-medium">Last Updated</p>
                <p className="text-base font-medium text-gray-900">
                  {formatRelativeTime(userProfile.updated_at)}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bank Information Card */}
      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Bank Information</CardTitle>
              <CardDescription>Your bank account details for payouts and transfers</CardDescription>
            </div>
            {!isEditingBank && (
              <Button onClick={() => setIsEditingBank(true)} variant="outline" size="sm" className="gap-2">
                <Edit2 className="h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isEditingBank ? (
            <>
              <div>
                <Label htmlFor="bank_account_holder_name" className="text-sm font-medium">Account Holder Name</Label>
                <Input
                  id="bank_account_holder_name"
                  value={formData.bank_account_holder_name}
                  onChange={(e) => setFormData({ ...formData, bank_account_holder_name: e.target.value.toUpperCase() })}
                  placeholder="e.g., ALI BIN ABU"
                  disabled={isSavingBank}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="bank_id" className="text-sm font-medium">Bank Name</Label>
                <select
                  id="bank_id"
                  value={formData.bank_id}
                  onChange={(e) => setFormData({ ...formData, bank_id: e.target.value })}
                  disabled={isSavingBank}
                  className="w-full mt-1 h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Select Bank</option>
                  {banks.map(bank => (
                    <option key={bank.id} value={bank.id}>{bank.short_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="bank_account_number" className="text-sm font-medium">Account Number</Label>
                <Input
                  id="bank_account_number"
                  value={formData.bank_account_number}
                  onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value.replace(/\D/g, '') })}
                  placeholder="e.g., 1234567890"
                  disabled={isSavingBank}
                  className="mt-1"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <Button
                  onClick={handleSaveBankDetails}
                  className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
                  disabled={isSavingBank}
                >
                  {isSavingBank ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Bank Details
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleCancelBankEdit}
                  variant="outline"
                  className="flex-1 gap-2"
                  disabled={isSavingBank}
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3 text-gray-700">
                <User className="h-5 w-5 text-gray-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-gray-500 font-medium">Account Holder Name</p>
                  <p className="text-base font-medium text-gray-900 mt-1">
                    {userProfile.bank_account_holder_name || (
                      <span className="text-gray-400 italic">Not set</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-gray-700">
                <Landmark className="h-5 w-5 text-gray-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-gray-500 font-medium">Bank Name</p>
                  <p className="text-base font-medium text-gray-900 mt-1">
                    {userProfile.msia_banks?.short_name || (
                      <span className="text-gray-400 italic">Not set</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-gray-700">
                <CreditCard className="h-5 w-5 text-gray-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-gray-500 font-medium">Account Number</p>
                  <p className="text-base font-medium text-gray-900 mt-1">
                    {userProfile.bank_account_number || (
                      <span className="text-gray-400 italic">Not set</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Digital Signature Card - Hidden for Warehouse users */}
      {userProfile?.organizations?.org_type_code !== 'WAREHOUSE' && userProfile?.organizations?.org_type_code !== 'WH' && (
        <Card className="shadow-lg md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Digital Signature</CardTitle>
                <CardDescription>Upload your signature for document acknowledgement</CardDescription>
              </div>
              {userProfile.signature_url && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Uploaded
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-blue-200 bg-blue-50">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                <strong>Required for Document Acknowledgement:</strong> Upload your digital signature to acknowledge Purchase Orders, Invoices, Payments, and other documents.
                <div className="mt-2 text-sm">
                  <p className="font-medium mb-1">Tips for best results:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>Sign on white paper with dark ink</li>
                    <li>Take a clear photo or scan the signature</li>
                    <li>Use transparent PNG format (recommended)</li>
                    <li>Ensure signature is clearly visible</li>
                  </ul>
                </div>
              </AlertDescription>
            </Alert>

            <SignatureUpload
              userId={userProfile.id}
              currentSignatureUrl={userProfile.signature_url}
              onSignatureUpdated={(url) => {
                setUserProfile(prev => ({ ...prev, signature_url: url || null }))
                loadUserProfile() // Refresh the entire profile
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Change Password Card */}
      <ChangePasswordCard userEmail={userProfile.email} userPhone={userProfile.phone} />
    </div>
  )
}
