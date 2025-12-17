'use client'

import { useState, useEffect, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { User, Mail, Building2, Shield, Calendar, Phone, Edit2, Save, X, Loader2, Camera, Upload } from 'lucide-react'
import { getStorageUrl } from '@/lib/utils'
import { compressAvatar, formatFileSize } from '@/lib/utils/imageCompression'

interface MyProfileViewProps {
  userProfile: any
}

export default function MyProfileView({ userProfile }: MyProfileViewProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [localProfile, setLocalProfile] = useState(userProfile)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarRefresh, setAvatarRefresh] = useState(Date.now())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [formData, setFormData] = useState({
    full_name: userProfile?.full_name || '',
    phone: userProfile?.phone || ''
  })
  const { toast } = useToast()
  const supabase = createClient()

  // Update local profile when userProfile changes
  useEffect(() => {
    setLocalProfile(userProfile)
    setFormData({
      full_name: userProfile?.full_name || '',
      phone: userProfile?.phone || ''
    })
    setAvatarRefresh(Date.now())
  }, [userProfile])

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
        full_name: formData.full_name || null,
        phone: formData.phone || null,
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
          if (localProfile.avatar_url) {
            const oldPath = localProfile.avatar_url.split('/').pop()?.split('?')[0]
            if (oldPath) {
              const pathToDelete = `${userProfile.id}/${oldPath}`
              await supabase.storage.from('avatars').remove([pathToDelete])
            }
          }
          
          const fileName = `${Date.now()}.jpg`
          const filePath = `${userProfile.id}/${fileName}`
          
          const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(filePath, compressionResult.file, {
              contentType: compressionResult.file.type,
              cacheControl: '3600',
              upsert: true
            })
          
          if (uploadError) {
            console.error('Upload error:', uploadError)
            toast({ 
              title: 'Warning', 
              description: 'Avatar upload failed, but other changes saved.', 
              variant: 'default' 
            })
          } else {
            const { data } = supabase.storage.from('avatars').getPublicUrl(filePath)
            updateData.avatar_url = data.publicUrl
          }
        } catch (avatarError) {
          console.error('Avatar upload error:', avatarError)
          toast({ 
            title: 'Warning', 
            description: 'Avatar upload failed, but other changes saved.', 
            variant: 'default' 
          })
        }
      }

      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userProfile.id)
        .select()
        .single()

      if (error) throw error

      // Update local state with saved data
      setLocalProfile({ ...localProfile, ...updateData })
      setAvatarFile(null)
      setAvatarPreview(null)
      setAvatarRefresh(Date.now())
      
      toast({
        title: "Success",
        description: "Your profile has been updated successfully.",
      })
      
      setIsEditing(false)
      
      // Refresh the page to update all components with new data
      setTimeout(() => {
        window.location.reload()
      }, 1000)
      
    } catch (error) {
      console.error('Error updating profile:', error)
      toast({
        title: "Error",
        description: "Failed to update profile. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setFormData({
      full_name: localProfile?.full_name || '',
      phone: localProfile?.phone || ''
    })
    setAvatarFile(null)
    setAvatarPreview(null)
    setIsEditing(false)
  }

  const getInitials = (name: string | null, email: string): string => {
    if (name) {
      const parts = name.trim().split(' ')
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      return name.substring(0, 2).toUpperCase()
    }
    return email.substring(0, 2).toUpperCase()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
          <p className="text-gray-600 mt-1">View and manage your personal information</p>
        </div>
        {!isEditing && (
          <Button onClick={() => setIsEditing(true)} className="gap-2">
            <Edit2 className="h-4 w-4" />
            Edit Profile
          </Button>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Profile Information Card */}
        <Card className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="relative">
              <Avatar className="h-20 w-20 cursor-pointer" onClick={handleAvatarClick}>
                {(avatarPreview || localProfile?.avatar_url) && (
                  <AvatarImage 
                    src={avatarPreview || getStorageUrl(`${localProfile?.avatar_url?.split('?')[0]}?v=${avatarRefresh}`) || localProfile?.avatar_url} 
                    alt={localProfile?.full_name || 'User'} 
                  />
                )}
                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white text-2xl font-semibold">
                  {getInitials(localProfile?.full_name, localProfile?.email)}
                </AvatarFallback>
              </Avatar>
              {isEditing && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full p-0 shadow-lg"
                  onClick={handleAvatarClick}
                >
                  <Camera className="h-4 w-4" />
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
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {localProfile?.full_name || localProfile?.email?.split('@')[0]}
              </h2>
              <p className="text-sm text-gray-600">{localProfile?.email}</p>
              {isEditing && avatarFile && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <Upload className="h-3 w-3" />
                  New image selected
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {isEditing ? (
              <>
                <div>
                  <Label htmlFor="full_name">Full Name</Label>
                  <Input
                    id="full_name"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    placeholder="Enter your full name"
                    disabled={isSaving}
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="Enter your phone number"
                    disabled={isSaving}
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <Button 
                    onClick={handleSave} 
                    className="flex-1 gap-2"
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
                <div className="flex items-center gap-3 text-gray-700">
                  <User className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Full Name</p>
                    <p className="font-medium">{localProfile?.full_name || 'Not set'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-gray-700">
                  <Phone className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Phone Number</p>
                    <p className="font-medium">{localProfile?.phone || 'Not set'}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Account Information Card */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Account Information</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-gray-700">
              <Mail className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Email Address</p>
                <p className="font-medium">{localProfile?.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-gray-700">
              <Shield className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Role</p>
                <p className="font-medium">
                  {localProfile?.roles?.role_name || localProfile?.role_code}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-gray-700">
              <Building2 className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Organization</p>
                <p className="font-medium">
                  {localProfile?.organizations?.org_name || 'N/A'}
                </p>
                <p className="text-xs text-gray-500">
                  Type: {localProfile?.organizations?.org_type_code || 'N/A'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-gray-700">
              <Calendar className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Member Since</p>
                <p className="font-medium">
                  {localProfile?.created_at 
                    ? new Date(localProfile.created_at).toLocaleDateString()
                    : 'N/A'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-gray-700">
              <Calendar className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Last Login</p>
                <p className="font-medium">
                  {localProfile?.last_login_at 
                    ? new Date(localProfile.last_login_at).toLocaleString()
                    : 'Never'}
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Additional Information */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Account Status</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${localProfile?.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-gray-700">
              Account Status: <span className="font-medium">{localProfile?.is_active ? 'Active' : 'Inactive'}</span>
            </span>
          </div>
          {localProfile?.email_verified && (
            <div className="flex items-center gap-2 text-green-600">
              <Shield className="h-4 w-4" />
              <span className="text-sm">Email Verified</span>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
