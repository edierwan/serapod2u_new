'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getStorageUrl } from '@/lib/utils'
import { 
  Trophy, 
  Plus, 
  Users, 
  Gift, 
  Sparkles,
  BarChart3,
  UserCheck,
  Award,
  Zap,
  Calendar,
  ArrowRight,
  Filter,
  Search,
  Info,
  Edit,
  Trash2,
  Save,
  X,
  Star,
  Target,
  CheckCircle2,
  AlertCircle,
  Upload,
  Image as ImageIcon
} from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'

interface UserProfile {
  id: string
  organization_id: string
  organizations: { id: string; org_name: string }
}

interface Order {
  id: string
  order_no: string
  order_type: string
  status: string
  has_lucky_draw: boolean
  buyer_org_name: string | null
  seller_org_name: string | null
  created_at: string
  items?: {
    quantity: number
    variant_name: string
    image_url: string
  }[]
}

interface Campaign {
  id: string
  company_id: string
  campaign_code: string
  campaign_name: string
  campaign_description: string
  status: 'draft' | 'active' | 'closed' | 'drawn' | 'completed'
  start_date: string
  end_date: string
  draw_date: string | null
  prizes_json: Prize[]
  entries_count?: number
  drawn_at: string | null
}

interface Entry {
  id: string
  consumer_phone: string
  consumer_name: string | null
  consumer_email: string | null
  entry_number: string
  entry_date: string
  is_winner: boolean
  prize_won: any
  prize_claimed: boolean
  qr_codes?: {
    product_variants?: {
      variant_name: string
      image_url: string
      products?: {
        product_name: string
      }
    }
  }
}

interface Prize {
  name: string
  description: string
  quantity: number
  image_url?: string
  file?: File
}

interface LuckyDrawViewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
  initialOrderId?: string
}

export default function LuckyDrawView({ userProfile, onViewChange, initialOrderId }: LuckyDrawViewProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'participants' | 'prizes' | 'draw'>('dashboard')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(initialOrderId || null)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Modal states
  const [showNewCampaignModal, setShowNewCampaignModal] = useState(false)
  const [showPrizeModal, setShowPrizeModal] = useState(false)
  const [showDrawConfirmModal, setShowDrawConfirmModal] = useState(false)
  const [editingPrizeIndex, setEditingPrizeIndex] = useState<number | null>(null)
  
  // Form states
  const [newCampaign, setNewCampaign] = useState({
    campaign_name: '',
    campaign_description: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    draw_date: ''
  })
  
  const [newPrize, setNewPrize] = useState({
    name: '',
    description: '',
    quantity: 1,
    image_url: ''
  })
  
  const [prizeImageFile, setPrizeImageFile] = useState<File | null>(null)
  const [prizeImagePreview, setPrizeImagePreview] = useState<string | null>(null)
  const [compressedSize, setCompressedSize] = useState<string | null>(null)
  
  const [prizes, setPrizes] = useState<Prize[]>([])
  const [drawResult, setDrawResult] = useState<any>(null)

  useEffect(() => {
    loadOrders()
  }, [])

  useEffect(() => {
    if (selectedOrderId) {
      loadCampaigns(selectedOrderId)
    }
  }, [selectedOrderId])

  useEffect(() => {
    if (selectedCampaignId) {
      loadEntries(selectedCampaignId)
      const campaign = campaigns.find(c => c.id === selectedCampaignId)
      if (campaign) {
        setPrizes(campaign.prizes_json || [])
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId])

  const loadOrders = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/lucky-draw/orders')
      const data = await response.json()
      
      if (data.success) {
        setOrders(data.orders || [])
        if (data.orders && data.orders.length > 0) {
          // Only set default if no order is currently selected (e.g. not passed via props)
          if (!selectedOrderId) {
            setSelectedOrderId(data.orders[0].id)
          }
        }
      }
    } catch (error) {
      console.error('Error loading orders:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadCampaigns = async (orderId: string) => {
    try {
      const response = await fetch(`/api/lucky-draw/campaigns?order_id=${orderId}`)
      const data = await response.json()
      
      if (data.success) {
        setCampaigns(data.campaigns || [])
        if (data.campaigns && data.campaigns.length > 0) {
          setSelectedCampaignId(data.campaigns[0].id)
        } else {
          setSelectedCampaignId(null)
          setEntries([])
        }
      }
    } catch (error) {
      console.error('Error loading campaigns:', error)
    }
  }

  const loadEntries = async (campaignId: string) => {
    try {
      const response = await fetch(`/api/lucky-draw/entries?campaign_id=${campaignId}`)
      const data = await response.json()
      
      if (data.success) {
        setEntries(data.entries || [])
      }
    } catch (error) {
      console.error('Error loading entries:', error)
    }
  }

  const handleCreateCampaign = async () => {
    if (!newCampaign.campaign_name || !selectedOrderId) {
      alert('Please fill in campaign name')
      return
    }

    try {
      // Prepare campaign data with proper null handling for optional fields
      const campaignData = {
        order_id: selectedOrderId,
        campaign_name: newCampaign.campaign_name,
        campaign_description: newCampaign.campaign_description || '',
        start_date: newCampaign.start_date || new Date().toISOString().split('T')[0],
        end_date: newCampaign.end_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        draw_date: newCampaign.draw_date && newCampaign.draw_date.trim() !== '' ? newCampaign.draw_date : null,
        prizes_json: prizes
      }

      let response;
      
      // If a campaign already exists for this order, update it instead of creating new
      if (campaigns.length > 0 && selectedCampaignId) {
        response = await fetch('/api/lucky-draw/campaigns', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...campaignData,
            campaign_id: selectedCampaignId
          })
        })
      } else {
        response = await fetch('/api/lucky-draw/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(campaignData)
        })
      }
      
      const data = await response.json()
      
      if (data.success) {
        setShowNewCampaignModal(false)
        // Don't clear form immediately if we might edit again, but for now it's fine as we reset on open
        setNewCampaign({
          campaign_name: '',
          campaign_description: '',
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          draw_date: ''
        })
        setPrizes([])
        if (selectedOrderId) {
          loadCampaigns(selectedOrderId)
        }
      } else {
        alert('Failed to save campaign: ' + data.error)
      }
    } catch (error) {
      console.error('Error saving campaign:', error)
      alert('Failed to save campaign')
    }
  }

  const handleToggleCampaignStatus = async (campaignId: string, newStatus: string) => {
    try {
      const response = await fetch('/api/lucky-draw/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, status: newStatus })
      })
      
      const data = await response.json()
      
      if (data.success) {
        if (selectedOrderId) {
          loadCampaigns(selectedOrderId)
        }
      } else {
        alert('Failed to update campaign status: ' + data.error)
      }
    } catch (error) {
      console.error('Error toggling campaign status:', error)
      alert('Failed to update campaign status')
    }
  }

  const handleAddPrize = async () => {
    if (!newPrize.name || newPrize.quantity < 1) {
      alert('Please fill in prize name and quantity')
      return
    }

    try {
      let imageUrl = newPrize.image_url
      let fileToUpload = prizeImageFile

      // Image is already compressed in onChange handler

      // Upload image if a new file is selected AND we have a campaign ID
      if (fileToUpload && selectedCampaign) {
        const { createClient } = await import('@/lib/supabase/client')
        const supabase = createClient()
        
        const fileExt = fileToUpload.name.split('.').pop()
        const fileName = `${selectedCampaign.id}-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
        const filePath = `lucky-draw-prizes/${selectedCampaign.id}/${fileName}`

        const { error: uploadError } = await supabase.storage
          .from('avatars') // Use same bucket as avatars
          .upload(filePath, fileToUpload, {
            cacheControl: '3600',
            upsert: true
          })

        if (uploadError) {
          console.error('Prize image upload error:', uploadError)
          alert('Failed to upload prize image')
          return
        }

        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath)
        
        imageUrl = `${publicUrl}?v=${Date.now()}`
        fileToUpload = null // Clear file since it's uploaded
      } else if (fileToUpload && !selectedCampaign) {
        // If no campaign yet (creating new), use preview URL temporarily and store file
        imageUrl = prizeImagePreview || ''
      }

      const prizeWithImage: Prize = { 
        ...newPrize, 
        image_url: imageUrl,
        file: fileToUpload || undefined
      }

      let updatedPrizes: Prize[]
      if (editingPrizeIndex !== null) {
        updatedPrizes = [...prizes]
        updatedPrizes[editingPrizeIndex] = prizeWithImage
        setEditingPrizeIndex(null)
      } else {
        updatedPrizes = [...prizes, prizeWithImage]
      }
      
      setPrizes(updatedPrizes)

      // Save to database immediately ONLY if we are editing an existing campaign
      if (selectedCampaign) {
        await handleSavePrizes(updatedPrizes)
      }

      setNewPrize({ name: '', description: '', quantity: 1, image_url: '' })
      setPrizeImageFile(null)
      setPrizeImagePreview(null)
      setCompressedSize(null)
      setShowPrizeModal(false)
    } catch (error) {
      console.error('Error adding prize:', error)
      alert('Failed to add prize')
    }
  }

  const handleEditPrize = (index: number) => {
    setEditingPrizeIndex(index)
    const prize = prizes[index]
    setNewPrize({ 
      name: prize.name, 
      description: prize.description, 
      quantity: prize.quantity,
      image_url: prize.image_url || ''
    })
    setPrizeImagePreview(prize.image_url || null)
    setCompressedSize(null)
    setShowPrizeModal(true)
  }

  const handleDeletePrize = async (index: number) => {
    if (!selectedCampaignId) return
    
    const updatedPrizes = prizes.filter((_, i) => i !== index)
    setPrizes(updatedPrizes)
    
    // Save to database immediately
    await handleSavePrizes(updatedPrizes)
  }

  const handleSavePrizes = async (prizesToSave: Prize[]) => {
    if (!selectedCampaignId) return

    try {
      const response = await fetch('/api/lucky-draw/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          campaign_id: selectedCampaignId, 
          prizes_json: prizesToSave 
        })
      })
      
      const data = await response.json()
      
      if (data.success) {
        // Reload campaigns to reflect the updated prizes
        if (selectedOrderId) {
          await loadCampaigns(selectedOrderId)
        }
      } else {
        alert('Failed to save prizes: ' + data.error)
      }
    } catch (error) {
      console.error('Error saving prizes:', error)
      alert('Failed to save prizes')
    }
  }

  const handlePerformDraw = async () => {
    if (!selectedCampaignId) return

    try {
      const response = await fetch('/api/lucky-draw/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: selectedCampaignId })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setDrawResult(data)
        setShowDrawConfirmModal(false)
        if (selectedOrderId) {
          loadCampaigns(selectedOrderId)
        }
        if (selectedCampaignId) {
          loadEntries(selectedCampaignId)
        }
        alert(`Successfully selected ${data.winners.length} winners!`)
      } else {
        alert('Failed to perform draw: ' + data.error)
      }
    } catch (error) {
      console.error('Error performing draw:', error)
      alert('Failed to perform draw')
    }
  }

  const selectedOrder = orders.find(o => o.id === selectedOrderId)
  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId)

  const filteredEntries = entries.filter(entry => 
    entry.consumer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.consumer_phone.includes(searchQuery) ||
    entry.entry_number.includes(searchQuery) ||
    entry.consumer_email?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const stats = {
    totalCampaigns: campaigns.length,
    activeCampaigns: campaigns.filter(c => c.status === 'active').length,
    totalParticipants: entries.length,
    totalWinners: entries.filter(e => e.is_winner).length,
    totalPrizes: selectedCampaign?.prizes_json?.reduce((sum, p) => sum + p.quantity, 0) || 0,
    claimedPrizes: entries.filter(e => e.is_winner && e.prize_claimed).length
  }

  // Compress image for mobile optimization (< 6KB)
  const compressImage = (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = (event) => {
        const img = new window.Image()
        img.src = event.target?.result as string
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('Failed to get canvas context'))
            return
          }

          // Target size: Small for mobile icons to ensure < 6KB
          // Start with 150px
          let width = img.width
          let height = img.height
          const MAX_DIMENSION = 150

          if (width > height) {
            if (width > MAX_DIMENSION) {
              height = Math.round((height * MAX_DIMENSION) / width)
              width = MAX_DIMENSION
            }
          } else {
            if (height > MAX_DIMENSION) {
              width = Math.round((width * MAX_DIMENSION) / height)
              height = MAX_DIMENSION
            }
          }

          canvas.width = width
          canvas.height = height

          // Draw image on canvas
          ctx.drawImage(img, 0, 0, width, height)

          // Recursive compression to ensure < 6KB
          const attemptCompression = (quality: number) => {
            canvas.toBlob(
              (blob) => {
                if (blob) {
                  // Check if under 6KB (6144 bytes)
                  if (blob.size < 6144 || quality <= 0.1) {
                    const compressedFile = new File([blob], file.name, {
                      type: 'image/jpeg',
                      lastModified: Date.now(),
                    })
                    resolve(compressedFile)
                  } else {
                    // Reduce quality and try again
                    attemptCompression(Math.max(0.1, quality - 0.1))
                  }
                } else {
                  reject(new Error('Failed to compress image'))
                }
              },
              'image/jpeg',
              quality
            )
          }

          attemptCompression(0.8)
        }
        img.onerror = () => reject(new Error('Failed to load image'))
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
    })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
      <div className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                <Trophy className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Lucky Draw Management</h1>
                <p className="text-gray-600 mt-1">Manage order-specific lucky draw campaigns</p>
              </div>
            </div>
            <Button 
              className="gap-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
              disabled={!selectedOrderId}
              onClick={() => {
                if (campaigns.length > 0 && selectedCampaign) {
                  // Edit mode
                  setNewCampaign({
                    campaign_name: selectedCampaign.campaign_name,
                    campaign_description: selectedCampaign.campaign_description,
                    start_date: selectedCampaign.start_date,
                    end_date: selectedCampaign.end_date,
                    draw_date: selectedCampaign.draw_date || ''
                  })
                  setPrizes(selectedCampaign.prizes_json || [])
                  setShowNewCampaignModal(true)
                } else {
                  // Create mode
                  setNewCampaign({
                    campaign_name: '',
                    campaign_description: '',
                    start_date: new Date().toISOString().split('T')[0],
                    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    draw_date: ''
                  })
                  setPrizes([])
                  setShowNewCampaignModal(true)
                }
              }}
            >
              {campaigns.length > 0 ? (
                <>
                  <Edit className="w-4 h-4" />
                  Edit Campaign
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  New Campaign
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Card className="mb-6 border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              Select Order
            </CardTitle>
            <CardDescription>
              Choose an order with lucky draw enabled to manage its campaigns
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-4">Loading orders...</div>
            ) : orders.length === 0 ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  No orders with lucky draw feature found.
                </AlertDescription>
              </Alert>
            ) : (
              <Select value={selectedOrderId || ''} onValueChange={setSelectedOrderId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an order..." />
                </SelectTrigger>
                <SelectContent>
                  {orders.map(order => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.order_no} - {order.buyer_org_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {selectedOrder && selectedOrder.items && selectedOrder.items.length > 0 && (
          <Card className="mb-6 border-2 bg-slate-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Gift className="w-5 h-5 text-purple-500" />
                Order Products
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                {selectedOrder.items.map((item, idx) => {
                  const parts = (item.variant_name || '').split('[')
                  const productName = parts[0]?.trim() || 'Unknown Product'
                  const variantName = parts[1]?.replace(']', '').trim()

                  return (
                    <div key={idx} className="flex items-start gap-3 bg-white p-2 rounded-lg border shadow-sm">
                      <div className="w-10 h-10 rounded-md overflow-hidden border bg-gray-100 flex-shrink-0 mt-0.5">
                        {item.image_url ? (
                          <Image
                            src={getStorageUrl(item.image_url) || item.image_url}
                            alt={item.variant_name || 'Product'}
                            width={40}
                            height={40}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <ImageIcon className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-medium text-xs leading-tight truncate" title={productName}>{productName}</h4>
                        {variantName && (
                          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate" title={variantName}>
                            [{variantName}]
                          </p>
                        )}
                        <Badge variant="secondary" className="mt-1.5 text-[10px] h-4 px-1.5 font-normal">
                          {item.quantity} unit{item.quantity !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {selectedOrderId && campaigns.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Select Campaign</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={selectedCampaignId || ''} onValueChange={setSelectedCampaignId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a campaign..." />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map(campaign => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.campaign_name} ({campaign.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

        {selectedOrderId && (
          <Card className="border-2">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
              <CardHeader className="border-b">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                  <TabsTrigger value="participants" disabled={!selectedCampaignId}>Participants</TabsTrigger>
                  <TabsTrigger value="prizes" disabled={!selectedCampaignId}>Prizes</TabsTrigger>
                  <TabsTrigger value="draw" disabled={!selectedCampaignId}>Draw</TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent className="pt-6">
                {/* DASHBOARD TAB */}
                <TabsContent value="dashboard">
                  <div className="space-y-4">
                    {campaigns.length === 0 ? (
                      <div className="text-center py-12">
                        <Trophy className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 mb-4">No campaigns yet</p>
                        <Button onClick={() => setShowNewCampaignModal(true)} className="bg-purple-500 hover:bg-purple-600">
                          <Plus className="w-4 h-4 mr-2" />
                          Create First Campaign
                        </Button>
                      </div>
                    ) : (
                      campaigns.map(campaign => (
                        <Card key={campaign.id} className="hover:shadow-md transition-shadow">
                          <CardContent className="p-6">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                  <h3 className="font-semibold text-lg">{campaign.campaign_name}</h3>
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      checked={campaign.status === 'active'}
                                      onCheckedChange={(checked) => handleToggleCampaignStatus(campaign.id, checked ? 'active' : 'closed')}
                                    />
                                    <span className={`text-sm font-medium ${campaign.status === 'active' ? 'text-green-600' : 'text-gray-500'}`}>
                                      {campaign.status === 'active' ? 'Active' : 'Inactive'}
                                    </span>
                                  </div>
                                </div>
                                <p className="text-sm text-gray-500 mb-3">{campaign.campaign_description}</p>
                                
                                {/* Prize Images Preview */}
                                {campaign.prizes_json && campaign.prizes_json.length > 0 && (
                                  <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
                                    {campaign.prizes_json.map((prize, idx) => (
                                      <div key={idx} className="relative group flex-shrink-0">
                                        <div className="w-12 h-12 rounded-lg border bg-white overflow-hidden">
                                          {prize.image_url ? (
                                            <Image
                                              src={getStorageUrl(prize.image_url) || prize.image_url}
                                              alt={prize.name}
                                              width={48}
                                              height={48}
                                              className="w-full h-full object-contain"
                                            />
                                          ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-300">
                                              <Gift className="w-6 h-6" />
                                            </div>
                                          )}
                                        </div>
                                        <div className="absolute -bottom-1 -right-1 bg-black text-white text-[10px] px-1 rounded-full">
                                          x{prize.quantity}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div className="flex items-center gap-4 text-xs text-gray-600">
                                  <div className="flex items-center gap-1">
                                    <Users className="w-4 h-4" />
                                    <span>{campaign.entries_count || 0} entries</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Gift className="w-4 h-4" />
                                    <span>{campaign.prizes_json?.reduce((sum, p) => sum + p.quantity, 0) || 0} prizes</span>
                                  </div>
                                  {campaign.drawn_at && (
                                    <div className="flex items-center gap-1">
                                      <Zap className="w-4 h-4" />
                                      <span>Drawn</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedCampaignId(campaign.id)
                                    setNewCampaign({
                                      campaign_name: campaign.campaign_name,
                                      campaign_description: campaign.campaign_description,
                                      start_date: campaign.start_date,
                                      end_date: campaign.end_date,
                                      draw_date: campaign.draw_date || ''
                                    })
                                    setPrizes(campaign.prizes_json || [])
                                    setShowNewCampaignModal(true)
                                  }}
                                >
                                  <Edit className="w-4 h-4 mr-1" />
                                  Edit
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </TabsContent>

                {/* PARTICIPANTS TAB */}
                <TabsContent value="participants">
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <Input 
                          placeholder="Search by name, phone, email, or entry number..." 
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <UserCheck className="w-4 h-4" />
                        <span>{stats.totalParticipants} participants</span>
                      </div>
                    </div>

                    {filteredEntries.length === 0 ? (
                      <div className="text-center py-12">
                        <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500">
                          {entries.length === 0 
                            ? 'No participants yet. Participants will appear when consumers enter via Journey Builder.' 
                            : 'No matching participants found'}
                        </p>
                      </div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 w-12">#</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Product</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Entry ID</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Name</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Phone</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Email</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Date</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {filteredEntries.map((entry, index) => {
                              const variant = entry.qr_codes?.product_variants
                              const productName = variant?.products?.product_name || 'Unknown Product'
                              const variantName = variant?.variant_name || ''
                              const imageUrl = variant?.image_url

                              return (
                                <tr key={entry.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-xs text-gray-500">{index + 1}</td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 rounded border bg-white overflow-hidden flex-shrink-0">
                                        {imageUrl ? (
                                          <Image 
                                            src={imageUrl} 
                                            alt={variantName} 
                                            width={32} 
                                            height={32} 
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400">
                                            <ImageIcon className="w-4 h-4" />
                                          </div>
                                        )}
                                      </div>
                                      <div className="min-w-0 max-w-[200px]">
                                        <div className="text-xs font-medium truncate" title={productName}>{productName}</div>
                                        {variantName && <div className="text-[10px] text-gray-500 truncate" title={variantName}>{variantName}</div>}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-xs font-mono">{entry.entry_number}</td>
                                  <td className="px-4 py-3 text-xs font-medium">{entry.consumer_name || 'Anonymous'}</td>
                                  <td className="px-4 py-3 text-xs">{entry.consumer_phone}</td>
                                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[150px] truncate" title={entry.consumer_email || ''}>{entry.consumer_email || '-'}</td>
                                  <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                                    {new Date(entry.entry_date).toLocaleDateString()}
                                  </td>
                                  <td className="px-4 py-3">
                                    {entry.prize_claimed ? (
                                      <Badge className="bg-green-500 text-[10px] px-1.5 h-5">
                                        <CheckCircle2 className="w-3 h-3 mr-1" />
                                        Claimed
                                      </Badge>
                                    ) : entry.is_winner ? (
                                      <Badge className="bg-yellow-500 text-[10px] px-1.5 h-5">
                                        <Trophy className="w-3 h-3 mr-1" />
                                        Winner
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-blue-500 text-white text-[10px] px-1.5 h-5">
                                        <CheckCircle2 className="w-3 h-3 mr-1" />
                                        Entered
                                      </Badge>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* PRIZES TAB */}
                <TabsContent value="prizes">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">Campaign Prizes</h3>
                        <p className="text-sm text-gray-600">Manage prizes for {selectedCampaign?.campaign_name}</p>
                      </div>
                      <Button onClick={() => {
                        setEditingPrizeIndex(null)
                        setNewPrize({ name: '', description: '', quantity: 1, image_url: '' })
                        setPrizeImageFile(null)
                        setPrizeImagePreview(null)
                        setCompressedSize(null)
                        setShowPrizeModal(true)
                      }}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Prize
                      </Button>
                    </div>

                    {selectedCampaign && selectedCampaign.prizes_json && selectedCampaign.prizes_json.length > 0 ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        {selectedCampaign.prizes_json.map((prize, index) => {
                          const winnersCount = entries.filter(e => 
                            e.is_winner && e.prize_won?.name === prize.name
                          ).length

                          return (
                            <Card key={index} className="hover:shadow-md transition-shadow">
                              <CardContent className="p-6">
                                <div className="flex gap-4">
                                  {prize.image_url && (
                                    <div className="flex-shrink-0 bg-white rounded-lg overflow-hidden border w-20 h-20">
                                      <Image
                                        src={getStorageUrl(prize.image_url) || prize.image_url}
                                        alt={prize.name}
                                        width={80}
                                        height={80}
                                        className="w-full h-full object-contain"
                                      />
                                    </div>
                                  )}
                                  <div className="flex-1">
                                    <div className="flex items-start justify-between mb-2">
                                      <div className="flex items-center gap-2">
                                        <Gift className="w-5 h-5 text-purple-500" />
                                        <h4 className="font-semibold">{prize.name}</h4>
                                      </div>
                                      <div className="flex gap-1">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => handleEditPrize(index)}
                                        >
                                          <Edit className="w-4 h-4" />
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => handleDeletePrize(index)}
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </Button>
                                      </div>
                                    </div>
                                    <p className="text-sm text-gray-600 mb-3">{prize.description}</p>
                                    <div className="flex items-center gap-4 text-xs">
                                      <div className="flex items-center gap-1 text-gray-600">
                                        <Target className="w-4 h-4" />
                                        <span>Quantity: {prize.quantity}</span>
                                      </div>
                                      {selectedCampaign.status === 'drawn' && (
                                        <div className="flex items-center gap-1 text-green-600">
                                          <Award className="w-4 h-4" />
                                          <span>Awarded: {winnersCount}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <Gift className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 mb-4">No prizes configured yet</p>
                        <Button onClick={() => setShowPrizeModal(true)}>
                          <Plus className="w-4 h-4 mr-2" />
                          Add First Prize
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* DRAW TAB */}
                <TabsContent value="draw">
                  <div className="space-y-6">
                    <div className="text-center">
                      <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full mb-4">
                        <Zap className="w-10 h-10 text-purple-600" />
                      </div>
                      <h3 className="text-2xl font-bold mb-2">Lucky Draw</h3>
                      <p className="text-gray-600 mb-6">Randomly select winners from participants</p>
                    </div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-3 gap-4">
                      <Card>
                        <CardContent className="p-4 text-center">
                          <Users className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                          <div className="text-2xl font-bold">{stats.totalParticipants}</div>
                          <div className="text-xs text-gray-600">Participants</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <Gift className="w-8 h-8 text-purple-500 mx-auto mb-2" />
                          <div className="text-2xl font-bold">{stats.totalPrizes}</div>
                          <div className="text-xs text-gray-600">Total Prizes</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <Trophy className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
                          <div className="text-2xl font-bold">{stats.totalWinners}</div>
                          <div className="text-xs text-gray-600">Winners</div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Draw Status */}
                    {selectedCampaign?.drawn_at ? (
                      <Alert className="bg-blue-50 border-blue-200">
                        <CheckCircle2 className="h-4 w-4 text-blue-600" />
                        <AlertDescription className="text-blue-800">
                          <strong>Draw completed!</strong> Winners were selected on {new Date(selectedCampaign.drawn_at).toLocaleString()}
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <>
                        {selectedCampaign?.status !== 'active' && (
                          <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                              Campaign must be <strong>active</strong> to perform a draw. Current status: <Badge>{selectedCampaign?.status}</Badge>
                            </AlertDescription>
                          </Alert>
                        )}

                        {selectedCampaign?.status === 'active' && stats.totalParticipants === 0 && (
                          <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                              No participants yet. Wait for consumers to enter via Journey Builder before performing draw.
                            </AlertDescription>
                          </Alert>
                        )}

                        {selectedCampaign?.status === 'active' && stats.totalParticipants > 0 && stats.totalPrizes === 0 && (
                          <Alert className="border-red-200 bg-red-50">
                            <AlertCircle className="h-4 w-4 text-red-600" />
                            <AlertDescription className="text-red-800">
                              No prizes configured! Please add prizes in the Prizes tab before performing draw.
                            </AlertDescription>
                          </Alert>
                        )}

                        {selectedCampaign?.status === 'active' && stats.totalParticipants > 0 && stats.totalPrizes > 0 && (
                          <div className="text-center">
                            <Button 
                              size="lg"
                              onClick={() => setShowDrawConfirmModal(true)}
                              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                            >
                              <Sparkles className="w-5 h-5 mr-2" />
                              Perform Lucky Draw
                            </Button>
                            <p className="text-sm text-gray-600 mt-2">
                              This will randomly select {stats.totalPrizes} winner{stats.totalPrizes > 1 ? 's' : ''} from {stats.totalParticipants} participant{stats.totalParticipants > 1 ? 's' : ''}
                            </p>
                          </div>
                        )}
                      </>
                    )}

                    {/* Winners List */}
                    {stats.totalWinners > 0 && (
                      <div>
                        <h4 className="font-semibold mb-3 flex items-center gap-2">
                          <Trophy className="w-5 h-5 text-yellow-500" />
                          Winners ({stats.totalWinners})
                        </h4>
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full">
                            <thead className="bg-yellow-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium">Name</th>
                                <th className="px-4 py-3 text-left text-xs font-medium">Phone</th>
                                <th className="px-4 py-3 text-left text-xs font-medium">Prize</th>
                                <th className="px-4 py-3 text-left text-xs font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {entries.filter(e => e.is_winner).map(winner => (
                                <tr key={winner.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-sm font-medium">{winner.consumer_name}</td>
                                  <td className="px-4 py-3 text-sm">{winner.consumer_phone}</td>
                                  <td className="px-4 py-3 text-sm">
                                    <Badge variant="outline">{winner.prize_won?.name || 'N/A'}</Badge>
                                  </td>
                                  <td className="px-4 py-3 text-sm">
                                    {winner.prize_claimed ? (
                                      <Badge className="bg-green-500">Claimed</Badge>
                                    ) : (
                                      <Badge className="bg-orange-500">Unclaimed</Badge>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        )}
      </div>

      {/* New Campaign Modal */}
      <Dialog open={showNewCampaignModal} onOpenChange={setShowNewCampaignModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{campaigns.length > 0 ? 'Edit Campaign' : 'Create New Campaign'}</DialogTitle>
            <DialogDescription>
              {campaigns.length > 0 ? 'Edit details for' : 'Create a lucky draw campaign for'} {selectedOrder?.order_no}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="campaign_name">Campaign Name *</Label>
              <Input
                id="campaign_name"
                value={newCampaign.campaign_name}
                onChange={(e) => setNewCampaign({...newCampaign, campaign_name: e.target.value})}
                placeholder="e.g. Grand Opening Lucky Draw"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaign_description">Description</Label>
              <Textarea
                id="campaign_description"
                value={newCampaign.campaign_description}
                onChange={(e) => setNewCampaign({...newCampaign, campaign_description: e.target.value})}
                placeholder="Brief description of the campaign"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_date">Start Date</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={newCampaign.start_date}
                  onChange={(e) => setNewCampaign({...newCampaign, start_date: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_date">End Date</Label>
                <Input
                  id="end_date"
                  type="date"
                  value={newCampaign.end_date}
                  onChange={(e) => setNewCampaign({...newCampaign, end_date: e.target.value})}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="draw_date">Draw Date (Optional)</Label>
              <Input
                id="draw_date"
                type="date"
                value={newCampaign.draw_date}
                onChange={(e) => setNewCampaign({...newCampaign, draw_date: e.target.value})}
              />
            </div>
            
            {/* Prizes Section in Modal */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <Label>Prizes (Optional - can add later)</Label>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => {
                    setEditingPrizeIndex(null)
                    setNewPrize({ name: '', description: '', quantity: 1, image_url: '' })
                    setPrizeImageFile(null)
                    setPrizeImagePreview(null)
                    setCompressedSize(null)
                    setShowPrizeModal(true)
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Prize
                </Button>
              </div>
              {prizes.length > 0 ? (
                <div className="space-y-2">
                  {prizes.map((prize, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div className="flex items-center gap-3 flex-1">
                        {prize.image_url && (
                          <div className="w-10 h-10 rounded overflow-hidden border bg-white flex-shrink-0">
                            <Image
                              src={getStorageUrl(prize.image_url) || prize.image_url}
                              alt={prize.name}
                              width={40}
                              height={40}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-sm">{prize.name}</div>
                          <div className="text-xs text-gray-600">Quantity: {prize.quantity}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => {
                            setEditingPrizeIndex(idx)
                            setNewPrize({ 
                              name: prize.name, 
                              description: prize.description, 
                              quantity: prize.quantity,
                              image_url: prize.image_url || ''
                            })
                            setPrizeImagePreview(prize.image_url || null)
                            setShowPrizeModal(true)
                          }}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => handleDeletePrize(idx)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No prizes added yet</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCampaignModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateCampaign} className="bg-purple-500 hover:bg-purple-600">
              {campaigns.length > 0 ? 'Save Changes' : 'Create Campaign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Prize Modal */}
      <Dialog open={showPrizeModal} onOpenChange={setShowPrizeModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPrizeIndex !== null ? 'Edit Prize' : 'Add Prize'}</DialogTitle>
            <DialogDescription>
              Configure a prize for this lucky draw campaign
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="prize_name">Prize Name *</Label>
              <Input
                id="prize_name"
                value={newPrize.name}
                onChange={(e) => setNewPrize({...newPrize, name: e.target.value})}
                placeholder="e.g. iPhone 15 Pro"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prize_description">Description</Label>
              <Textarea
                id="prize_description"
                value={newPrize.description}
                onChange={(e) => setNewPrize({...newPrize, description: e.target.value})}
                placeholder="Prize details"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prize_quantity">Quantity *</Label>
              <Input
                id="prize_quantity"
                type="number"
                min="1"
                value={newPrize.quantity}
                onChange={(e) => setNewPrize({...newPrize, quantity: parseInt(e.target.value) || 1})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prize_image">Prize Image</Label>
              <div className="flex items-center gap-4">
                {prizeImagePreview && (
                  <div className="relative w-24 h-24 rounded-lg border overflow-hidden bg-white">
                    <Image
                      src={prizeImagePreview}
                      alt="Prize preview"
                      width={96}
                      height={96}
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById('prize_image_input')?.click()}
                      className="flex-1"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {prizeImagePreview ? 'Change Image' : 'Upload Image'}
                    </Button>
                    {prizeImagePreview && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPrizeImageFile(null)
                          setPrizeImagePreview(null)
                          setNewPrize({...newPrize, image_url: ''})
                          setCompressedSize(null)
                        }}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    Optional: JPG, PNG, GIF, WebP (max 5MB)
                    {compressedSize && (
                      <span className="block text-green-600 font-medium mt-1">
                        Compressed size: {compressedSize}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <input
                id="prize_image_input"
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  
                  if (!file.type.startsWith('image/') || file.type === 'image/avif') {
                    alert('Please select a valid image file')
                    return
                  }
                  
                  if (file.size > 5 * 1024 * 1024) {
                    alert('Image size must be less than 5MB')
                    return
                  }

                  try {
                    // Compress immediately
                    const compressed = await compressImage(file)
                    setCompressedSize(`${(compressed.size / 1024).toFixed(2)} KB`)
                    
                    const reader = new FileReader()
                    reader.onloadend = () => {
                      setPrizeImagePreview(reader.result as string)
                    }
                    reader.readAsDataURL(compressed)
                    setPrizeImageFile(compressed)
                  } catch (err) {
                    console.error('Compression failed', err)
                    alert('Failed to compress image')
                  }
                }}
                className="hidden"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPrizeModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddPrize} className="bg-purple-500 hover:bg-purple-600">
              {editingPrizeIndex !== null ? 'Update Prize' : 'Add Prize'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Draw Confirmation Modal */}
      <Dialog open={showDrawConfirmModal} onOpenChange={setShowDrawConfirmModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Lucky Draw</DialogTitle>
            <DialogDescription>
              Are you sure you want to perform the lucky draw?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This action cannot be undone. Winners will be randomly selected from {stats.totalParticipants} participants.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDrawConfirmModal(false)}>
              Cancel
            </Button>
            <Button onClick={handlePerformDraw} className="bg-gradient-to-r from-purple-500 to-pink-500">
              <Sparkles className="w-4 h-4 mr-2" />
              Perform Draw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
