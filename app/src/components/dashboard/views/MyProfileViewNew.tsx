'use client'

import { useState, useEffect, useRef } from 'react'
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
  Loader2, Camera, CheckCircle, XCircle, Clock, MapPin, AlertCircle 
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import ThemePreferencesCard from './ThemePreferencesCard'
import SignatureUpload from '@/components/profile/SignatureUpload'

interface UserProfile {
  id: string
  email: string
  full_name: string | null
  phone: string | null
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
}

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
    phone: ''
  })
  const { toast } = useToast()
  const supabase = createClient()

  // Load fresh user data on mount and when editing is cancelled
  useEffect(() => {
    loadUserProfile()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadUserProfile = async () => {
    try {
      setIsLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        toast({
          title: "Error",
          description: "Not authenticated",
          variant: "destructive",
        })
        return
      }

      // Fetch complete user profile with related data
      const { data: profile, error } = await supabase
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
          )
        `)
        .eq('id', user.id)
        .single()

      if (error) throw error

      if (profile) {
        // Transform the data structure
        const transformedProfile: UserProfile = {
          ...(profile as any),
          organizations: Array.isArray((profile as any).organizations) 
            ? (profile as any).organizations[0] 
            : (profile as any).organizations,
          roles: Array.isArray((profile as any).roles) 
            ? (profile as any).roles[0] 
            : (profile as any).roles
        }
        
        setUserProfile(transformedProfile)
        setFormData({
          full_name: transformedProfile.full_name || '',
          phone: transformedProfile.phone || ''
        })
      }
    } catch (error: any) {
      console.error('Error loading profile:', error)
      toast({
        title: "Error",
        description: "Failed to load profile data",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "Image must be less than 5MB.",
          variant: "destructive",
        })
        return
      }
      
      setAvatarFile(file)
      
      // Create preview
      const reader = new FileReader()
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleAvatarClick = () => {
    if (isEditing) {
      fileInputRef.current?.click()
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      let updateData: any = {
        full_name: formData.full_name?.trim() || null,
        phone: formData.phone?.trim() || null,
        updated_at: new Date().toISOString()
      }

      // Handle avatar upload if file is selected
      if (avatarFile) {
        try {
          // Delete old avatar if exists
          if (userProfile.avatar_url) {
            const oldPath = userProfile.avatar_url.split('/').pop()?.split('?')[0]
            if (oldPath) {
              const pathToDelete = `${userProfile.id}/${oldPath}`
              await supabase.storage.from('avatars').remove([pathToDelete])
            }
          }
          
          // Upload new avatar
          const fileExtension = avatarFile.name.split('.').pop()
          const fileName = `${Date.now()}.${fileExtension}`
          const filePath = `${userProfile.id}/${fileName}`
          
          const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(filePath, avatarFile, {
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

      // Update user profile in database
      const { data, error } = await (supabase as any)
        .from('users')
        .update(updateData)
        .eq('id', userProfile.id)
        .select()
        .single()

      if (error) throw error

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
      phone: userProfile.phone || ''
    })
    setAvatarFile(null)
    setAvatarPreview(null)
    setIsEditing(false)
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

  const getOrgTypeName = (orgTypeCode: string): string => {
    const typeNames: Record<string, string> = {
      'HQ': 'Headquarters',
      'MANU': 'Manufacturer',
      'DIST': 'Distributor',
      'WH': 'Warehouse',
      'SHOP': 'Shop',
    }
    return typeNames[orgTypeCode] || orgTypeCode
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

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
                      src={avatarPreview || `${userProfile.avatar_url?.split('?')[0]}?v=${Date.now()}`} 
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
                      onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                      placeholder="Enter your full name"
                      disabled={isSaving}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="phone" className="text-sm font-medium">Phone Number</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="Enter your phone number"
                      disabled={isSaving}
                      className="mt-1"
                    />
                  </div>
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
                  {userProfile.last_login_ip || (
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

      {/* Theme Preferences Card */}
      <ThemePreferencesCard />
    </div>
  )
}
