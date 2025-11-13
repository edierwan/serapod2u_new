'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, Building2, Save, AlertCircle, Info, MapPin, Loader2 } from 'lucide-react'
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

interface AddOrganizationViewProps {
  userProfile: any
  onViewChange: (view: string) => void
}

interface OrganizationType {
  id: string
  type_code: string
  type_name: string
  description: string
  hierarchy_level: number
  is_active: boolean
}

interface State {
  id: string
  state_code: string
  state_name: string
  is_active: boolean
}

interface District {
  id: string
  district_code: string
  district_name: string
  state_id: string
  is_active: boolean
}

interface Organization {
  id: string
  org_code: string
  org_name: string
  org_type_code: string
}

export default function AddOrganizationView({ userProfile, onViewChange }: AddOrganizationViewProps) {
  const [loading, setLoading] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  
  const [orgTypes, setOrgTypes] = useState<OrganizationType[]>([])
  const [states, setStates] = useState<State[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [parentOrgs, setParentOrgs] = useState<Organization[]>([])
  const [filteredParentOrgs, setFilteredParentOrgs] = useState<Organization[]>([])
  const [autoAssignedHQ, setAutoAssignedHQ] = useState<Organization | null>(null)

  const [formData, setFormData] = useState({
    org_type_code: '',
    parent_org_id: '',
    org_code: '',
    org_name: '',
    registration_no: '',
    tax_id: '',
    website: '',
    address: '',
    address_line2: '',
    city: '',
    state_id: '',
    district_id: '',
    postal_code: '',
    country_code: 'MY',
    latitude: '',
    longitude: '',
    contact_name: '',
    contact_title: '',
    contact_phone: '',
    contact_email: '',
    is_active: true
  })

  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoError, setLogoError] = useState('')
  const [gettingLocation, setGettingLocation] = useState(false)

  const { isReady, supabase } = useSupabaseAuth()

  useEffect(() => {
    if (isReady) {
      fetchFormData()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  useEffect(() => {
    if (formData.state_id) {
      fetchDistricts(formData.state_id)
    } else {
      setDistricts([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.state_id])

  // Auto-generate org code when type changes
  useEffect(() => {
    if (formData.org_type_code) {
      generateOrgCode(formData.org_type_code)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.org_type_code])

  // Filter parent organizations when org type changes
  useEffect(() => {
    if (formData.org_type_code) {
      const validParents = getValidParentOrgs(
        formData.org_type_code as OrgType,
        parentOrgs as any[]
      )
      setFilteredParentOrgs(validParents as Organization[])
      
      // Smart auto-assignment logic for DIST and MANU
      if ((formData.org_type_code === 'DIST' || formData.org_type_code === 'MANU') && validParents.length === 1) {
        // Only 1 HQ exists - auto-assign it
        const singleHQ = validParents[0]
        handleInputChange('parent_org_id', singleHQ.id)
        setAutoAssignedHQ(singleHQ)
        console.log('✅ Auto-assigned to single HQ:', singleHQ.org_name)
      } else if ((formData.org_type_code === 'DIST' || formData.org_type_code === 'MANU') && validParents.length > 1) {
        // Multiple HQs - user must choose
        setAutoAssignedHQ(null)
        // Don't clear selection if already valid
        if (formData.parent_org_id) {
          const isValid = validParents.some(p => p.id === formData.parent_org_id)
          if (!isValid) {
            handleInputChange('parent_org_id', '')
          }
        }
      } else {
        // Other org types or no HQ available
        setAutoAssignedHQ(null)
        // Clear parent_org_id if current selection is not valid
        if (formData.parent_org_id) {
          const isValid = validParents.some(p => p.id === formData.parent_org_id)
          if (!isValid) {
            handleInputChange('parent_org_id', '')
          }
        }
      }
      
      // For HQ, always clear parent
      if (formData.org_type_code === 'HQ') {
        handleInputChange('parent_org_id', '')
        setAutoAssignedHQ(null)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.org_type_code, parentOrgs])

  const fetchFormData = async () => {
    if (!isReady) return

    try {
      setDataLoading(true)

      // Fetch organization types
      const { data: types, error: typesError } = await supabase
        .from('organization_types')
        .select('*')
        .eq('is_active', true)
        .order('hierarchy_level', { ascending: true })

      if (typesError) throw typesError
      setOrgTypes((types || []).map(t => ({
        id: t.id,
        type_code: t.type_code,
        type_name: t.type_name,
        description: t.type_description || '',
        hierarchy_level: t.hierarchy_level,
        is_active: t.is_active ?? true
      })))

      // Fetch states
      const { data: statesData, error: statesError } = await supabase
        .from('states')
        .select('*')
        .eq('is_active', true)
        .order('state_name', { ascending: true })

      if (statesError) throw statesError
      setStates((statesData || []).map(s => ({
        id: s.id,
        state_code: s.state_code,
        state_name: s.state_name,
        is_active: s.is_active ?? true
      })))

      // Fetch parent organizations based on user role
      let parentQuery = supabase
        .from('organizations')
        .select('id, org_code, org_name, org_type_code')
        .eq('is_active', true)

      // Apply access control based on role level
      if (userProfile.roles.role_level > 50) {
        // Super Admin (1-50): Can see all organizations
        // Power users (50+): See their org hierarchy
      } else {
        // Regular users can only see their own org and direct parents/children
        parentQuery = parentQuery.or(`id.eq.${userProfile.organization_id},parent_org_id.eq.${userProfile.organization_id}`)
      }

      const { data: parents, error: parentsError } = await parentQuery.order('org_name', { ascending: true })

      if (parentsError) throw parentsError
      setParentOrgs(parents || [])

    } catch (error: any) {
      console.error('Error fetching form data:', error)
      setError('Failed to load form data: ' + error.message)
    } finally {
      setDataLoading(false)
    }
  }

  const fetchDistricts = async (stateId: string) => {
    try {
      const { data, error } = await supabase
        .from('districts')
        .select('*')
        .eq('state_id', stateId)
        .eq('is_active', true)
        .order('district_name', { ascending: true })

      if (error) throw error
      setDistricts((data || []).map(d => ({
        id: d.id,
        district_code: d.district_code,
        district_name: d.district_name,
        state_id: d.state_id,
        is_active: d.is_active ?? true
      })))
    } catch (error: any) {
      console.error('Error fetching districts:', error)
      setDistricts([])
    }
  }

  const generateOrgCode = async (typeCode: string) => {
    try {
      // Define prefix mapping for different org types
      const prefixMap: { [key: string]: string } = {
        'HQ': 'HQ',
        'MANU': 'MN',
        'DIST': 'DT',
        'WH': 'WH',
        'SHOP': 'SH'
      }

      const prefix = prefixMap[typeCode] || typeCode.substring(0, 2)

      // Get the highest number for this type
      const { data, error } = await (supabase as any)
        .from('organizations')
        .select('org_code')
        .eq('org_type_code', typeCode)
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) throw error

      let nextNumber = 1
      if (data && data.length > 0) {
        const lastCode = data[0].org_code
        const numberMatch = lastCode.match(/\d+$/)
        if (numberMatch) {
          nextNumber = parseInt(numberMatch[0]) + 1
        }
      }

      const newCode = `${prefix}${String(nextNumber).padStart(3, '0')}`
      handleInputChange('org_code', newCode)
    } catch (error: any) {
      console.error('Error generating org code:', error)
    }
  }

  const checkDuplicateOrgName = async (orgName: string, orgType: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id')
        .eq('org_name', orgName.trim())
        .eq('org_type_code', orgType)
        .eq('is_active', true)

      if (error) throw error
      return data && data.length > 0
    } catch (error: any) {
      console.error('Error checking duplicate name:', error)
      return false
    }
  }

  const validateForm = (): string | null => {
    if (!formData.org_type_code.trim()) {
      return 'Organization type is required'
    }
    if (!formData.org_name.trim()) {
      return 'Organization name is required'
    }

    // Validate email if provided
    if (formData.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contact_email)) {
      return 'Invalid email format'
    }

    // Validate postal code if provided
    if (formData.postal_code && !/^\d{5}$/.test(formData.postal_code)) {
      return 'Postal code must be exactly 5 digits'
    }

    // Validate latitude if provided
    if (formData.latitude) {
      const lat = parseFloat(formData.latitude)
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return 'Latitude must be between -90 and 90'
      }
    }

    // Validate longitude if provided
    if (formData.longitude) {
      const lon = parseFloat(formData.longitude)
      if (isNaN(lon) || lon < -180 || lon > 180) {
        return 'Longitude must be between -180 and 180'
      }
    }

    return null
  }

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setError('')
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

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser')
      return
    }

    setGettingLocation(true)
    setError('')

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        handleInputChange('latitude', latitude.toFixed(6))
        handleInputChange('longitude', longitude.toFixed(6))
        setGettingLocation(false)
      },
      (error) => {
        setGettingLocation(false)
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setError('Location permission denied. Please enable location access in your browser settings.')
            break
          case error.POSITION_UNAVAILABLE:
            setError('Location information is unavailable.')
            break
          case error.TIMEOUT:
            setError('Location request timed out.')
            break
          default:
            setError('An error occurred while getting your location.')
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    // Validate organization hierarchy constraints
    const parentOrg = formData.parent_org_id 
      ? parentOrgs.find(p => p.id === formData.parent_org_id)
      : undefined
    
    const hierarchyError = validateOrgHierarchy(
      formData.org_type_code as OrgType,
      formData.parent_org_id || null,
      parentOrg?.org_type_code as OrgType | undefined
    )
    
    if (hierarchyError) {
      setError(hierarchyError)
      return
    }

    // Check for duplicate organization name within the same type
    const isDuplicate = await checkDuplicateOrgName(formData.org_name, formData.org_type_code)
    if (isDuplicate) {
      setError(`An organization with the name "${formData.org_name}" already exists for this type. Please choose a different name.`)
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const insertData: any = {
        org_type_code: formData.org_type_code,
        org_code: formData.org_code,
        org_name: formData.org_name,
        registration_no: formData.registration_no || null,
        tax_id: formData.tax_id || null,
        website: formData.website || null,
        address: formData.address || null,
        address_line2: formData.address_line2 || null,
        city: formData.city || null,
        state_id: formData.state_id || null,
        district_id: formData.district_id || null,
        postal_code: formData.postal_code || null,
        country_code: formData.country_code,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null,
        contact_name: formData.contact_name || null,
        contact_title: formData.contact_title || null,
        contact_phone: formData.contact_phone || null,
        contact_email: formData.contact_email || null,
        is_active: formData.is_active,
        logo_url: null, // Will be updated after upload
        created_by: userProfile.id,
        // Always include parent_org_id (required for SHOP and DIST, optional for others)
        parent_org_id: formData.parent_org_id || null
      }

      const { data, error: insertError } = await (supabase as any)
        .from('organizations')
        .insert([insertData])
        .select()

      if (insertError) throw insertError

      const newOrgId = data[0].id

      // Upload logo if provided (using same pattern as user avatars)
      if (logoFile && newOrgId) {
        try {
          const fileExt = logoFile.name.split('.').pop()
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
          const filePath = `${newOrgId}/${fileName}` // Nested folder: org_id/filename

          const { error: uploadError } = await supabase.storage
            .from('avatars') // Use same bucket as user avatars
            .upload(filePath, logoFile, {
              cacheControl: '3600',
              upsert: true // Allow overwrite
            })

          if (uploadError) {
            console.error('Logo upload error:', uploadError)
            // Continue without logo if upload fails
          } else {
            const { data: { publicUrl } } = supabase.storage
              .from('avatars')
              .getPublicUrl(filePath)
            
            const logo_url = `${publicUrl}?v=${Date.now()}` // Add cache-busting
            
            // Update organization with logo URL
            await (supabase as any)
              .from('organizations')
              .update({ logo_url })
              .eq('id', newOrgId)
          }
        } catch (logoUploadError) {
          console.error('Error uploading logo:', logoUploadError)
          // Continue without logo if upload fails
        }
      }

      // If creating a SHOP with a DIST parent, automatically create shop_distributors relationship
      if (data && data.length > 0 && formData.org_type_code === 'SHOP' && formData.parent_org_id) {
        const parentOrg = parentOrgs.find(p => p.id === formData.parent_org_id)
        console.log('🔍 Auto-link check:', {
          shopId: data[0].id,
          parentOrgId: formData.parent_org_id,
          parentOrgCode: parentOrg?.org_type_code,
          parentOrgName: parentOrg?.org_name
        })
        
        if (parentOrg && parentOrg.org_type_code === 'DIST') {
          try {
            console.log('✅ Creating shop_distributors link...', {
              shop_id: data[0].id,
              distributor_id: formData.parent_org_id
            })
            
            // First check if link already exists (to prevent duplicates)
            const { data: existingLink, error: checkError } = await (supabase as any)
              .from('shop_distributors')
              .select('id')
              .eq('shop_id', data[0].id)
              .eq('distributor_id', formData.parent_org_id)
              .maybeSingle()
            
            if (checkError) {
              console.error('⚠️ Error checking existing link:', checkError.message)
            }
            
            if (existingLink) {
              console.log('ℹ️ Shop-distributor link already exists, skipping creation')
            } else {
              // Create the link
              const { data: linkData, error: linkError } = await (supabase as any)
                .from('shop_distributors')
                .insert([{
                  shop_id: data[0].id,
                  distributor_id: formData.parent_org_id,
                  payment_terms: 'NET_30',
                  is_active: true,
                  is_preferred: true, // First distributor is always default
                  approved_by: userProfile.id,
                  approved_at: new Date().toISOString(),
                  created_by: userProfile.id // Track who created this relationship
                }])
                .select()
              
              if (linkError) {
                console.error('❌ Failed to create shop-distributor link:', {
                  errorString: String(linkError),
                  message: linkError.message || 'No message',
                  details: linkError.details || 'No details',
                  hint: linkError.hint || 'No hint',
                  code: linkError.code || 'No code',
                  fullError: JSON.stringify(linkError, Object.getOwnPropertyNames(linkError))
                })
                
                // Check if it's a duplicate key error (code 23505)
                if (linkError.code === '23505') {
                  console.log('ℹ️ Link already exists (duplicate key), continuing...')
                } else {
                  // Log but don't fail the whole operation
                  console.warn('⚠️ Shop-distributor link creation failed but shop was created successfully')
                }
              } else {
                console.log('✅ Shop-distributor link created successfully:', linkData)
                // Longer delay to ensure database transaction is committed and indexed
                await new Promise(resolve => setTimeout(resolve, 800))
                // Signal parent to refresh link status
                sessionStorage.setItem('needsLinkRefresh', 'true')
              }
            }
          } catch (linkErr: any) {
            console.error('❌ Exception creating shop-distributor link:', {
              errorString: String(linkErr),
              message: linkErr?.message || 'No message',
              stack: linkErr?.stack || 'No stack',
              fullError: JSON.stringify(linkErr, Object.getOwnPropertyNames(linkErr))
            })
          }
        } else {
          console.log('ℹ️ Parent is not a distributor, skipping shop_distributors link')
        }
      }

      setSuccess('Organization created successfully!')
      
      // Redirect after 1 second (reduced since we already waited 800ms above)
      setTimeout(() => {
        onViewChange('organizations')
      }, 1000)

    } catch (error: any) {
      console.error('Error creating organization:', error)
      const friendlyError = parseHierarchyError(error)
      setError(friendlyError)
    } finally {
      setLoading(false)
    }
  }

  if (dataLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading form...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onViewChange('organizations')}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Add New Organization</h2>
          <p className="text-gray-600 text-sm">Create a new organization in your supply chain network</p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800 ml-2">{error}</AlertDescription>
        </Alert>
      )}

      {/* Success Alert */}
      {success && (
        <Alert className="border-green-200 bg-green-50">
          <AlertDescription className="text-green-800">{success}</AlertDescription>
        </Alert>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  Basic Information
                </CardTitle>
                <CardDescription>Core organization details</CardDescription>
              </div>
              
              {/* Auto-assigned HQ Badge */}
              {autoAssignedHQ && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm">
                  <div className="flex items-center gap-2 text-blue-700 font-medium mb-1">
                    <Info className="w-4 h-4" />
                    Headquarters Active
                  </div>
                  <div className="text-blue-600 font-semibold">
                    {autoAssignedHQ.org_name}
                  </div>
                  <div className="text-blue-500 text-xs mt-0.5">
                    ({autoAssignedHQ.org_code})
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Logo Upload */}
            <OrgLogoUpload
              orgName={formData.org_name || 'New Organization'}
              onLogoChange={handleLogoChange}
              error={logoError}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="org_type_code">Organization Type *</Label>
                <Select
                  value={formData.org_type_code}
                  onValueChange={(value) => handleInputChange('org_type_code', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select organization type" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgTypes.map((type) => (
                      <SelectItem key={type.id} value={type.type_code}>
                        {type.type_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Parent Organization - conditional rendering based on type */}
              {formData.org_type_code && formData.org_type_code !== 'HQ' && (
                <div className="space-y-2">
                  <Label htmlFor="parent_org_id">
                    {getParentFieldLabel(formData.org_type_code as OrgType)}
                    {isParentRequired(formData.org_type_code as OrgType) && ' *'}
                  </Label>
                  
                  {/* Smart rendering: Show dropdown only if multiple HQs or not auto-assigned */}
                  {autoAssignedHQ ? (
                    // Single HQ - show read-only info (no dropdown needed)
                    <div className="relative">
                      <Input
                        value={`${autoAssignedHQ.org_name} (${autoAssignedHQ.org_code})`}
                        disabled
                        className="bg-blue-50 border-blue-200 text-blue-900 font-medium cursor-not-allowed"
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-blue-600 text-white text-xs px-2 py-1 rounded-full font-semibold">
                        Auto-assigned
                      </div>
                      <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        Only one headquarters available - automatically assigned
                      </p>
                    </div>
                  ) : (
                    // Multiple HQs or other scenarios - show dropdown
                    <>
                      {/* Help text showing hierarchy rules */}
                      <Alert className="mb-2">
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                          {getParentHelpText(formData.org_type_code as OrgType)}
                        </AlertDescription>
                      </Alert>

                      <Select
                        value={formData.parent_org_id || 'none'}
                        onValueChange={(value) => handleInputChange('parent_org_id', value === 'none' ? '' : value)}
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
                          {filteredParentOrgs.map((org) => (
                            <SelectItem key={org.id} value={org.id}>
                              {org.org_name} ({org.org_code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      
                      {filteredParentOrgs.length > 1 && (formData.org_type_code === 'DIST' || formData.org_type_code === 'MANU') && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Multiple headquarters detected - please select one
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <div>
                <Label htmlFor="org_code">Organization Code</Label>
                <Input
                  id="org_code"
                  value={formData.org_code}
                  disabled
                  placeholder="Auto-generated by system"
                  className="bg-gray-100 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Auto-generated based on organization type
                </p>
              </div>

              <div>
                <Label htmlFor="org_name">Organization Name *</Label>
                <Input
                  id="org_name"
                  value={formData.org_name}
                  onChange={(e) => handleInputChange('org_name', e.target.value)}
                  placeholder="Enter full organization name"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="registration_no">Registration Number</Label>
                <Input
                  id="registration_no"
                  value={formData.registration_no}
                  onChange={(e) => handleInputChange('registration_no', e.target.value)}
                  placeholder="Enter business registration number"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>

              <div>
                <Label htmlFor="tax_id">Tax ID</Label>
                <Input
                  id="tax_id"
                  value={formData.tax_id}
                  onChange={(e) => handleInputChange('tax_id', e.target.value)}
                  placeholder="Enter tax identification number"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>

              <div>
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={formData.website}
                  onChange={(e) => handleInputChange('website', e.target.value)}
                  placeholder="Enter website URL (e.g., https://example.com)"
                  type="url"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Address Information */}
        <Card>
          <CardHeader>
            <CardTitle>Address Information</CardTitle>
            <CardDescription>Physical location details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="address">Address Line 1</Label>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                placeholder="Enter street address (e.g., 123 Main Street)"
                rows={2}
                className="placeholder:text-gray-400 placeholder:italic"
              />
            </div>

            <div>
              <Label htmlFor="address_line2">Address Line 2</Label>
              <Textarea
                id="address_line2"
                value={formData.address_line2}
                onChange={(e) => handleInputChange('address_line2', e.target.value)}
                placeholder="Enter additional address information (e.g., Suite 100, Building B)"
                rows={2}
                className="placeholder:text-gray-400 placeholder:italic"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => handleInputChange('city', e.target.value)}
                  placeholder="Enter city name (e.g., Kuala Lumpur)"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>

              <div>
                <Label htmlFor="postal_code">Postal Code</Label>
                <Input
                  id="postal_code"
                  value={formData.postal_code}
                  onChange={(e) => handleInputChange('postal_code', e.target.value)}
                  placeholder="Enter 5-digit postal code (e.g., 50450)"
                  maxLength={5}
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="state_id">State</Label>
                <Select
                  value={formData.state_id || undefined}
                  onValueChange={(value) => handleInputChange('state_id', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {states.map((state) => (
                      <SelectItem key={state.id} value={state.id}>
                        {state.state_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="district_id">District</Label>
                <Select
                  value={formData.district_id || undefined}
                  onValueChange={(value) => handleInputChange('district_id', value)}
                  disabled={!formData.state_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={formData.state_id ? "Select district" : "Select state first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {districts.map((district) => (
                      <SelectItem key={district.id} value={district.id}>
                        {district.district_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="country_code">Country Code</Label>
                <Input
                  id="country_code"
                  value={formData.country_code}
                  onChange={(e) => handleInputChange('country_code', e.target.value)}
                  maxLength={2}
                  placeholder="Enter 2-letter country code (e.g., MY)"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>

              <div>
                <Label htmlFor="latitude">Latitude</Label>
                <Input
                  id="latitude"
                  value={formData.latitude}
                  onChange={(e) => handleInputChange('latitude', e.target.value)}
                  placeholder="Enter latitude (-90 to 90, e.g., 3.139003)"
                  type="number"
                  step="0.000001"
                  min="-90"
                  max="90"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>

              <div>
                <Label htmlFor="longitude">Longitude</Label>
                <Input
                  id="longitude"
                  value={formData.longitude}
                  onChange={(e) => handleInputChange('longitude', e.target.value)}
                  placeholder="Enter longitude (-180 to 180, e.g., 101.686855)"
                  type="number"
                  step="0.000001"
                  min="-180"
                  max="180"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>
            </div>

            {/* GPS Auto-fill Button */}
            <div className="flex items-center gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGetLocation}
                disabled={gettingLocation}
                className="text-blue-600 hover:text-blue-700"
              >
                {gettingLocation ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Getting location...
                  </>
                ) : (
                  <>
                    <MapPin className="w-4 h-4 mr-2" />
                    Auto-detect my location (GPS)
                  </>
                )}
              </Button>
              {(formData.latitude && formData.longitude) && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  Coordinates set
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Contact Information */}
        <Card>
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
            <CardDescription>Primary contact details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="contact_name">Contact Name</Label>
                <Input
                  id="contact_name"
                  value={formData.contact_name}
                  onChange={(e) => handleInputChange('contact_name', e.target.value)}
                  placeholder="Enter contact person's full name (e.g., John Doe)"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>

              <div>
                <Label htmlFor="contact_title">Contact Title</Label>
                <Input
                  id="contact_title"
                  value={formData.contact_title}
                  onChange={(e) => handleInputChange('contact_title', e.target.value)}
                  placeholder="Enter job title (e.g., General Manager)"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>

              <div>
                <Label htmlFor="contact_phone">Contact Phone</Label>
                <Input
                  id="contact_phone"
                  value={formData.contact_phone}
                  onChange={(e) => handleInputChange('contact_phone', e.target.value)}
                  placeholder="Enter phone number (e.g., +60123456789)"
                  type="tel"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>

              <div>
                <Label htmlFor="contact_email">Contact Email</Label>
                <Input
                  id="contact_email"
                  value={formData.contact_email}
                  onChange={(e) => handleInputChange('contact_email', e.target.value)}
                  placeholder="Enter email address (e.g., contact@example.com)"
                  type="email"
                  className="placeholder:text-gray-400 placeholder:italic"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>Organization configuration</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => handleInputChange('is_active', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <Label htmlFor="is_active" className="mb-0">Organization is active</Label>
            </div>
          </CardContent>
        </Card>

        {/* Form Actions */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onViewChange('organizations')}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700">
            <Save className="w-4 h-4 mr-2" />
            {loading ? 'Creating...' : 'Create Organization'}
          </Button>
        </div>
      </form>
    </div>
  )
}
