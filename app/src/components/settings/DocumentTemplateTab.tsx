'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { 
  FileText,
  Save,
  Check,
  Loader2,
  FileCheck,
  Receipt,
  FileSpreadsheet,
  Upload,
  ImagePlus
} from 'lucide-react'

interface UserProfile {
  id: string
  email: string
  phone?: string | null
  role_code: string
  organization_id: string
  is_active: boolean
  organizations: {
    id: string
    org_name: string
    org_type_code: string
    org_code: string
  }
  roles: {
    role_name: string
    role_level: number
  }
}

interface DocumentTemplateTabProps {
  userProfile: UserProfile
}

// Template definitions
export type DocumentTemplateType = 'detailed' | 'classic'

interface TemplateInfo {
  id: DocumentTemplateType
  name: string
  description: string
  features: string[]
  icon: React.ReactNode
  previewDescription: string
  imageSrc: string
}

const TEMPLATES: TemplateInfo[] = [
  {
    id: 'detailed',
    name: 'Modern',
    description: 'Comprehensive document format with full party details and signatures',
    features: [
      'Company logo header',
      'Full buyer/seller/warehouse party info',
      'Complete order lines with product details',
      'Payment terms and summary section',
      'Digital signatures with verification'
    ],
    icon: <FileCheck className="w-6 h-6" />,
    previewDescription: 'Full-featured document format currently in use',
    imageSrc: '/images/templates/detailed-document.png'
  },
  {
    id: 'classic',
    name: 'Classic',
    description: 'Traditional Purchase Order layout with status indicator',
    features: [
      'Clean header with logo placeholder',
      'Status indicator box (Approved/Pending)',
      'Simplified item table',
      'Ledger and User details',
      'Compact layout'
    ],
    icon: <FileText className="w-6 h-6" />,
    previewDescription: 'Classic purchase order style with status visibility',
    imageSrc: '/images/templates/classic.png'
  }
]

// Sub-component to handle individual template card logic and image error state
const TemplateCard = ({ 
  template, 
  isSelected, 
  onSelect, 
  onUpload, 
  isUploading, 
  userRole,
  refreshKey 
}: {
  template: TemplateInfo
  isSelected: boolean
  onSelect: () => void
  onUpload: (e: React.ChangeEvent<HTMLInputElement>, id: string) => void
  isUploading: boolean
  userRole: number
  refreshKey: number
}) => {
  const [imgError, setImgError] = useState(false)

  // Reset error when refreshKey changes (e.g. after upload)
  useEffect(() => {
    setImgError(false)
  }, [refreshKey])

  return (
    <div 
      className="relative flex flex-col h-full"
      onClick={onSelect}
    >
      <div
        className={`flex flex-col h-full rounded-xl border-2 cursor-pointer transition-all duration-200 overflow-hidden ${
          isSelected
            ? 'border-indigo-500 bg-indigo-50/30 shadow-md ring-1 ring-indigo-500'
            : 'border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm'
        }`}
      >
        {/* Image Preview Area */}
        <div className="aspect-[1/1.414] w-full bg-gray-100 border-b border-gray-200 relative group overflow-hidden">
            {/* Placeholder or Image */}
            <div className="absolute inset-0 flex items-center justify-center text-gray-400 bg-gray-50">
              {!imgError ? (
                <img 
                  src={`${template.imageSrc}?v=${refreshKey}`}
                  alt={template.name}
                  className="w-full h-full object-contain p-2 transition-transform duration-300 group-hover:scale-105"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="text-center p-4 flex flex-col items-center">
                  <svg className="w-12 h-12 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  <span className="text-xs text-gray-500">Preview Image<br/>Not Available</span>
                </div>
              )}
            </div>
            
            {/* Selection Indicator Overlay */}
            {isSelected && (
              <div className="absolute top-3 right-3 bg-indigo-600 text-white p-1.5 rounded-full shadow-lg z-10">
                <Check className="w-4 h-4" />
              </div>
            )}

            {/* Admin Upload Overlay (Only for Role Level 1) */}
            {userRole === 1 && (
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-20">
                <label className="cursor-pointer">
                  <input 
                    type="file" 
                    className="hidden" 
                    accept="image/*"
                    onChange={(e) => onUpload(e, template.id)}
                    disabled={isUploading}
                  />
                  <div className="bg-white text-gray-900 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 hover:bg-gray-50 transition-colors">
                    {isUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ImagePlus className="w-4 h-4" />
                    )}
                    <span className="text-sm font-medium">
                      {isUploading ? 'Uploading...' : 'Upload Preview'}
                    </span>
                  </div>
                </label>
              </div>
            )}
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col flex-1">
          <div className="flex items-center gap-3 mb-3">
            <div className={`p-2 rounded-lg flex-shrink-0 ${
              isSelected 
                ? 'bg-indigo-100 text-indigo-600' 
                : 'bg-gray-100 text-gray-600'
            }`}>
              {template.icon}
            </div>
            <h3 className="font-bold text-gray-900">{template.name}</h3>
          </div>
          
          <p className="text-sm text-gray-600 mb-4 flex-1">{template.description}</p>
          
          {/* Features list - Compact */}
          <ul className="space-y-2 mb-4">
            {template.features.slice(0, 3).map((feature, index) => (
              <li key={index} className="flex items-start gap-2 text-xs text-gray-500">
                <span className={`w-1 h-1 rounded-full mt-1.5 flex-shrink-0 ${
                  isSelected ? 'bg-indigo-400' : 'bg-gray-400'
                }`} />
                {feature}
              </li>
            ))}
            {template.features.length > 3 && (
              <li className="text-xs text-indigo-600 pl-3 pt-1">
                + {template.features.length - 3} more features
              </li>
            )}
          </ul>

          {/* Radio Button Style Selection */}
          <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-center">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
              isSelected
                ? 'border-indigo-600'
                : 'border-gray-300'
            }`}>
              {isSelected && (
                <div className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
              )}
            </div>
            <span className={`ml-2 text-sm font-medium ${
              isSelected ? 'text-indigo-700' : 'text-gray-600'
            }`}>
              {isSelected ? 'Selected' : 'Select'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DocumentTemplateTab({ userProfile }: DocumentTemplateTabProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplateType>('detailed')
  const [refreshKey, setRefreshKey] = useState(0) // To force image refresh
  const { isReady, supabase } = useSupabaseAuth()

  // Load current template setting
  useEffect(() => {
    if (isReady) {
      loadTemplateSetting()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  const loadTemplateSetting = async () => {
    if (!isReady) return

    try {
      setLoading(true)
      
      // Get organization settings
      const { data: orgData, error } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', userProfile.organizations.id)
        .single()

      if (error) {
        console.error('Error loading template settings:', error)
        return
      }

      let settings: Record<string, any> = {}
      if (orgData?.settings) {
        if (typeof orgData.settings === 'string') {
          try {
            settings = JSON.parse(orgData.settings)
          } catch (e) {
            settings = {}
          }
        } else if (typeof orgData.settings === 'object' && orgData.settings !== null) {
          settings = orgData.settings as Record<string, any>
        }
      }

      // Get document template from settings
      if (settings.document_template) {
        setSelectedTemplate(settings.document_template as DocumentTemplateType)
      }
    } catch (error) {
      console.error('Error loading template settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUploadPreview = async (e: React.ChangeEvent<HTMLInputElement>, templateId: string) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type (allow images)
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file (PNG, JPG)',
        variant: 'destructive'
      })
      return
    }

    try {
      setUploading(templateId)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('templateId', templateId)

      const response = await fetch('/api/admin/upload-template-preview', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Upload failed')
      }

      toast({
        title: '✅ Preview Uploaded',
        description: 'Template preview image has been updated',
      })

      // Force refresh images
      setRefreshKey(prev => prev + 1)

    } catch (error: any) {
      console.error('Upload error:', error)
      toast({
        title: '❌ Upload Failed',
        description: error.message || 'Failed to upload preview image',
        variant: 'destructive'
      })
    } finally {
      setUploading(null)
      // Reset input
      e.target.value = ''
    }
  }

  const handleSaveTemplate = async () => {
    try {
      setSaving(true)

      // Get current organization settings
      const { data: orgData, error: fetchError } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', userProfile.organizations.id)
        .single()

      if (fetchError) throw fetchError

      let settings: Record<string, any> = {}
      if (orgData?.settings) {
        if (typeof orgData.settings === 'string') {
          try {
            settings = JSON.parse(orgData.settings)
          } catch (e) {
            settings = {}
          }
        } else if (typeof orgData.settings === 'object' && orgData.settings !== null) {
          settings = orgData.settings as Record<string, any>
        }
      }

      // Update with new template
      const updatedSettings = {
        ...settings,
        document_template: selectedTemplate
      }

      // Save to database
      const { error: updateError } = await supabase
        .from('organizations')
        .update({ settings: updatedSettings })
        .eq('id', userProfile.organizations.id)

      if (updateError) throw updateError

      toast({
        title: '✅ Template Saved',
        description: `Document template set to "${TEMPLATES.find(t => t.id === selectedTemplate)?.name}"`,
      })
    } catch (error) {
      console.error('Error saving template:', error)
      toast({
        title: '❌ Error',
        description: 'Failed to save document template setting',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-600">Loading template settings...</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="p-3 bg-white rounded-lg shadow-sm">
              <FileText className="w-6 h-6 text-indigo-600" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-xl">Document Template</CardTitle>
              <CardDescription className="mt-2">
                Select the PDF template design for all generated documents (PO, Invoice, Receipt, Payment Advice, etc.).
                This setting applies to H2M, D2H, and S2D document flows.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Template Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-indigo-600" />
            Select Template Design
          </CardTitle>
          <CardDescription>
            Choose the document format that best suits your business needs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {TEMPLATES.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isSelected={selectedTemplate === template.id}
                onSelect={() => setSelectedTemplate(template.id)}
                onUpload={handleUploadPreview}
                isUploading={uploading === template.id}
                userRole={userProfile.roles.role_level}
                refreshKey={refreshKey}
              />
            ))}
          </div>

          {/* Save Button */}
          <div className="flex justify-end mt-6 pt-6 border-t">
            <Button 
              onClick={handleSaveTemplate} 
              disabled={saving}
              className="min-w-[140px]"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Template
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="py-4">
          <div className="flex gap-3">
            <FileText className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium mb-1">Template Application</p>
              <ul className="list-disc list-inside space-y-1 text-amber-700">
                <li>The selected template will be used for all new document generations</li>
                <li>Applies to: Purchase Orders, Invoices, Payment Advice, Receipts, and Balance Payment Requests</li>
                <li>Signature behavior depends on template and document type</li>
                <li>Changes take effect immediately for new documents</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
