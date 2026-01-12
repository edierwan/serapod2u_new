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
    Megaphone
} from 'lucide-react'

interface BannerItem {
    id: string
    image_url: string
    link_to: 'rewards' | 'products' | 'contact-us' | 'no-link' | string
    expires_at: string
    page?: 'home' | 'rewards' | 'products' | 'profile'
}

interface BannerConfig {
    enabled: boolean
    template: 'grid' | 'carousel'
    items: BannerItem[]
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

            const fileExt = 'jpg'
            const fileName = `master-banner-${userProfile.organization_id}-${Date.now()}.${fileExt}`
            const filePath = `journey-images/${fileName}`

            // Upload to Supabase storage
            const { error: uploadError } = await supabase.storage
                .from('product-images')
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: true
                })

            if (uploadError) throw uploadError

            // Get public URL
            const { data: urlData } = supabase.storage
                .from('product-images')
                .getPublicUrl(filePath)

            onSuccess(urlData.publicUrl)

            toast({
                title: "Image uploaded",
                description: "Banner image has been uploaded successfully",
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
                    is_active: masterConfig.is_active
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
                                            <TabsTrigger value="home">
                                                Home
                                                {masterConfig.banner_config.items.filter(i => (i.page || 'home') === 'home').length > 0 && (
                                                    <Badge variant="secondary" className="ml-1 h-5 px-1">
                                                        {masterConfig.banner_config.items.filter(i => (i.page || 'home') === 'home').length}
                                                    </Badge>
                                                )}
                                            </TabsTrigger>
                                            <TabsTrigger value="rewards">
                                                Rewards
                                                {masterConfig.banner_config.items.filter(i => i.page === 'rewards').length > 0 && (
                                                    <Badge variant="secondary" className="ml-1 h-5 px-1">
                                                        {masterConfig.banner_config.items.filter(i => i.page === 'rewards').length}
                                                    </Badge>
                                                )}
                                            </TabsTrigger>
                                            <TabsTrigger value="products">
                                                Product
                                                {masterConfig.banner_config.items.filter(i => i.page === 'products').length > 0 && (
                                                    <Badge variant="secondary" className="ml-1 h-5 px-1">
                                                        {masterConfig.banner_config.items.filter(i => i.page === 'products').length}
                                                    </Badge>
                                                )}
                                            </TabsTrigger>
                                            <TabsTrigger value="profile">
                                                Profile
                                                {masterConfig.banner_config.items.filter(i => i.page === 'profile').length > 0 && (
                                                    <Badge variant="secondary" className="ml-1 h-5 px-1">
                                                        {masterConfig.banner_config.items.filter(i => i.page === 'profile').length}
                                                    </Badge>
                                                )}
                                            </TabsTrigger>
                                        </TabsList>
                                    </Tabs>
                                </div>

                                {/* Banner Items for Current Page */}
                                <div className="space-y-4 mt-4">
                                    <div className="flex items-center justify-between">
                                        <Label>
                                            Banner Items for {activeBannerTab.charAt(0).toUpperCase() + activeBannerTab.slice(1)} Page
                                        </Label>
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
                                                    page: activeBannerTab
                                                })
                                                updateConfig({ items: newItems })
                                            }}
                                        >
                                            <ImageIcon className="w-4 h-4 mr-2" />
                                            Add Banner Item
                                        </Button>
                                    </div>

                                    {currentPageItems.length === 0 ? (
                                        <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed">
                                            <ImageIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                                            <p>No banners configured for the {activeBannerTab} page</p>
                                            <p className="text-sm">Click "Add Banner Item" to get started</p>
                                        </div>
                                    ) : (
                                        currentPageItems.map((item) => {
                                            const actualIndex = masterConfig.banner_config.items.findIndex(i => i.id === item.id)
                                            return (
                                                <div
                                                    key={item.id}
                                                    className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3 relative"
                                                >
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="absolute top-2 right-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                                                        onClick={() => {
                                                            const newItems = masterConfig.banner_config.items.filter(i => i.id !== item.id)
                                                            updateConfig({ items: newItems })
                                                        }}
                                                    >
                                                        Remove
                                                    </Button>

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
                                                                            handleImageUpload(file, (url) => {
                                                                                const newItems = [...masterConfig.banner_config.items]
                                                                                newItems[actualIndex].image_url = url
                                                                                updateConfig({ items: newItems })
                                                                            })
                                                                        }
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
                                                                <p className="text-xs text-gray-500">Preview (16:9 aspect ratio):</p>
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
