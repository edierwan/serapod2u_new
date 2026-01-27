'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getStorageUrl } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import {
    Image as ImageIcon,
    Loader2,
    Eye,
    EyeOff,
    Trash2,
    ArrowUp,
    ArrowDown,
    LayoutGrid,
    Layers,
    Plus
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

// Types aligned with MasterAnnouncementBannerView
export interface BannerItem {
    id: string
    image_url: string
    link_to: 'rewards' | 'products' | 'contact-us' | 'no-link' | string
    expires_at: string
    page?: 'home' | 'rewards' | 'products' | 'profile'
    is_active?: boolean
    placement?: 'top' | 'bottom'
}

export interface PageBannerSettings {
    topTemplate: 'grid' | 'carousel'
    bottomTemplate: 'grid' | 'carousel'
    topAutoSlide?: boolean
    topSlideInterval?: number
    bottomAutoSlide?: boolean
    bottomSlideInterval?: number
}

export interface BannerConfig {
    enabled: boolean
    template?: 'grid' | 'carousel' // Legacy
    items: BannerItem[]
    placement?: 'top' | 'bottom'
    pageSettings?: {
        home?: PageBannerSettings
        rewards?: PageBannerSettings
        products?: PageBannerSettings
        profile?: PageBannerSettings
    }
}

interface AnnouncementBannerConfiguratorProps {
    config: BannerConfig
    onChange: (config: BannerConfig) => void
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
    home: 'Home',
    rewards: 'Rewards',
    products: 'Products',
    profile: 'Profile'
}

export default function AnnouncementBannerConfigurator({ config, onChange }: AnnouncementBannerConfiguratorProps) {
    const [activeTab, setActiveTab] = useState<'home' | 'rewards' | 'products' | 'profile'>('home')
    const [uploadingImage, setUploadingImage] = useState(false)
    const { toast } = useToast()
    const supabase = createClient()

    const updatePageSettings = (page: string, updates: Partial<PageBannerSettings>) => {
        const currentSettings = config.pageSettings?.[page as keyof typeof config.pageSettings] || defaultPageSettings
        onChange({
            ...config,
            pageSettings: {
                ...config.pageSettings,
                [page]: {
                    ...currentSettings,
                    ...updates
                }
            }
        })
    }

    const addBanner = (placement: 'top' | 'bottom') => {
        const newItems = [...(config.items || [])]
        newItems.push({
            id: crypto.randomUUID(),
            image_url: '',
            link_to: 'rewards',
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            page: activeTab,
            placement,
            is_active: true
        })
        onChange({ ...config, items: newItems })
    }

    const removeBanner = (id: string) => {
        const newItems = config.items.filter(i => i.id !== id)
        onChange({ ...config, items: newItems })
    }

    const updateBannerItem = (id: string, updates: Partial<BannerItem>) => {
        const newItems = config.items.map(item =>
            item.id === id ? { ...item, ...updates } : item
        )
        onChange({ ...config, items: newItems })
    }

    const handleImageUpload = async (file: File, callback: (url: string) => void) => {
        try {
            setUploadingImage(true)
            
            // 1. Upload file
            const fileExt = file.name.split('.').pop()
            const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`
            const filePath = `banners/${fileName}`

            const { error: uploadError } = await supabase.storage
                .from('public-assets')
                .upload(filePath, file)

            if (uploadError) throw uploadError

            // 2. Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('public-assets')
                .getPublicUrl(filePath)

            callback(publicUrl)
        } catch (error) {
            console.error('Error uploading image:', error)
            toast({
                title: 'Error',
                description: 'Failed to upload image',
                variant: 'destructive',
            })
        } finally {
            setUploadingImage(false)
        }
    }

    const BannerCard = ({ item }: { item: BannerItem }) => {
        const isActive = item.is_active !== false

        return (
            <div className={`group relative bg-white rounded-xl border-2 transition-all duration-200 ${
                isActive ? 'border-gray-200 hover:border-blue-300 hover:shadow-md' : 'border-gray-300 opacity-60'
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
                            value={['rewards', 'products', 'contact-us', 'no-link'].includes(item.link_to) ? item.link_to : 'external'}
                            onValueChange={(value: string) => {
                                updateBannerItem(item.id, { link_to: value === 'external' ? '' : value })
                            }}
                        >
                            <SelectTrigger className="text-sm">
                                <SelectValue placeholder="Link to..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="rewards">Rewards</SelectItem>
                                <SelectItem value="products">Products</SelectItem>
                                <SelectItem value="contact-us">Contact Us</SelectItem>
                                <SelectItem value="no-link">No Link</SelectItem>
                                <SelectItem value="external">External URL</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            type="date"
                            value={item.expires_at?.split('T')[0] || ''}
                            onChange={(e) => updateBannerItem(item.id, { expires_at: e.target.value })}
                            className="text-sm"
                        />
                    </div>

                    {!['rewards', 'products', 'contact-us', 'no-link'].includes(item.link_to) && (
                        <Input
                            value={item.link_to}
                            onChange={(e) => updateBannerItem(item.id, { link_to: e.target.value })}
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
                            onClick={() => updatePageSettings(activeTab, {
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
                            onClick={() => updatePageSettings(activeTab, {
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
                                onCheckedChange={(checked) => updatePageSettings(activeTab, {
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
                                    onChange={(e) => updatePageSettings(activeTab, {
                                        [placement === 'top' ? 'topSlideInterval' : 'bottomSlideInterval']: parseInt(e.target.value) || 5
                                    })}
                                    className="w-14 h-7 text-xs"
                                />
                            )}
                        </div>
                    )}

                    <Button
                        size="sm"
                        onClick={() => addBanner(placement)}
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Add
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.length === 0 ? (
                    <div className="col-span-full py-8 text-center text-gray-500 bg-gray-50 rounded-lg border border-dashed">
                        No banners configured for {title}
                    </div>
                ) : (
                    items.map(item => (
                        <BannerCard key={item.id} item={item} />
                    ))
                )}
            </div>
        </div>
    )

    const pageSettings = config.pageSettings?.[activeTab] || defaultPageSettings
    const pageItems = config.items?.filter(item => (item.page || 'home') === activeTab) || []
    const topBanners = pageItems.filter(item => item.placement === 'top' || !item.placement)
    const bottomBanners = pageItems.filter(item => item.placement === 'bottom')

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Label>Banner Pages</Label>
                <p className="text-sm text-gray-500">Select a page to configure its banners</p>
                <Tabs 
                    value={activeTab} 
                    onValueChange={(value) => setActiveTab(value as any)} 
                    className="w-full"
                >
                    <TabsList className="w-full h-auto p-2 grid grid-cols-4 gap-2 bg-gray-100/50">
                        {Object.entries(pageLabels).map(([key, label]) => {
                            const count = config.items?.filter(i => (i.page || 'home') === key).length || 0
                            return (
                                <TabsTrigger 
                                    key={key} 
                                    value={key}
                                    className="data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-600 py-3"
                                >
                                    <div className="flex flex-col items-center gap-1">
                                        <span className="font-medium">{label}</span>
                                        <Badge variant="secondary" className="text-[10px] h-5 px-2 bg-gray-200">
                                            {count}/5
                                        </Badge>
                                    </div>
                                </TabsTrigger>
                            )
                        })}
                    </TabsList>
                </Tabs>
            </div>

            <BannerSection
                title="Top Banners (Before Content)"
                placement="top"
                items={topBanners}
                template={pageSettings.topTemplate}
                autoSlide={pageSettings.topAutoSlide}
                slideInterval={pageSettings.topSlideInterval}
            />

            <BannerSection
                title="Bottom Banners (After Content)"
                placement="bottom"
                items={bottomBanners}
                template={pageSettings.bottomTemplate}
                autoSlide={pageSettings.bottomAutoSlide}
                slideInterval={pageSettings.bottomSlideInterval}
            />
        </div>
    )
}
