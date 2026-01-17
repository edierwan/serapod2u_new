'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useToast } from '@/components/ui/use-toast'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getStorageUrl } from '@/lib/utils'
import {
    Layout,
    Save,
    Image as ImageIcon,
    Info,
    Loader2,
    CheckCircle2,
    Megaphone,
    Eye,
    EyeOff,
    Bell
} from 'lucide-react'

interface BannerItem {
    id: string
    image_url: string
    link_to: 'rewards' | 'products' | 'contact-us' | 'no-link' | string
    expires_at: string
    page?: 'home' | 'rewards' | 'products' | 'profile'
    is_active?: boolean
    placement?: 'top' | 'bottom' // Per-item placement override (preferred) or section grouping
}

// Grouped structure for UI, but flat array in DB is easier unless we change schema
// Let's assume we keep the flat array but filter by placement in UI

interface BannerConfig {
    enabled: boolean
    template: 'grid' | 'carousel'
    items: BannerItem[]
    // Remove global placement or keep as default
    // placement: 'top' | 'bottom' 
    autoSlide?: boolean
    slideInterval?: number
    showDots?: boolean
    showProgress?: boolean
}

interface MasterBannerConfig {
    id?: string
    org_id: string
    banner_config: BannerConfig
    is_active: boolean
    is_new?: boolean
}

interface UserProfile {
    id: string
    organization_id: string
    organizations?: {
        id: string
        org_name: string
        org_type_code: string
    }
    roles?: {
        role_name: string
        role_level: number
    }
}

export default function MasterAnnouncementBannerView({ userProfile }: { userProfile: UserProfile }) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [uploadingImage, setUploadingImage] = useState(false)
    const [masterConfig, setMasterConfig] = useState<MasterBannerConfig | null>(null)
    const [activeBannerTab, setActiveBannerTab] = useState<'home' | 'rewards' | 'products' | 'profile'>('home')
    const { toast } = useToast()
    const supabase = createClient()

    // Load master banner config
    useEffect(() => {
        loadMasterConfig()
    }, [])

    async function loadMasterConfig() {
        try {
            setLoading(true)
            const res = await fetch('/api/master-banner')
            const data = await res.json()

            if (data.success) {
                setMasterConfig(data.data)
            } else {
                toast({
                    title: "Error",
                    description: data.error || "Failed to load master banner config",
                    variant: "destructive"
                })
            }
        } catch (error) {
            console.error('Error loading master banner config:', error)
            toast({
                title: "Error",
                description: "Failed to load master banner configuration",
                variant: "destructive"
            })
        } finally {
            setLoading(false)
        }
    }

    const handleImageUpload = async (file: File, onSuccess: (url: string) => void) => {
        try {
            setUploadingImage(true)

            const formData = new FormData()
            formData.append('file', file)

            const res = await fetch('/api/master-banner/upload', {
                method: 'POST',
                body: formData
            })

            const data = await res.json()

            if (!data.success) {
                throw new Error(data.error || 'Upload failed')
            }

            onSuccess(data.url)

            toast({
                title: "Image uploaded",
                description: "Banner image has been processed (16:9) and uploaded successfully",
            })
        } catch (error: any) {
            console.error('Error uploading image:', error)
            toast({
                title: "Upload failed",
                description: error.message || "Failed to upload image",
                variant: "destructive"
            })
        } finally {
            setUploadingImage(false)
        }
    }

    async function handleSave() {
        if (!masterConfig) return

        try {
            setSaving(true)

            const res = await fetch('/api/master-banner', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    banner_config: masterConfig.banner_config,
                    // Always set is_active to true when saving - if user is saving a config, they want it active
                    // The banner_config.enabled field controls whether banners actually display
                    is_active: true
                })
            })

            const data = await res.json()

            if (data.success) {
                setMasterConfig({
                    ...data.data,
                    is_new: false
                })
                toast({
                    title: "Saved",
                    description: "Master announcement banner configuration has been saved",
                })
            } else {
                toast({
                    title: "Error",
                    description: data.error || "Failed to save configuration",
                    variant: "destructive"
                })
            }
        } catch (error) {
            console.error('Error saving:', error)
            toast({
                title: "Error",
                description: "Failed to save master banner configuration",
                variant: "destructive"
            })
        } finally {
            setSaving(false)
        }
    }

    const updateConfig = (updates: Partial<BannerConfig>) => {
        if (!masterConfig) return
        setMasterConfig({
            ...masterConfig,
            banner_config: {
                ...masterConfig.banner_config,
                ...updates
            }
        })
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        )
    }

    if (!masterConfig) {
        return (
            <Alert className="bg-red-50 border-red-200">
                <AlertDescription className="text-red-800">Failed to load master banner configuration</AlertDescription>
            </Alert>
        )
    }

    const currentPageItems = masterConfig.banner_config.items.filter(
        item => (item.page || 'home') === activeBannerTab
    )

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Megaphone className="w-7 h-7 text-orange-600" />
                        Master Announcement Banner
                    </h1>
                    <p className="text-gray-600 mt-1">
                        Configure default announcement banners for all journeys
                    </p>
                </div>
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4 mr-2" />
                            Save Configuration
                        </>
                    )}
                </Button>
            </div>

            {/* Info Alert */}
            <Alert className="bg-blue-50 border-blue-200">
                <Info className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                    <strong>How it works:</strong> This master banner configuration will be used as the default for all consumer journeys.
                    Individual journeys can override this by configuring their own banner. If a journey doesn't have its own banner configured,
                    this master banner will be displayed to consumers.
                </AlertDescription>
            </Alert>

            {/* Main Config Card */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Layout className="w-5 h-5" />
                        Banner Configuration
                    </CardTitle>
                    <CardDescription>
                        Configure the default announcement banners that will appear across all journey pages
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Enable Toggle */}
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="space-y-0.5">
                            <Label className="text-base font-medium">Enable Master Banner</Label>
                            <p className="text-sm text-gray-600">
                                When enabled, these banners will show on journeys that don't have their own banner configured
                            </p>
                        </div>
                        <Switch
                            checked={masterConfig.banner_config.enabled}
                            onCheckedChange={(checked) => updateConfig({ enabled: checked })}
                        />
                    </div>

                    {masterConfig.banner_config.enabled && (
                        <>
                            {/* Template Selection */}
                            <div className="space-y-2">
                                <Label>Banner Display Template</Label>
                                <Select
                                    value={masterConfig.banner_config.template}
                                    onValueChange={(value: 'grid' | 'carousel') => updateConfig({ template: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="grid">Grid (Stacked)</SelectItem>
                                        <SelectItem value="carousel">Carousel (Slider)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-gray-500">
                                    Grid shows banners stacked vertically. Carousel allows horizontal scrolling.
                                </p>
                            </div>

                            {/* Placement Setting */}
                            <div className="space-y-2">
                                <Label>Banner Placement</Label>
                                <Select
                                    value={masterConfig.banner_config.placement || 'top'}
                                    onValueChange={(value: 'top' | 'bottom') => updateConfig({ placement: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="top">Top (Before Content)</SelectItem>
                                        <SelectItem value="bottom">Bottom (After Content)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-gray-500">
                                    Choose whether to display the banner at the top or bottom of the page content.
                                </p>
                            </div>

                            {/* Carousel Settings */}
                            {masterConfig.banner_config.template === 'carousel' && (
                                <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                    <h4 className="font-medium text-sm text-gray-900">Slider Configuration</h4>
                                    
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label className="text-sm">Auto-play Slideshow</Label>
                                            <p className="text-xs text-gray-500">Automatically advance slides</p>
                                        </div>
                                        <Switch
                                            checked={masterConfig.banner_config.autoSlide !== false}
                                            onCheckedChange={(checked) => updateConfig({ autoSlide: checked })}
                                        />
                                    </div>

                                    {(masterConfig.banner_config.autoSlide !== false) && (
                                        <div className="space-y-2">
                                            <Label className="text-sm">Slide Duration (Seconds)</Label>
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    max={60}
                                                    value={masterConfig.banner_config.slideInterval || 5}
                                                    onChange={(e) => updateConfig({ slideInterval: parseInt(e.target.value) || 5 })}
                                                    className="w-24"
                                                />
                                                <span className="text-sm text-gray-500">seconds</span>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label className="text-sm">Show Dots Navigation</Label>
                                            <p className="text-xs text-gray-500">Show indicators for each slide</p>
                                        </div>
                                        <Switch
                                            checked={masterConfig.banner_config.showDots !== false}
                                            onCheckedChange={(checked) => updateConfig({ showDots: checked })}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label className="text-sm">Show Progress Bar</Label>
                                            <p className="text-xs text-gray-500">Show timer progress between slides</p>
                                        </div>
                                        <Switch
                                            checked={masterConfig.banner_config.showProgress !== false}
                                            onCheckedChange={(checked) => updateConfig({ showProgress: checked })}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Page Tabs */}
                            <div className="space-y-4 p-4 border border-gray-200 rounded-lg">
                                <div className="space-y-2">
                                    <Label>Banner Page</Label>
                                    <p className="text-sm text-gray-600">
                                        Configure banners for each page of the consumer app
                                    </p>
                                    <Tabs
                                        value={activeBannerTab}
                                        onValueChange={(value) => setActiveBannerTab(value as typeof activeBannerTab)}
                                        className="w-full"
                                    >
                                        <TabsList className="grid w-full grid-cols-4">
                                            <TabsTrigger value="home" className="relative">
                                                Home
                                                <span className={`ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-semibold rounded-full text-white ${
                                                    activeBannerTab === 'home' ? 'bg-green-500' : 'bg-gray-400'
                                                }`}>
                                                    {masterConfig.banner_config.items.filter(i => (i.page || 'home') === 'home').length}
                                                </span>
                                            </TabsTrigger>
                                            <TabsTrigger value="rewards" className="relative">
                                                Rewards
                                                <span className={`ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-semibold rounded-full text-white ${
                                                    activeBannerTab === 'rewards' ? 'bg-green-500' : 'bg-gray-400'
                                                }`}>
                                                    {masterConfig.banner_config.items.filter(i => i.page === 'rewards').length}
                                                </span>
                                            </TabsTrigger>
                                            <TabsTrigger value="products" className="relative">
                                                Product
                                                <span className={`ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-semibold rounded-full text-white ${
                                                    activeBannerTab === 'products' ? 'bg-green-500' : 'bg-gray-400'
                                                }`}>
                                                    {masterConfig.banner_config.items.filter(i => i.page === 'products').length}
                                                </span>
                                            </TabsTrigger>
                                            <TabsTrigger value="profile" className="relative">
                                                Profile
                                                <span className={`ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-semibold rounded-full text-white ${
                                                    activeBannerTab === 'profile' ? 'bg-green-500' : 'bg-gray-400'
                                                }`}>
                                                    {masterConfig.banner_config.items.filter(i => i.page === 'profile').length}
                                                </span>
                                            </TabsTrigger>
                                        </TabsList>
                                    </Tabs>
                                </div>

                                {/* Banner Items for Current Page */}
                                <div className="space-y-6 mt-4">
                                    {/* Action Buttons */}
                                    <div className="flex justify-end gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                const newItems = [...masterConfig.banner_config.items]
                                                newItems.push({
                                                    id: crypto.randomUUID(),
                                                    image_url: '',
                                                    link_to: 'rewards',
                                                    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                                                    page: activeBannerTab,
                                                    placement: 'top', // Default place to top
                                                    is_active: true
                                                })
                                                updateConfig({ items: newItems })
                                            }}
                                        >
                                            <ImageIcon className="w-4 h-4 mr-2" />
                                            Add Top Banner
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                const newItems = [...masterConfig.banner_config.items]
                                                newItems.push({
                                                    id: crypto.randomUUID(),
                                                    image_url: '',
                                                    link_to: 'rewards',
                                                    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                                                    page: activeBannerTab,
                                                    placement: 'bottom', // Default place to bottom
                                                    is_active: true
                                                })
                                                updateConfig({ items: newItems })
                                            }}
                                        >
                                            <ImageIcon className="w-4 h-4 mr-2" />
                                            Add Bottom Banner
                                        </Button>
                                    </div>

                                    {/* Group Items by Placement */}
                                    {['top', 'bottom'].map((placement) => {
                                        const placementItems = currentPageItems.filter(item => 
                                            (item.placement || masterConfig.banner_config.placement || 'top') === placement
                                        );

                                        return (
                                            <div key={placement} className="space-y-4">
                                                <div className="flex items-center gap-2 pb-2 border-b">
                                                    <Badge variant={placement === 'top' ? 'default' : 'secondary'}>
                                                        {placement === 'top' ? 'Top Banners (Before Content)' : 'Bottom Banners (After Content)'}
                                                    </Badge>
                                                    <span className="text-xs text-gray-500">{placementItems.length} items</span>
                                                </div>

                                                {placementItems.length === 0 ? (
                                                    <div className="text-center py-6 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed">
                                                        <p className="text-sm">No {placement} banners configured for {activeBannerTab}</p>
                                                    </div>
                                                ) : (
                                                    placementItems.map((item) => {
                                                        const actualIndex = masterConfig.banner_config.items.findIndex(i => i.id === item.id)
                                                        const isActive = item.is_active !== false 
                                                        return (
                                                            <div
                                                                key={item.id}
                                                                className={`p-4 rounded-lg border space-y-3 relative ${
                                                                    isActive 
                                                                        ? 'bg-gray-50 border-gray-200' 
                                                                        : 'bg-gray-100 border-gray-300 opacity-60'
                                                                }`}
                                                            >
                                                                {/* Action buttons row */}
                                                                <div className="absolute top-2 right-2 flex items-center gap-1">
                                                                     {/* Move Placement Button */}
                                                                    <Select
                                                                        value={item.placement || 'top'}
                                                                        onValueChange={(val: 'top' | 'bottom') => {
                                                                             const newItems = [...masterConfig.banner_config.items];
                                                                             newItems[actualIndex].placement = val;
                                                                             updateConfig({ items: newItems });
                                                                        }}
                                                                    >
                                                                        <SelectTrigger className="h-8 w-[100px] text-xs">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="top">Move to Top</SelectItem>
                                                                            <SelectItem value="bottom">Move to Bottom</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>

                                                                    {/* Active/Inactive Toggle */}
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className={`${
                                                                            isActive 
                                                                                ? 'text-green-600 hover:text-green-700 hover:bg-green-50' 
                                                                                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                                                        }`}
                                                                        onClick={() => {
                                                                            const newItems = [...masterConfig.banner_config.items]
                                                                            newItems[actualIndex].is_active = !isActive
                                                                            updateConfig({ items: newItems })
                                                                        }}
                                                                        title={isActive ? "Click to deactivate" : "Click to activate"}
                                                                    >
                                                                        {isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                                                    </Button>
                                                                    {/* Remove button */}
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                                        onClick={() => {
                                                                            const newItems = masterConfig.banner_config.items.filter(i => i.id !== item.id)
                                                                            updateConfig({ items: newItems })
                                                                        }}
                                                                    >
                                                                        Remove
                                                                    </Button>
                                                                </div>

                                                                {/* Status indicator */}
                                                                {!isActive && (
                                                                    <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 px-3 py-1.5 rounded-md border border-amber-200">
                                                                        <EyeOff className="w-4 h-4" />
                                                                        <span>This banner is inactive and will not be shown to consumers</span>
                                                                    </div>
                                                                )}

                                                                <div className="space-y-2">
                                                                    <Label>Image URL</Label>
                                                                    <div className="flex gap-2">
                                                                        <Input
                                                                            value={item.image_url}
                                                                            onChange={(e) => {
                                                                                const newItems = [...masterConfig.banner_config.items]
                                                                                newItems[actualIndex].image_url = e.target.value
                                                                                updateConfig({ items: newItems })
                                                                            }}
                                                                            placeholder="https://example.com/banner.jpg"
                                                                        />
                                                                        <div className="relative">
                                                                            <input
                                                                                type="file"
                                                                                id={`banner-upload-${item.id}`}
                                                                                className="hidden"
                                                                                accept="image/*"
                                                                    onChange={(e) => {
                                                                        const file = e.target.files?.[0]
                                                                        if (file) {
                                                                            const itemId = item.id // Capture item ID to avoid stale closure
                                                                            handleImageUpload(file, (url) => {
                                                                                setMasterConfig(prevConfig => {
                                                                                    if (!prevConfig) return prevConfig
                                                                                    const newItems = [...prevConfig.banner_config.items]
                                                                                    const idx = newItems.findIndex(i => i.id === itemId)
                                                                                    if (idx !== -1) {
                                                                                        newItems[idx].image_url = url
                                                                                    }
                                                                                    return {
                                                                                        ...prevConfig,
                                                                                        banner_config: {
                                                                                            ...prevConfig.banner_config,
                                                                                            items: newItems
                                                                                        }
                                                                                    }
                                                                                })
                                                                            })
                                                                        }
                                                                        // Reset the input value to allow re-uploading same file
                                                                        e.target.value = ''
                                                                    }}
                                                                />
                                                                <Button
                                                                    variant="outline"
                                                                    disabled={uploadingImage}
                                                                    onClick={() => document.getElementById(`banner-upload-${item.id}`)?.click()}
                                                                >
                                                                    {uploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Upload'}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                        {item.image_url && (
                                                            <div className="space-y-2">
                                                                <p className="text-xs text-gray-500">Preview (Auto-resized to 16:9):</p>
                                                                <div className="relative w-full bg-gray-100 rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                                                                    <Image
                                                                        src={getStorageUrl(item.image_url) || item.image_url}
                                                                        alt="Banner preview"
                                                                        fill
                                                                        className="object-cover"
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="space-y-2">
                                                            <Label>Link Destination</Label>
                                                            <Select
                                                                value={['rewards', 'products', 'contact-us', 'no-link'].includes(item.link_to) ? item.link_to : 'external'}
                                                                onValueChange={(value: string) => {
                                                                    const newItems = [...masterConfig.banner_config.items]
                                                                    if (value === 'external') {
                                                                        newItems[actualIndex].link_to = ''
                                                                    } else {
                                                                        newItems[actualIndex].link_to = value
                                                                    }
                                                                    updateConfig({ items: newItems })
                                                                }}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="rewards">Rewards Page</SelectItem>
                                                                    <SelectItem value="products">Products Page</SelectItem>
                                                                    <SelectItem value="contact-us">Contact Us</SelectItem>
                                                                    <SelectItem value="no-link">No Link (Tap to zoom)</SelectItem>
                                                                    <SelectItem value="external">External URL</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>

                                                        <div className="space-y-2">
                                                            <Label>Expires At</Label>
                                                            <Input
                                                                type="date"
                                                                value={item.expires_at?.split('T')[0] || ''}
                                                                onChange={(e) => {
                                                                    const newItems = [...masterConfig.banner_config.items]
                                                                    newItems[actualIndex].expires_at = e.target.value
                                                                    updateConfig({ items: newItems })
                                                                }}
                                                            />
                                                        </div>
                                                    </div>

                                                    {!['rewards', 'products', 'contact-us', 'no-link'].includes(item.link_to) && item.link_to !== '' && (
                                                        <div className="space-y-2">
                                                            <Label>External URL</Label>
                                                            <Input
                                                                value={item.link_to}
                                                                onChange={(e) => {
                                                                    const newItems = [...masterConfig.banner_config.items]
                                                                    newItems[actualIndex].link_to = e.target.value
                                                                    updateConfig({ items: newItems })
                                                                }}
                                                                placeholder="https://example.com"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Status Card */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Configuration Status</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            {masterConfig.banner_config.enabled ? (
                                <Badge className="bg-green-100 text-green-800">
                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                    Enabled
                                </Badge>
                            ) : (
                                <Badge variant="secondary">
                                    Disabled
                                </Badge>
                            )}
                        </div>
                        <div className="text-sm text-gray-600">
                            Total banners: <strong>{masterConfig.banner_config.items.length}</strong>
                        </div>
                        <div className="text-sm text-gray-600">
                            • Home: {masterConfig.banner_config.items.filter(i => (i.page || 'home') === 'home').length}
                            • Rewards: {masterConfig.banner_config.items.filter(i => i.page === 'rewards').length}
                            • Products: {masterConfig.banner_config.items.filter(i => i.page === 'products').length}
                            • Profile: {masterConfig.banner_config.items.filter(i => i.page === 'profile').length}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
