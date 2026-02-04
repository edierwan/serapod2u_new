'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useToast } from '@/components/ui/use-toast'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getStorageUrl } from '@/lib/utils'
import {
    Save,
    Image as ImageIcon,
    Info,
    Loader2,
    CheckCircle2,
    Megaphone,
    Eye,
    EyeOff,
    Plus,
    Trash2,
    ArrowUp,
    ArrowDown,
    Settings2,
    LayoutGrid,
    Layers
} from 'lucide-react'

interface BannerItem {
    id: string
    image_url: string
    link_to: 'short_link' | 'page_rewards' | 'page_product' | 'page-contactus' | 'external_url' | 'no-link' | 'rewards' | 'products' | 'contact-us' | string
    external_url?: string
    expires_at: string
    page?: 'home' | 'rewards' | 'products' | 'profile'
    is_active?: boolean
    placement?: 'top' | 'bottom'
}

interface PageBannerSettings {
    topTemplate: 'grid' | 'carousel'
    bottomTemplate: 'grid' | 'carousel'
    topAutoSlide?: boolean
    topSlideInterval?: number
    bottomAutoSlide?: boolean
    bottomSlideInterval?: number
}

interface BannerConfig {
    enabled: boolean
    template: 'grid' | 'carousel'
    items: BannerItem[]
    placement?: 'top' | 'bottom'
    autoSlide?: boolean
    slideInterval?: number
    showDots?: boolean
    showProgress?: boolean
    pageSettings?: {
        home?: PageBannerSettings
        rewards?: PageBannerSettings
        products?: PageBannerSettings
        profile?: PageBannerSettings
    }
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

const defaultPageSettings: PageBannerSettings = {
    topTemplate: 'carousel',
    bottomTemplate: 'grid',
    topAutoSlide: true,
    topSlideInterval: 5,
    bottomAutoSlide: false,
    bottomSlideInterval: 5
}

const pageLabels = {
    home: { name: 'Home', icon: '🏠' },
    rewards: { name: 'Rewards', icon: '🎁' },
    products: { name: 'Products', icon: '📦' },
    profile: { name: 'Profile', icon: '👤' }
}

const linkOptions = [
    { value: 'short_link', label: '{short_link} (App)' },
    { value: 'page_rewards', label: '{page_rewards}' },
    { value: 'page_product', label: '{page_product}' },
    { value: 'page-contactus', label: '{page-contactus}' },
    { value: 'external_url', label: '{External_URL}' },
    { value: 'no-link', label: 'No Link' }
]

const getLinkSelectionValue = (item: BannerItem) => {
    if (item.link_to === 'rewards') return 'page_rewards'
    if (item.link_to === 'products') return 'page_product'
    if (item.link_to === 'contact-us') return 'page-contactus'
    if (item.link_to === 'short_link') return 'short_link'
    if (item.link_to === 'external_url') return 'external_url'
    if (item.link_to === 'no-link') return 'no-link'
    if (item.link_to?.startsWith('http') || item.external_url) return 'external_url'
    if (item.link_to === 'page_rewards' || item.link_to === 'page_product' || item.link_to === 'page-contactus') return item.link_to
    return 'no-link'
}

const getExternalUrlValue = (item: BannerItem) => {
    if (item.external_url) return item.external_url
    if (item.link_to?.startsWith('http')) return item.link_to
    return ''
}

export default function MasterAnnouncementBannerView({ userProfile }: { userProfile: UserProfile }) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [uploadingImage, setUploadingImage] = useState(false)
    const [masterConfig, setMasterConfig] = useState<MasterBannerConfig | null>(null)
    const [activeBannerTab, setActiveBannerTab] = useState<'home' | 'rewards' | 'products' | 'profile'>('home')
    const { toast } = useToast()

    useEffect(() => {
        loadMasterConfig()
    }, [])

    async function loadMasterConfig() {
        try {
            setLoading(true)
            const res = await fetch('/api/master-banner')
            const data = await res.json()

            if (data.success) {
                const config = data.data
                if (!config.banner_config.pageSettings) {
                    config.banner_config.pageSettings = {
                        home: { ...defaultPageSettings },
                        rewards: { ...defaultPageSettings },
                        products: { ...defaultPageSettings },
                        profile: { ...defaultPageSettings }
                    }
                }
                setMasterConfig(config)
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
                description: "Banner image has been processed and uploaded successfully",
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
                    is_active: true
                })
            })

            const data = await res.json()

            if (data.success) {
                setMasterConfig({ ...data.data, is_new: false })
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

    const getPageSettings = (page: 'home' | 'rewards' | 'products' | 'profile'): PageBannerSettings => {
        return masterConfig?.banner_config.pageSettings?.[page] || defaultPageSettings
    }

    const updatePageSettings = (page: 'home' | 'rewards' | 'products' | 'profile', updates: Partial<PageBannerSettings>) => {
        if (!masterConfig) return
        const currentSettings = getPageSettings(page)
        setMasterConfig({
            ...masterConfig,
            banner_config: {
                ...masterConfig.banner_config,
                pageSettings: {
                    ...masterConfig.banner_config.pageSettings,
                    [page]: {
                        ...currentSettings,
                        ...updates
                    }
                }
            }
        })
    }

    const addBanner = (placement: 'top' | 'bottom') => {
        if (!masterConfig) return
        const newItems = [...masterConfig.banner_config.items]
        newItems.push({
            id: crypto.randomUUID(),
            image_url: '',
            link_to: 'page_rewards',
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            page: activeBannerTab,
            placement,
            is_active: true
        })
        updateConfig({ items: newItems })
    }

    const removeBanner = (id: string) => {
        if (!masterConfig) return
        const newItems = masterConfig.banner_config.items.filter(i => i.id !== id)
        updateConfig({ items: newItems })
    }

    const updateBannerItem = (id: string, updates: Partial<BannerItem>) => {
        if (!masterConfig) return
        const newItems = masterConfig.banner_config.items.map(item =>
            item.id === id ? { ...item, ...updates } : item
        )
        updateConfig({ items: newItems })
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

    const BannerCard = ({ item }: { item: BannerItem }) => {
        const isActive = item.is_active !== false

        return (
            <div className={`group relative bg-white rounded-xl border-2 transition-all duration-200 ${isActive ? 'border-gray-200 hover:border-blue-300 hover:shadow-md' : 'border-gray-300 opacity-60'
                }`}>
                <div className="relative aspect-[16/9] bg-gradient-to-br from-gray-100 to-gray-200 rounded-t-xl overflow-hidden">
                    {item.image_url ? (
                        <Image
                            src={getStorageUrl(item.image_url) || item.image_url}
                            alt="Banner preview"
                            fill
                            className="object-cover"
                        />
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                            <ImageIcon className="w-12 h-12 mb-2" />
                            <span className="text-sm">No image</span>
                        </div>
                    )}

                    <div className="absolute top-2 left-2">
                        <Badge className={isActive ? 'bg-green-500' : 'bg-gray-500'}>
                            {isActive ? 'Active' : 'Inactive'}
                        </Badge>
                    </div>

                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                            size="icon"
                            variant="secondary"
                            className="h-8 w-8 bg-white/90 hover:bg-white"
                            onClick={() => updateBannerItem(item.id, { is_active: !isActive })}
                        >
                            {isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                        <Button
                            size="icon"
                            variant="destructive"
                            className="h-8 w-8"
                            onClick={() => removeBanner(item.id)}
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                </div>

                <div className="p-4 space-y-3">
                    <div className="flex gap-2">
                        <Input
                            value={item.image_url}
                            onChange={(e) => updateBannerItem(item.id, { image_url: e.target.value })}
                            placeholder="Image URL or upload"
                            className="text-sm"
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
                                            updateBannerItem(item.id, { image_url: url })
                                        })
                                    }
                                    e.target.value = ''
                                }}
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={uploadingImage}
                                onClick={() => document.getElementById(`banner-upload-${item.id}`)?.click()}
                            >
                                {uploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Upload'}
                            </Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Select
                            value={getLinkSelectionValue(item)}
                            onValueChange={(value: string) => {
                                if (value === 'external_url') {
                                    updateBannerItem(item.id, {
                                        link_to: 'external_url',
                                        external_url: getExternalUrlValue(item)
                                    })
                                } else {
                                    updateBannerItem(item.id, { link_to: value, external_url: undefined })
                                }
                            }}
                        >
                            <SelectTrigger className="text-sm">
                                <SelectValue placeholder="Link to..." />
                            </SelectTrigger>
                            <SelectContent>
                                {linkOptions.map(option => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input
                            type="date"
                            value={item.expires_at?.split('T')[0] || ''}
                            onChange={(e) => updateBannerItem(item.id, { expires_at: e.target.value })}
                            className="text-sm"
                        />
                    </div>

                    {getLinkSelectionValue(item) === 'external_url' && (
                        <Input
                            value={getExternalUrlValue(item)}
                            onChange={(e) => updateBannerItem(item.id, { link_to: 'external_url', external_url: e.target.value })}
                            placeholder="https://example.com"
                            className="text-sm"
                        />
                    )}
                </div>
            </div>
        )
    }

    const BannerSection = ({ title, placement, items, template, autoSlide, slideInterval }: {
        title: string
        placement: 'top' | 'bottom'
        items: BannerItem[]
        template: 'grid' | 'carousel'
        autoSlide?: boolean
        slideInterval?: number
    }) => (
        <div className="space-y-4">
            <div className="flex items-center justify-between bg-gradient-to-r from-gray-50 to-white p-4 rounded-xl border">
                <div className="flex items-center gap-3">
                    {placement === 'top' ? (
                        <ArrowUp className="w-5 h-5 text-blue-600" />
                    ) : (
                        <ArrowDown className="w-5 h-5 text-purple-600" />
                    )}
                    <div>
                        <h3 className="font-semibold text-gray-900">{title}</h3>
                        <p className="text-xs text-gray-500">{items.length} banner{items.length !== 1 ? 's' : ''}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-white rounded-lg border p-1">
                        <Button
                            size="sm"
                            variant={template === 'carousel' ? 'default' : 'ghost'}
                            className="h-7 px-2 text-xs"
                            onClick={() => updatePageSettings(activeBannerTab, {
                                [placement === 'top' ? 'topTemplate' : 'bottomTemplate']: 'carousel'
                            })}
                        >
                            <Layers className="w-3 h-3 mr-1" />
                            Slider
                        </Button>
                        <Button
                            size="sm"
                            variant={template === 'grid' ? 'default' : 'ghost'}
                            className="h-7 px-2 text-xs"
                            onClick={() => updatePageSettings(activeBannerTab, {
                                [placement === 'top' ? 'topTemplate' : 'bottomTemplate']: 'grid'
                            })}
                        >
                            <LayoutGrid className="w-3 h-3 mr-1" />
                            Stacked
                        </Button>
                    </div>

                    {template === 'carousel' && (
                        <div className="flex items-center gap-2 text-sm">
                            <Switch
                                checked={autoSlide !== false}
                                onCheckedChange={(checked) => updatePageSettings(activeBannerTab, {
                                    [placement === 'top' ? 'topAutoSlide' : 'bottomAutoSlide']: checked
                                })}
                            />
                            <span className="text-gray-600">Auto</span>
                            {autoSlide !== false && (
                                <Input
                                    type="number"
                                    min={1}
                                    max={30}
                                    value={slideInterval || 5}
                                    onChange={(e) => updatePageSettings(activeBannerTab, {
                                        [placement === 'top' ? 'topSlideInterval' : 'bottomSlideInterval']: parseInt(e.target.value) || 5
                                    })}
                                    className="w-14 h-7 text-xs"
                                />
                            )}
                        </div>
                    )}

                    <Button size="sm" onClick={() => addBanner(placement)}>
                        <Plus className="w-4 h-4 mr-1" />
                        Add
                    </Button>
                </div>
            </div>

            {items.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
                    <ImageIcon className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                    <p className="text-gray-500 mb-3">No {placement} banners yet</p>
                    <Button variant="outline" onClick={() => addBanner(placement)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add First Banner
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map(item => (
                        <BannerCard key={item.id} item={item} />
                    ))}
                </div>
            )}
        </div>
    )

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Megaphone className="w-7 h-7 text-orange-600" />
                        Master Announcement Banner
                    </h1>
                    <p className="text-gray-600 mt-1">
                        Configure default banners for all consumer journeys
                    </p>
                </div>
                <Button onClick={handleSave} disabled={saving} size="lg">
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

            <Alert className="bg-blue-50 border-blue-200">
                <Info className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                    <strong>How it works:</strong> Configure banners for each page. Each section (Top/Bottom) can use Slider or Stacked display mode.
                    Individual journeys can override these settings with their own banners.
                </AlertDescription>
            </Alert>

            <Card>
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-xl ${masterConfig.banner_config.enabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                                {masterConfig.banner_config.enabled ? (
                                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                                ) : (
                                    <EyeOff className="w-6 h-6 text-gray-400" />
                                )}
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg">Master Banner System</h3>
                                <p className="text-sm text-gray-600">
                                    {masterConfig.banner_config.enabled
                                        ? 'Banners will display on consumer journeys without custom banners'
                                        : 'No banners will be displayed by default'}
                                </p>
                            </div>
                        </div>
                        <Switch
                            checked={masterConfig.banner_config.enabled}
                            onCheckedChange={(checked) => updateConfig({ enabled: checked })}
                        />
                    </div>
                </CardContent>
            </Card>

            {masterConfig.banner_config.enabled && (
                <Card>
                    <CardHeader className="pb-0">
                        <CardTitle className="flex items-center gap-2">
                            <Settings2 className="w-5 h-5" />
                            Banner Pages
                        </CardTitle>
                        <CardDescription>
                            Select a page to configure its banners
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-4">
                        <Tabs value={activeBannerTab} onValueChange={(v) => setActiveBannerTab(v as typeof activeBannerTab)}>
                            <TabsList className="grid w-full grid-cols-4 h-auto p-1">
                                {(['home', 'rewards', 'products', 'profile'] as const).map((page) => {
                                    const pageItems = masterConfig.banner_config.items.filter(i => (i.page || 'home') === page)
                                    const activeCount = pageItems.filter(i => i.is_active !== false).length
                                    return (
                                        <TabsTrigger
                                            key={page}
                                            value={page}
                                            className="flex flex-col gap-1 py-3 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                                        >
                                            <span className="text-lg">{pageLabels[page].icon}</span>
                                            <span className="font-medium">{pageLabels[page].name}</span>
                                            <div className="flex gap-1">
                                                <Badge variant="secondary" className="text-xs px-1.5">
                                                    {activeCount}/{pageItems.length}
                                                </Badge>
                                            </div>
                                        </TabsTrigger>
                                    )
                                })}
                            </TabsList>

                            {(['home', 'rewards', 'products', 'profile'] as const).map((page) => (
                                <TabsContent key={page} value={page} className="mt-6 space-y-8">
                                    <BannerSection
                                        title="Top Banners (Before Content)"
                                        placement="top"
                                        items={masterConfig.banner_config.items.filter(i =>
                                            (i.page || 'home') === page && i.placement !== 'bottom'
                                        )}
                                        template={getPageSettings(page).topTemplate}
                                        autoSlide={getPageSettings(page).topAutoSlide}
                                        slideInterval={getPageSettings(page).topSlideInterval}
                                    />

                                    <BannerSection
                                        title="Bottom Banners (After Content)"
                                        placement="bottom"
                                        items={masterConfig.banner_config.items.filter(i =>
                                            (i.page || 'home') === page && i.placement === 'bottom'
                                        )}
                                        template={getPageSettings(page).bottomTemplate}
                                        autoSlide={getPageSettings(page).bottomAutoSlide}
                                        slideInterval={getPageSettings(page).bottomSlideInterval}
                                    />
                                </TabsContent>
                            ))}
                        </Tabs>
                    </CardContent>
                </Card>
            )}

            <Card className="bg-gradient-to-r from-gray-50 to-white">
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-6">
                            <div className="text-center">
                                <div className="text-3xl font-bold text-blue-600">{masterConfig.banner_config.items.length}</div>
                                <div className="text-xs text-gray-500">Total Banners</div>
                            </div>
                            <div className="h-10 w-px bg-gray-200" />
                            {(['home', 'rewards', 'products', 'profile'] as const).map((page) => {
                                const count = masterConfig.banner_config.items.filter(i => (i.page || 'home') === page).length
                                return (
                                    <div key={page} className="text-center">
                                        <div className="text-xl font-semibold text-gray-700">{count}</div>
                                        <div className="text-xs text-gray-500">{pageLabels[page].name}</div>
                                    </div>
                                )
                            })}
                        </div>
                        <Badge className={masterConfig.banner_config.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
                            {masterConfig.banner_config.enabled ? (
                                <>
                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                    System Enabled
                                </>
                            ) : (
                                'System Disabled'
                            )}
                        </Badge>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
