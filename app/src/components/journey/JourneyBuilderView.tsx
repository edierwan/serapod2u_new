'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Plus, 
  Edit, 
  Copy, 
  Trash2,
  BookOpen,
  Info,
  Eye,
  Smartphone,
  Settings as SettingsIcon
} from 'lucide-react'
import JourneyConfigCard from './JourneyConfigCard'
import JourneyPagesPanel from './JourneyPagesPanel'
import JourneyPageEditor from './JourneyPageEditor'
import JourneyThemeEditor from './JourneyThemeEditor'
import MobilePreview from './MobilePreview'
import JourneyFormModal from './JourneyFormModal'

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string
  organizations: {
    id: string
    org_name: string
    org_type_code: string
  }
  roles: {
    role_name: string
    role_level: number
  }
}

interface JourneyConfig {
  id: string
  org_id: string
  name: string
  is_active: boolean
  is_default: boolean
  points_enabled: boolean
  lucky_draw_enabled: boolean
  redemption_enabled: boolean
  require_staff_otp_for_points: boolean
  require_customer_otp_for_lucky_draw: boolean
  require_customer_otp_for_redemption: boolean
  start_at: string | null
  end_at: string | null
  created_at: string
}

interface JourneyBuilderViewProps {
  userProfile: UserProfile
}

export default function JourneyBuilderView({ userProfile }: JourneyBuilderViewProps) {
  const [activeTab, setActiveTab] = useState<'configs' | 'pages' | 'editor' | 'theme'>('configs')
  const [journeys, setJourneys] = useState<JourneyConfig[]>([])
  const [selectedJourney, setSelectedJourney] = useState<JourneyConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingJourney, setEditingJourney] = useState<JourneyConfig | null>(null)
  
  const { isReady, supabase } = useSupabaseAuth()

  useEffect(() => {
    if (isReady) {
      fetchJourneys()
    }
  }, [isReady])

  const fetchJourneys = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/journey/list')
      const data = await response.json()
      
      if (data.success) {
        setJourneys(data.journeys || [])
      } else {
        console.error('Error fetching journeys:', data.error)
      }
    } catch (error) {
      console.error('Error fetching journeys:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleNewJourney = () => {
    setEditingJourney(null)
    setShowModal(true)
  }

  const handleEditJourney = (journey: JourneyConfig) => {
    setEditingJourney(journey)
    setShowModal(true)
  }

  const handleSelectJourney = (journey: JourneyConfig) => {
    setSelectedJourney(journey)
    setActiveTab('pages')
  }

  const handleModalSave = async () => {
    await fetchJourneys()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <BookOpen className="w-8 h-8 text-blue-600" />
                Journey Builder
              </h1>
              <p className="text-gray-600 mt-1">
                Create and customize QR code claim journey experiences
              </p>
            </div>
            <Button onClick={handleNewJourney} className="gap-2">
              <Plus className="w-4 h-4" />
              New Journey
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel - Journey Configs */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Journey Configs</span>
                  <Badge variant="outline">
                    {journeys.filter(j => j.is_active).length} Active
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Select a journey from the left to edit its pages
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading ? (
                  <div className="text-center py-8 text-gray-500">Loading...</div>
                ) : journeys.length === 0 ? (
                  <div className="text-center py-8">
                    <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">No journeys yet</p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleNewJourney}
                      className="mt-3"
                    >
                      Create your first journey
                    </Button>
                  </div>
                ) : (
                  journeys.map((journey) => (
                    <JourneyConfigCard
                      key={journey.id}
                      journey={journey}
                      isSelected={selectedJourney?.id === journey.id}
                      onSelect={() => handleSelectJourney(journey)}
                      onEdit={() => handleEditJourney(journey)}
                      onDuplicate={async () => {
                        try {
                          const response = await fetch('/api/journey/duplicate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: journey.id })
                          })
                          const data = await response.json()
                          if (data.success) {
                            await fetchJourneys()
                          }
                        } catch (error) {
                          console.error('Error duplicating journey:', error)
                        }
                      }}
                      onDelete={async () => {
                        if (confirm(`Are you sure you want to delete "${journey.name}"?`)) {
                          try {
                            const response = await fetch(`/api/journey/delete?id=${journey.id}`, {
                              method: 'DELETE'
                            })
                            const data = await response.json()
                            if (data.success) {
                              if (selectedJourney?.id === journey.id) {
                                setSelectedJourney(null)
                              }
                              await fetchJourneys()
                            } else {
                              alert(data.error)
                            }
                          } catch (error) {
                            console.error('Error deleting journey:', error)
                          }
                        }
                      }}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            {/* Journey Builder Guide */}
            <Card className="mt-4 bg-blue-50 border-blue-200">
              <CardHeader>
                <CardTitle className="text-blue-900 flex items-center gap-2 text-base">
                  <Info className="w-4 h-4" />
                  Journey Builder Guide
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-2">Quick Start:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>Select a journey from the left to edit its pages</li>
                    <li>Use the Pages tab to manage page order and visibility</li>
                    <li>Edit individual pages in the Page Editor tab</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Middle Panel - Content Area */}
          <div className="lg:col-span-1">
            {selectedJourney ? (
              <>
                {/* Tabs */}
                <div className="bg-white rounded-lg shadow-sm border mb-4">
                  <div className="flex border-b">
                    <button
                      onClick={() => setActiveTab('pages')}
                      className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                        activeTab === 'pages'
                          ? 'border-b-2 border-blue-600 text-blue-600'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Pages
                    </button>
                    <button
                      onClick={() => setActiveTab('editor')}
                      className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                        activeTab === 'editor'
                          ? 'border-b-2 border-blue-600 text-blue-600'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Page Editor
                    </button>
                    <button
                      onClick={() => setActiveTab('theme')}
                      className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                        activeTab === 'theme'
                          ? 'border-b-2 border-blue-600 text-blue-600'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Theme
                    </button>
                  </div>
                </div>

                {/* Tab Content */}
                {activeTab === 'pages' && (
                  <JourneyPagesPanel journeyId={selectedJourney.id} />
                )}
                {activeTab === 'editor' && (
                  <JourneyPageEditor journeyId={selectedJourney.id} />
                )}
                {activeTab === 'theme' && (
                  <JourneyThemeEditor journeyId={selectedJourney.id} />
                )}
              </>
            ) : (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center">
                    <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      No Journey Selected
                    </h3>
                    <p className="text-gray-500 text-sm">
                      Select a journey from the left to manage its pages and content
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Panel - Mobile Preview */}
          <div className="lg:col-span-1">
            <div className="sticky top-24">
              <MobilePreview journeyId={selectedJourney?.id} />
            </div>
          </div>
        </div>
      </div>

      {/* Journey Form Modal */}
      {showModal && (
        <JourneyFormModal
          journey={editingJourney}
          onClose={() => setShowModal(false)}
          onSave={handleModalSave}
        />
      )}
    </div>
  )
}
