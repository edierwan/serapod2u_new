'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import { User, Mail, Building2, Shield, Calendar, Phone, MapPin, Edit2, Save, X, Loader2 } from 'lucide-react'

interface MyProfileViewProps {
  userProfile: any
}

export default function MyProfileView({ userProfile }: MyProfileViewProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [localProfile, setLocalProfile] = useState(userProfile)
  const [formData, setFormData] = useState({
    full_name: userProfile?.full_name || '',
    phone: userProfile?.phone || '',
    address: userProfile?.address || ''
  })
  const { toast } = useToast()
  const supabase = createClient()

  // Update local profile when userProfile changes
  useEffect(() => {
    setLocalProfile(userProfile)
    setFormData({
      full_name: userProfile?.full_name || '',
      phone: userProfile?.phone || '',
      address: userProfile?.address || ''
    })
  }, [userProfile])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const { data, error } = await supabase
        .from('users')
        .update({
          full_name: formData.full_name || null,
          phone: formData.phone || null,
          address: formData.address || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', userProfile.id)
        .select()
        .single()

      if (error) throw error

      // Update local state with saved data
      setLocalProfile({ ...localProfile, ...formData })
      
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
      phone: localProfile?.phone || '',
      address: localProfile?.address || ''
    })
    setIsEditing(false)
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
            <div className="h-20 w-20 rounded-full bg-blue-100 flex items-center justify-center">
              <User className="h-10 w-10 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {localProfile?.full_name || localProfile?.email?.split('@')[0]}
              </h2>
              <p className="text-sm text-gray-600">{localProfile?.email}</p>
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
                <div>
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Enter your address"
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
                <div className="flex items-center gap-3 text-gray-700">
                  <MapPin className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Address</p>
                    <p className="font-medium">{localProfile?.address || 'Not set'}</p>
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
