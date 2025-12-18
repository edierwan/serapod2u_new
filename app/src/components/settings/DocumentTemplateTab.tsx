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
  FileSpreadsheet
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
export type DocumentTemplateType = 'minimal' | 'tax_invoice' | 'detailed'

interface TemplateInfo {
  id: DocumentTemplateType
  name: string
  description: string
  features: string[]
  icon: React.ReactNode
  previewDescription: string
}

const TEMPLATES: TemplateInfo[] = [
  {
    id: 'minimal',
    name: 'Simple Invoice',
    description: 'Clean, minimal design perfect for straightforward transactions',
    features: [
      'Simple header with company name',
      'Clean item table (Description, Unit Price, Qty, Total)',
      'Subtotal and Tax calculation',
      'Elegant signature at bottom',
      'No QR code'
    ],
    icon: <Receipt className="w-6 h-6" />,
    previewDescription: 'Minimalist invoice style with basic information and clean layout'
  },
  {
    id: 'tax_invoice',
    name: 'Tax Invoice',
    description: 'Professional tax invoice format with GST/Tax details',
    features: [
      'Company logo and details header',
      'Tax Invoice number and reference',
      'Detailed item table with tax breakdown',
      'GST Amount and Total Payable',
      'Terms and notes section',
      'No signature required'
    ],
    icon: <FileSpreadsheet className="w-6 h-6" />,
    previewDescription: 'Professional tax invoice with detailed tax breakdown'
  },
  {
    id: 'detailed',
    name: 'Detailed Document (Current)',
    description: 'Comprehensive document format with full party details and signatures',
    features: [
      'Company logo header',
      'Full buyer/seller/warehouse party info',
      'Complete order lines with product details',
      'Payment terms and summary section',
      'Digital signatures with verification',
      'Approval trail and timestamps'
    ],
    icon: <FileCheck className="w-6 h-6" />,
    previewDescription: 'Full-featured document format currently in use'
  }
]

export default function DocumentTemplateTab({ userProfile }: DocumentTemplateTabProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplateType>('detailed')
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
          <div className="grid gap-4">
            {TEMPLATES.map((template) => (
              <div 
                key={template.id} 
                className="relative"
                onClick={() => setSelectedTemplate(template.id)}
              >
                <div
                  className={`flex flex-col gap-4 p-6 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:border-indigo-300 hover:bg-indigo-50/50 ${
                    selectedTemplate === template.id
                      ? 'border-indigo-500 bg-indigo-50 shadow-md'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${
                        selectedTemplate === template.id 
                          ? 'bg-indigo-100 text-indigo-600' 
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {template.icon}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{template.name}</h3>
                        <p className="text-sm text-gray-600">{template.description}</p>
                      </div>
                    </div>
                    {selectedTemplate === template.id && (
                      <div className="flex-shrink-0 p-1 bg-indigo-600 rounded-full">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                  
                  {/* Features list */}
                  <div className="ml-12">
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {template.features.map((feature, index) => (
                        <li key={index} className="flex items-center gap-2 text-sm text-gray-600">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            selectedTemplate === template.id ? 'bg-indigo-400' : 'bg-gray-400'
                          }`} />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Preview description */}
                  <div className="ml-12 mt-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <p className="text-xs text-gray-500 italic">{template.previewDescription}</p>
                  </div>
                </div>
              </div>
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
