'use client'

import { useState, useRef, useEffect } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Upload, X, Loader2 } from 'lucide-react'
import { User, Role, Organization } from '@/types/user'

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

  // Filter roles based on current user's role level
  // Users can only assign roles equal to or lower than their own level (higher number = lower access)
  const availableRoles = roles.filter(role => role.role_level >= currentUserRoleLevel)

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
  }

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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg max-h-screen overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-gray-900">
            {user ? 'Edit User' : 'Add New User'}
          </h2>
          <button 
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900">Basic Information</h3>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
              <div className="flex flex-col items-center">
                <Avatar className="w-20 h-20 mb-4">
                  <AvatarImage src={avatarPreview || undefined} />
                  <AvatarFallback className="text-lg bg-gradient-to-br from-blue-500 to-purple-500 text-white">
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
                <p className="text-xs text-gray-500 mb-2">PNG, JPG or GIF (max 5MB)</p>
                {avatarFile && (
                  <div className="mt-3 flex items-center gap-2 w-full justify-center">
                    <span className="text-sm text-gray-700 truncate flex-1">{avatarFile.name}</span>
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
                <p className="text-xs text-gray-500">Minimum 6 characters</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                placeholder="+60123456789"
                value={formData.phone || ''}
                onChange={(e) => handleInputChange('phone', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Role & Access</h3>

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

            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="pt-6">
                <p className="text-xs text-blue-800">
                  <strong>Role Levels:</strong> Super Admin (1) → HQ Admin (10) → Power User (20) → Manager (30) → User (40) → Guest (50)
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 pt-4 border-t border-gray-200">
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
              />
            </div>

            {user && (
              <Card className="bg-gray-50 border-gray-200">
                <CardContent className="pt-6">
                  <h4 className="text-sm text-gray-700 font-medium mb-4">Account Information</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Created</span>
                      <p className="text-gray-900 font-medium">
                        {formatDate(user.created_at)}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Updated</span>
                      <p className="text-gray-900 font-medium">
                        {formatDate(user.updated_at)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
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
