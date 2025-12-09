'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ArrowLeft, Save, Info, AlertTriangle, Star, Link as LinkIcon } from 'lucide-react'
import OrgLogoUpload from './OrgLogoUpload'
import {
  getValidParentOrgs, 
  isParentRequired, 
  getParentHelpText,
  getParentFieldLabel,
  parseHierarchyError,
  validateOrgHierarchy,
  type OrgType
} from '@/lib/utils/orgHierarchy'
import type { Organization, OrganizationFormData } from '@/lib/types/organization'

interface EditOrganizationViewProps {
  userProfile: {
    id: string
    organization_id: string
  }
  onViewChange?: (view: string) => void
}

interface ParentOrganization {
  id: string
  org_code: string
  org_name: string
  org_type_code: string
}

interface StateOption {
  id: string
  state_code: string
  state_name: string
}

interface DistrictOption {
  id: string
  district_code: string
  district_name: string
  state_id: string
}

interface PaymentTerm {
  id: string
  term_code: string
  term_name: string
  deposit_percentage: number
  balance_percentage: number
  description: string | null
  is_default: boolean
  is_active: boolean
}

export default function EditOrganizationView({ userProfile, onViewChange }: EditOrganizationViewProps) {
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState<OrganizationFormData>({})
  const [parentOrgs, setParentOrgs] = useState<ParentOrganization[]>([])
  const [filteredParentOrgs, setFilteredParentOrgs] = useState<ParentOrganization[]>([])
  const [states, setStates] = useState<StateOption[]>([])
  const [districts, setDistricts] = useState<DistrictOption[]>([])
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>([])
  const [childOrgs, setChildOrgs] = useState<any[]>([])
  const [shopDistributors, setShopDistributors] = useState<any[]>([])
  const [orgUsers, setOrgUsers] = useState<any[]>([])
  const [authError, setAuthError] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoError, setLogoError] = useState('')
  const { isReady, supabase, error: authHookError } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    // Handle auth errors from the hook
    if (authHookError) {
      setAuthError(authHookError)
      if (authHookError.includes('Session expired')) {
        setTimeout(() => {
          window.location.href = '/login'
        }, 2000)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHookError])

  useEffect(() => {
    if (isReady) {
      loadStates()
      loadPaymentTerms()
      const orgId = sessionStorage.getItem('selectedOrgId')
      if (orgId) {
        loadOrganization(orgId)
        loadParentOrganizations()
        loadChildOrganizations(orgId)
        loadShopDistributors(orgId)
        loadOrganizationUsers(orgId)
      } else {
        // No org selected, go back to organizations
        onViewChange?.('organizations')
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  // Filter parent organizations when org type changes
  useEffect(() => {
    if (formData.org_type_code) {
      const validParents = getValidParentOrgs(
        formData.org_type_code as OrgType,
        parentOrgs as any[]
      )
      setFilteredParentOrgs(validParents as ParentOrganization[])
      
      // Clear parent_org_id if current selection is not valid
      if (formData.parent_org_id) {
        const isValid = validParents.some(p => p.id === formData.parent_org_id)
        if (!isValid) {
          handleInputChange('parent_org_id', null)
        }
      }
      
      // For HQ, always clear parent
      if (formData.org_type_code === 'HQ') {
        handleInputChange('parent_org_id', null)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.org_type_code, parentOrgs])

  useEffect(() => {
    if (formData.state_id) {
      loadDistrictsForState(formData.state_id)
    } else {
      setDistricts([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.state_id])

  const loadParentOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_code, org_name, org_type_code')
        .eq('is_active', true)
        .order('org_name')

      if (error) throw error
      setParentOrgs(data || [])
    } catch (error) {
      console.error('Error loading parent organizations:', error)
    }
  }

  const loadPaymentTerms = async () => {
    try {
      const { data, error } = await supabase
        .from('payment_terms')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')

      if (error) throw error
      setPaymentTerms(data || [])
    } catch (error) {
      console.error('Error loading payment terms:', error)
    }
  }

  const loadChildOrganizations = async (orgId: string) => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_code, org_name, org_type_code')
        .eq('parent_org_id', orgId)

      if (error) throw error
      setChildOrgs(data || [])
    } catch (error) {
      console.error('Error loading child organizations:', error)
    }
  }

  const loadShopDistributors = async (orgId: string) => {
    try {
      // Only load for SHOP organizations
      const { data: orgData } = await (supabase as any)
        .from('organizations')
        .select('org_type_code')
        .eq('id', orgId)
        .single()

      if (orgData?.org_type_code === 'SHOP') {
        const { data, error } = await (supabase as any)
          .from('shop_distributors')
          .select(`
            *,
            distributor:organizations!shop_distributors_distributor_id_fkey(
              id,
              org_name,
              org_code
            )
          `)
          .eq('shop_id', orgId)
          .eq('is_active', true)
          .order('is_preferred', { ascending: false })

        if (error) throw error
        
        const transformed = (data || []).map((sd: any) => ({
          ...sd,
          distributor: Array.isArray(sd.distributor) ? sd.distributor[0] : sd.distributor
        }))
        
        setShopDistributors(transformed)
      }
    } catch (error) {
      console.error('Error loading shop distributors:', error)
    }
  }

  const loadOrganizationUsers = async (orgId: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          id,
          email,
          full_name,
          phone,
          is_active,
          roles:role_code (
            role_name,
            role_level
          )
        `)
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('full_name', { ascending: true })

      if (error) throw error
      
      console.log('📊 Loaded organization users:', data?.length)
      setOrgUsers(data || [])
    } catch (error) {
      console.error('Error loading organization users:', error)
    }
  }

  const loadStates = async () => {
    try {
      const { data, error } = await supabase
        .from('states')
        .select('id, state_code, state_name')
        .eq('is_active', true)
        .order('state_name', { ascending: true })

      if (error) throw error
      setStates(data || [])
    } catch (error) {
      console.error('Error loading states:', error)
      setStates([])
    }
  }

  const loadDistrictsForState = async (stateId: string) => {
    try {
      const { data, error } = await supabase
        .from('districts')
        .select('id, district_code, district_name, state_id')
        .eq('state_id', stateId)
        .eq('is_active', true)
        .order('district_name', { ascending: true })

      if (error) throw error
      setDistricts(data || [])
    } catch (error) {
      console.error('Error loading districts:', error)
      setDistricts([])
    }
  }

  const loadOrganization = async (orgId: string) => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single()

      if (error) throw error

      if (data?.state_id) {
        await loadDistrictsForState(data.state_id)
      }

      setOrganization(data as Organization)
      setFormData(data as OrganizationFormData)
    } catch (error) {
      console.error('Error loading organization:', error)
      toast({
        title: '✕ Load Failed',
        description: 'Could not load organization details',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleLogoChange = (file: File | null) => {
    setLogoFile(file)
    if (file && !file.type.startsWith('image/')) {
      setLogoError('Please select an image file')
    } else if (file && file.size > 5 * 1024 * 1024) {
      setLogoError('Image must be less than 5MB')
    } else {
      setLogoError('')
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)

      // Validate required parent_org_id for organizations that need it
      if (isParentRequired(formData.org_type_code as OrgType || organization?.org_type_code as OrgType)) {
        if (!formData.parent_org_id) {
          toast({
            title: '✕ Validation Error',
            description: `${getParentFieldLabel(formData.org_type_code as OrgType || organization?.org_type_code as OrgType)} is required`,
            variant: 'destructive'
          })
          setSaving(false)
          return
        }
      }

      // Upload logo if a new file is provided
      let logo_url = formData.logo_url

      if (logoFile) {
        try {
          const fileExt = logoFile.name.split('.').pop()
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
          const filePath = `${organization!.id}/${fileName}` // Nested folder: org_id/filename

          // Delete old logo if exists (using same pattern as user avatars)
          if (organization?.logo_url) {
            try {
              const oldPath = organization.logo_url.split('/').pop()?.split('?')[0]
              if (oldPath) {
                await supabase.storage
                  .from('avatars')
                  .remove([`${organization.id}/${oldPath}`])
              }
            } catch (deleteError) {
              console.error('Error deleting old logo:', deleteError)
            }
          }

          const { error: uploadError } = await supabase.storage
            .from('avatars') // Use same bucket as user avatars
            .upload(filePath, logoFile, {
              cacheControl: '3600',
              upsert: true // Allow overwrite
            })

          if (uploadError) {
            console.error('Logo upload error:', uploadError)
            toast({
              title: '⚠️ Logo Upload Warning',
              description: 'Logo upload failed, but other changes will be saved',
              variant: 'destructive'
            })
          } else {
            const { data: { publicUrl } } = supabase.storage
              .from('avatars')
              .getPublicUrl(filePath)
            
            logo_url = `${publicUrl}?v=${Date.now()}` // Add cache-busting
          }
        } catch (logoUploadError) {
          console.error('Error uploading logo:', logoUploadError)
        }
      }

      // Build update payload - only include fields that exist in formData
      const updatePayload: Record<string, any> = {
        updated_at: new Date().toISOString(),
        updated_by: userProfile.id
      }

      // Only include fields that are actually in the form
      if (formData.org_name !== undefined) updatePayload.org_name = formData.org_name
      if (formData.contact_name !== undefined) updatePayload.contact_name = formData.contact_name || null
      if (formData.contact_title !== undefined) updatePayload.contact_title = formData.contact_title || null
      if (formData.contact_phone !== undefined) updatePayload.contact_phone = formData.contact_phone || null
      if (formData.contact_email !== undefined) updatePayload.contact_email = formData.contact_email || null
      if (formData.address !== undefined) updatePayload.address = formData.address || null
      if (formData.address_line2 !== undefined) updatePayload.address_line2 = formData.address_line2 || null
      if (formData.city !== undefined) updatePayload.city = formData.city || null
      if (formData.state_id !== undefined) updatePayload.state_id = formData.state_id || null
      if (formData.district_id !== undefined) updatePayload.district_id = formData.district_id || null
      if (formData.postal_code !== undefined) updatePayload.postal_code = formData.postal_code || null
      if (formData.country_code !== undefined) updatePayload.country_code = formData.country_code || null
      if (formData.website !== undefined) updatePayload.website = formData.website || null
      if (logo_url !== undefined) updatePayload.logo_url = logo_url
      if (formData.payment_term_id !== undefined) updatePayload.payment_term_id = formData.payment_term_id || null
      if (formData.warranty_bonus !== undefined) updatePayload.warranty_bonus = formData.warranty_bonus

      // Handle parent_org_id - include if changed OR if org type requires parent and it's missing
      const needsParent = isParentRequired(organization?.org_type_code as OrgType)
      const parentChanged = formData.parent_org_id !== undefined && formData.parent_org_id !== organization?.parent_org_id
      const parentMissing = needsParent && !organization?.parent_org_id && formData.parent_org_id
      
      if (parentChanged || parentMissing) {
        // Validate hierarchy when parent is being changed or added
        const parentOrg = formData.parent_org_id 
          ? parentOrgs.find(p => p.id === formData.parent_org_id)
          : undefined
        
        const hierarchyError = validateOrgHierarchy(
          organization?.org_type_code as OrgType,
          formData.parent_org_id || null,
          parentOrg?.org_type_code as OrgType | undefined
        )
        
        if (hierarchyError) {
          toast({
            title: '✕ Invalid Hierarchy',
            description: hierarchyError,
            variant: 'destructive'
          })
          setSaving(false)
          return
        }

        updatePayload.parent_org_id = formData.parent_org_id || null
      }

      const { error } = await (supabase as any)
        .from('organizations')
        .update(updatePayload)
        .eq('id', organization!.id)

      if (error) throw error

      // Auto-repair: If this is a SHOP with a DIST parent, ensure shop_distributors entry exists
      if (organization?.org_type_code === 'SHOP' && updatePayload.parent_org_id) {
        const parentOrg = parentOrgs.find(p => p.id === updatePayload.parent_org_id)
        if (parentOrg?.org_type_code === 'DIST') {
          // Check if shop_distributors entry exists
          const { data: existing, error: checkError } = await (supabase as any)
            .from('shop_distributors')
            .select('id')
            .eq('shop_id', organization.id)
            .eq('distributor_id', updatePayload.parent_org_id)
            .maybeSingle()

          if (!checkError && !existing) {
            // Entry doesn't exist, create it
            console.log('🔧 Auto-repair: Creating missing shop_distributors entry...')
            const { error: linkError } = await (supabase as any)
              .from('shop_distributors')
              .insert([{
                shop_id: organization.id,
                distributor_id: updatePayload.parent_org_id,
                payment_terms: 'NET_30',
                is_active: true,
                is_preferred: shopDistributors.length === 0, // Make preferred if it's the first one
                created_by: userProfile.id
              }])

            if (!linkError) {
              console.log('✅ Auto-repair: shop_distributors entry created successfully')
            } else {
              console.error('❌ Auto-repair failed:', linkError)
            }
          }
        }
      }

      toast({
        title: '✓ Saved Successfully',
        description: `${formData.org_name || organization?.org_name || 'Organization'} has been updated`,
        variant: 'success'
      })

      // Set flag to refresh links and go back to organizations
      sessionStorage.setItem('needsLinkRefresh', 'true')
      
      // Go back to organizations
      setTimeout(() => {
        onViewChange?.('organizations')
      }, 500)
    } catch (error: any) {
      console.error('Error saving organization:', error)
      const friendlyError = parseHierarchyError(error)
      toast({
        title: '✕ Save Failed',
        description: friendlyError,
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    )
  }

  // Show auth error if present
  if (authError) {
    return (
      <Card className="border-red-200">
        <CardContent className="p-12 text-center">
          <AlertTriangle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <p className="text-red-600 font-medium mb-2">{authError}</p>
          <p className="text-gray-600 mb-4">Your session may have expired. Please log in again.</p>
          <Button 
            onClick={() => window.location.href = '/login'}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Go to Login
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!organization) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <p className="text-gray-600">Organization not found</p>
          <Button 
            onClick={() => onViewChange?.('organizations')}
            className="mt-4"
          >
            Back to Organizations
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onViewChange?.('organizations')}
              className="pl-0"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">{organization.org_name}</h2>
          <p className="text-gray-600">{organization.org_code} • {organization.org_type_code}</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
      </div>

      {/* Organization Details Form */}
      <Card>
        <CardHeader>
          <CardTitle>Organization Information</CardTitle>
          <CardDescription>Edit basic organization details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo Upload */}
          <OrgLogoUpload
            currentLogoUrl={organization.logo_url}
            orgName={organization.org_name}
            onLogoChange={handleLogoChange}
            error={logoError}
          />

          {/* Warning if child organizations exist */}
          {childOrgs.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This organization has {childOrgs.length} child organization(s). Changing the parent may affect the organizational structure.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="org_name">Organization Name</Label>
              <Input
                id="org_name"
                value={formData.org_name || ''}
                onChange={(e) => handleInputChange('org_name', e.target.value)}
                placeholder="Enter organization name"
                className={!formData.org_name ? 'placeholder:text-gray-300' : ''}
              />
              {!formData.org_name && (
                <p className="text-xs text-gray-400 italic">Required - enter the organization name</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                type="url"
                value={formData.website || ''}
                onChange={(e) => handleInputChange('website', e.target.value)}
                placeholder="Enter website URL"
                className={!formData.website ? 'placeholder:text-gray-300' : ''}
              />
              {!formData.website && (
                <p className="text-xs text-gray-400 italic">e.g., https://example.com</p>
              )}
            </div>
          </div>

          {/* Parent Organization - conditional rendering based on type */}
          {formData.org_type_code && formData.org_type_code !== 'HQ' && (
            <div className="space-y-2">
              <Label htmlFor="parent_org_id">
                {getParentFieldLabel(formData.org_type_code as OrgType)}
                {isParentRequired(formData.org_type_code as OrgType) && ' *'}
              </Label>
              
              {/* Help text showing hierarchy rules */}
              <Alert className="mb-2">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  {getParentHelpText(formData.org_type_code as OrgType)}
                </AlertDescription>
              </Alert>

              <Select
                value={formData.parent_org_id || 'none'}
                onValueChange={(value) => handleInputChange('parent_org_id', value === 'none' ? null : value)}
              >
                <SelectTrigger>
                  <SelectValue 
                    placeholder={
                      isParentRequired(formData.org_type_code as OrgType)
                        ? "Select parent organization"
                        : "Select parent organization (optional)"
                    } 
                  />
                </SelectTrigger>
                <SelectContent>
                  {!isParentRequired(formData.org_type_code as OrgType) && (
                    <SelectItem value="none">No parent organization</SelectItem>
                  )}
                  {filteredParentOrgs
                    .filter(org => org.id !== organization?.id) // Exclude self
                    .map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.org_name} ({org.org_code})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              value={formData.address || ''}
              onChange={(e) => handleInputChange('address', e.target.value)}
              placeholder="Enter street address"
              rows={2}
              className={!formData.address ? 'placeholder:text-gray-300' : ''}
            />
            {!formData.address && (
              <p className="text-xs text-gray-400 italic">Please enter the street address</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="address_line2">Address Line 2</Label>
            <Textarea
              id="address_line2"
              value={formData.address_line2 || ''}
              onChange={(e) => handleInputChange('address_line2', e.target.value)}
              placeholder="Apartment, suite, building (optional)"
              rows={2}
              className={!formData.address_line2 ? 'placeholder:text-gray-300' : ''}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city || ''}
                onChange={(e) => handleInputChange('city', e.target.value)}
                placeholder="Enter city"
                className={!formData.city ? 'placeholder:text-gray-300' : ''}
              />
              {!formData.city && (
                <p className="text-xs text-gray-400 italic">Enter city name</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="postal_code">Postal Code</Label>
              <Input
                id="postal_code"
                value={formData.postal_code || ''}
                onChange={(e) => handleInputChange('postal_code', e.target.value)}
                placeholder="Enter postal code"
                className={!formData.postal_code ? 'placeholder:text-gray-300' : ''}
              />
              {!formData.postal_code && (
                <p className="text-xs text-gray-400 italic">Enter postal code</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="state_id">State</Label>
              <Select
                value={formData.state_id || 'none'}
                onValueChange={(value) => {
                  if (value === 'none') {
                    handleInputChange('state_id', '')
                    handleInputChange('district_id', '')
                  } else {
                    handleInputChange('state_id', value)
                    handleInputChange('district_id', null)
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Not defined)</SelectItem>
                  {states.map((state) => (
                    <SelectItem key={state.id} value={state.id}>
                      {state.state_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="district_id">District</Label>
              <Select
                value={formData.district_id || 'none'}
                onValueChange={(value) => handleInputChange('district_id', value === 'none' ? '' : value)}
                disabled={!formData.state_id}
              >
                <SelectTrigger>
                  <SelectValue placeholder={formData.state_id ? 'Select district' : 'None (Not defined)'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Not defined)</SelectItem>
                  {districts.map((district) => (
                    <SelectItem key={district.id} value={district.id}>
                      {district.district_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!formData.state_id && (
                <p className="text-xs text-gray-400 italic">Select a state to view districts</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="country_code">Country</Label>
            <Input
              id="country_code"
              value={formData.country_code || ''}
              onChange={(e) => handleInputChange('country_code', e.target.value)}
              placeholder="Enter country code"
              className={!formData.country_code ? 'placeholder:text-gray-300' : ''}
            />
            {!formData.country_code && (
              <p className="text-xs text-gray-400 italic">e.g., MY, US, UK</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Linked Distributors Section (for SHOP organizations) */}
      {organization.org_type_code === 'SHOP' && shopDistributors.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <LinkIcon className="w-5 h-5 text-blue-600" />
                  Linked Distributors
                </CardTitle>
                <CardDescription>
                  Distributor relationships for this shop
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {shopDistributors.map((sd) => (
              <div
                key={sd.id}
                className={`flex justify-between items-center p-4 border rounded-lg ${
                  sd.is_preferred ? 'border-amber-300 bg-amber-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                    <LinkIcon className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{sd.distributor?.org_name}</p>
                    <p className="text-sm text-gray-500">{sd.distributor?.org_code}</p>
                    <div className="flex gap-2 mt-1">
                      {sd.payment_terms && (
                        <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                          {sd.payment_terms}
                        </span>
                      )}
                      {sd.account_number && (
                        <span className="text-xs text-gray-600">
                          Account: {sd.account_number}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {sd.is_preferred && (
                  <div className="flex items-center gap-2 text-amber-700">
                    <Star className="w-4 h-4 fill-current" />
                    <span className="text-sm font-medium">Default</span>
                  </div>
                )}
              </div>
            ))}
            <div className="pt-2">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  To manage distributor relationships, close this page and click the &quot;Distributors&quot; button on the organization card.
                </AlertDescription>
              </Alert>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment Terms & Warranty Bonus - Only show for manufacturers, distributors, and shops */}
      {(formData.org_type_code === 'MFG' || formData.org_type_code === 'DIST' || formData.org_type_code === 'SHOP') && (
        <Card>
          <CardHeader>
            <CardTitle>Payment Terms & Warranty Bonus</CardTitle>
            <CardDescription>Configure financial terms for orders</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="payment_term_id">Payment Terms</Label>
                <Select
                  value={formData.payment_term_id || undefined}
                  onValueChange={(value) => handleInputChange('payment_term_id', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select payment terms" />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentTerms.map((term) => (
                      <SelectItem key={term.id} value={term.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{term.term_name}</span>
                          {term.is_default && (
                            <span className="text-xs text-blue-600">(Default)</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formData.payment_term_id && (
                  <p className="text-sm text-gray-600 mt-2">
                    {paymentTerms.find(t => t.id === formData.payment_term_id)?.description}
                  </p>
                )}
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-800">
                    <strong>Note:</strong> This payment term will be automatically applied when creating orders with this organization as the seller.
                    It determines the deposit and balance payment split in the document workflow.
                  </p>
                </div>
              </div>

              <div>
                <Label htmlFor="warranty_bonus">Warranty Bonus</Label>
                <div className="relative mt-1">
                  <Input
                    id="warranty_bonus"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={formData.warranty_bonus || ''}
                    onChange={(e) => handleInputChange('warranty_bonus', e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="0"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                </div>
                <p className="text-sm text-gray-500 mt-2">
                  Set the warranty bonus percentage for this organization. This will be used for future calculations.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Contact Information */}
      <Card>
        <CardHeader>
          <CardTitle>Contact Information</CardTitle>
          <CardDescription>Primary contact details for this organization</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contact_name">Contact Name</Label>
              <Input
                id="contact_name"
                value={formData.contact_name || ''}
                onChange={(e) => handleInputChange('contact_name', e.target.value)}
                placeholder="Enter contact person name"
                className={!formData.contact_name ? 'placeholder:text-gray-300' : ''}
              />
              {!formData.contact_name && (
                <p className="text-xs text-gray-400 italic">Please enter the contact person&apos;s name</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact_title">Contact Title</Label>
              <Input
                id="contact_title"
                value={formData.contact_title || ''}
                onChange={(e) => handleInputChange('contact_title', e.target.value)}
                placeholder="Enter job title (e.g., Manager, Director)"
                className={!formData.contact_title ? 'placeholder:text-gray-300' : ''}
              />
              {!formData.contact_title && (
                <p className="text-xs text-gray-400 italic">Enter the contact person&apos;s job title</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contact_email">Contact Email</Label>
              <Input
                id="contact_email"
                type="email"
                value={formData.contact_email || ''}
                onChange={(e) => handleInputChange('contact_email', e.target.value)}
                placeholder="Enter email (e.g., contact@example.com)"
                className={!formData.contact_email ? 'placeholder:text-gray-300' : ''}
              />
              {!formData.contact_email && (
                <p className="text-xs text-gray-400 italic">Please enter the contact email address</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact_phone">Contact Phone</Label>
              <Input
                id="contact_phone"
                value={formData.contact_phone || ''}
                onChange={(e) => handleInputChange('contact_phone', e.target.value)}
                placeholder="Enter phone (e.g., +60123456789)"
                className={!formData.contact_phone ? 'placeholder:text-gray-300' : ''}
              />
              {!formData.contact_phone && (
                <p className="text-xs text-gray-400 italic">Please enter the contact phone number</p>
              )}
            </div>
          </div>

          {/* Organization Users List - Show when there are 2 or more users */}
          {orgUsers.length >= 2 && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-gray-900">
                  Organization Users ({orgUsers.length})
                </h4>
                <p className="text-xs text-gray-500 mt-1">
                  All active users belonging to this organization
                </p>
              </div>
              
              <div className="space-y-3">
                {orgUsers.map((user: any) => (
                  <div 
                    key={user.id} 
                    className="flex items-start gap-4 p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-medium text-sm">
                        {user.full_name ? user.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) : 'U'}
                      </div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {user.full_name || 'No Name'}
                        </p>
                        {user.roles && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            {Array.isArray(user.roles) ? user.roles[0]?.role_name : user.roles?.role_name}
                          </span>
                        )}
                      </div>
                      
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 text-xs text-gray-600">
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          <span className="truncate">{user.email}</span>
                        </div>
                        
                        {user.phone && (
                          <div className="flex items-center gap-2 text-xs text-gray-600">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            <span>{user.phone}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Button - Bottom */}
      <div className="flex gap-4">
        <Button
          variant="outline"
          onClick={() => onViewChange?.('organizations')}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-blue-600 hover:bg-blue-700"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
