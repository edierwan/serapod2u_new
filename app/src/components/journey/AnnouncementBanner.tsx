"use client"

import Image from "next/image"
import { useState, useRef, useCallback } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { X, ZoomIn, ZoomOut, Move } from "lucide-react"

// Standard aspect ratio for banners: 16:9 for optimal mobile display
export const BANNER_ASPECT_RATIO = 16 / 9
export const BANNER_MIN_WIDTH = 800 // Minimum recommended width
export const BANNER_TARGET_WIDTH = 1080 // Target width for 2x retina
export const BANNER_TARGET_HEIGHT = Math.round(BANNER_TARGET_WIDTH / BANNER_ASPECT_RATIO) // ~608px

interface BannerItem {
    id: string
    image_url: string
    cropped_image_url?: string  // Optimized cropped version
    link_to?: 'rewards' | 'products' | string
    expires_at?: string
    page?: 'home' | 'rewards' | 'products' | 'profile'  // Which page to display the banner on
    is_active?: boolean  // Whether this banner is active (defaults to true)
    crop_data?: {
        x: number
        y: number
        zoom: number
    }
}

interface AnnouncementBannerProps {
    items: BannerItem[]
    template: 'grid' | 'carousel'
    onItemClick?: (item: BannerItem) => void
    className?: string
}

/**
 * Reusable Announcement Banner Component
 * 
 * Features:
 * - Fixed 16:9 aspect ratio for consistent display
 * - Object-fit: cover with proper image sizing
 * - Tap to expand lightbox for full image viewing
 * - Optimized for mobile display (375-414px width phones)
 */
export function AnnouncementBanner({ 
    items, 
    template, 
    onItemClick,
    className = ""
}: AnnouncementBannerProps) {
    const [lightboxOpen, setLightboxOpen] = useState(false)
    const [lightboxImage, setLightboxImage] = useState<string>("")

    // Filter out expired and inactive items
    const activeItems = items.filter(
        item => item.image_url && 
                item.is_active !== false && // defaults to true if not set
                (!item.expires_at || new Date(item.expires_at) > new Date())
    )

    if (activeItems.length === 0) return null

    const handleBannerClick = (item: BannerItem, e: React.MouseEvent) => {
        // If there's a link, follow it
        if (item.link_to) {
            if (onItemClick) {
                onItemClick(item)
            } else if (item.link_to.startsWith('http')) {
                window.open(item.link_to, '_blank')
            }
        } else {
            // No link - open lightbox for full image view
            const imageUrl = item.cropped_image_url || item.image_url
            setLightboxImage(imageUrl)
            setLightboxOpen(true)
        }
    }

    const handleLongPress = (item: BannerItem) => {
        // Always allow long-press to view full image
        const imageUrl = item.cropped_image_url || item.image_url
        setLightboxImage(imageUrl)
        setLightboxOpen(true)
    }

    return (
        <>
            <div className={`w-full ${className}`}>
                {template === 'grid' ? (
                    <div className="grid grid-cols-1 gap-3">
                        {activeItems.map((item) => (
                            <BannerImage 
                                key={item.id} 
                                item={item}
                                onClick={(e) => handleBannerClick(item, e)}
                                onLongPress={() => handleLongPress(item)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="flex overflow-x-auto gap-3 pb-2 snap-x scrollbar-hide -mx-5 px-5">
                        {activeItems.map((item) => (
                            <div key={item.id} className="min-w-[85%] snap-center flex-shrink-0">
                                <BannerImage 
                                    item={item}
                                    onClick={(e) => handleBannerClick(item, e)}
                                    onLongPress={() => handleLongPress(item)}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Lightbox Modal for full image view */}
            <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
                <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 border-none bg-black/90">
                    <DialogTitle className="sr-only">Full Image View</DialogTitle>
                    <button
                        onClick={() => setLightboxOpen(false)}
                        className="absolute top-2 right-2 z-10 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                    <div className="relative w-full h-full flex items-center justify-center p-4">
                        {lightboxImage && (
                            <Image
                                src={lightboxImage}
                                alt="Full banner view"
                                width={1200}
                                height={800}
                                className="max-w-full max-h-[85vh] object-contain"
                                priority
                            />
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}

interface BannerImageProps {
    item: BannerItem
    onClick: (e: React.MouseEvent) => void
    onLongPress: () => void
}

function BannerImage({ item, onClick, onLongPress }: BannerImageProps) {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const [isPressed, setIsPressed] = useState(false)

    const handleTouchStart = () => {
        setIsPressed(true)
        timeoutRef.current = setTimeout(() => {
            onLongPress()
        }, 500) // 500ms for long press
    }

    const handleTouchEnd = () => {
        setIsPressed(false)
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
            timeoutRef.current = null
        }
    }

    // Use cropped version if available, otherwise use original
    const imageUrl = item.cropped_image_url || item.image_url

    return (
        <div 
            className={`relative w-full rounded-xl overflow-hidden shadow-sm cursor-pointer transition-transform ${
                isPressed ? 'scale-[0.98]' : 'hover:shadow-md'
            } ${item.link_to ? '' : ''}`}
            onClick={onClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onMouseDown={handleTouchStart}
            onMouseUp={handleTouchEnd}
            onMouseLeave={handleTouchEnd}
        >
            <Image 
                src={imageUrl} 
                alt="Promotional banner" 
                width={0}
                height={0}
                sizes="(max-width: 768px) 100vw, 50vw"
                className="w-full h-auto"
                priority
            />
            {/* Subtle indicator that image is clickable */}
            {!item.link_to && (
                <div className="absolute bottom-2 right-2 bg-black/40 text-white px-2 py-1 rounded-full text-xs flex items-center gap-1 opacity-0 hover:opacity-100 transition-opacity">
                    <ZoomIn className="w-3 h-3" />
                    <span>Tap to expand</span>
                </div>
            )}
        </div>
    )
}

/**
 * Banner Image Cropper Component for Admin
 * Allows admins to select the visible portion of the image
 */
interface BannerCropperProps {
    imageUrl: string
    cropData?: { x: number; y: number; zoom: number }
    onChange: (cropData: { x: number; y: number; zoom: number }) => void
    onWarning?: (message: string) => void
}

export function BannerCropper({ 
    imageUrl, 
    cropData = { x: 50, y: 50, zoom: 1 },
    onChange,
    onWarning
}: BannerCropperProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
    const [imageLoaded, setImageLoaded] = useState(false)
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget
        setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight })
        setImageLoaded(true)

        // Check if image resolution is too low
        if (img.naturalWidth < BANNER_MIN_WIDTH && onWarning) {
            onWarning(`Image might be blurry on mobile. Recommended minimum width is ${BANNER_MIN_WIDTH}px. Current: ${img.naturalWidth}px`)
        }
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault()
        setIsDragging(true)
        setDragStart({ x: e.clientX, y: e.clientY })
    }

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging || !containerRef.current) return
        
        const rect = containerRef.current.getBoundingClientRect()
        const dx = ((e.clientX - dragStart.x) / rect.width) * 100
        const dy = ((e.clientY - dragStart.y) / rect.height) * 100
        
        const newX = Math.max(0, Math.min(100, cropData.x - dx))
        const newY = Math.max(0, Math.min(100, cropData.y - dy))
        
        onChange({ ...cropData, x: newX, y: newY })
        setDragStart({ x: e.clientX, y: e.clientY })
    }, [isDragging, dragStart, cropData, onChange])

    const handleMouseUp = useCallback(() => {
        setIsDragging(false)
    }, [])

    const handleZoom = (delta: number) => {
        const newZoom = Math.max(1, Math.min(3, cropData.zoom + delta))
        onChange({ ...cropData, zoom: newZoom })
    }

    // Add event listeners for drag
    useState(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove)
            window.addEventListener('mouseup', handleMouseUp)
            return () => {
                window.removeEventListener('mousemove', handleMouseMove)
                window.removeEventListener('mouseup', handleMouseUp)
            }
        }
    })

    return (
        <div className="space-y-4">
            {/* Preview Frame - Simulates mobile banner display */}
            <div className="bg-gray-100 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-2 text-center">Preview (~375px mobile width)</p>
                <div 
                    ref={containerRef}
                    className="relative w-full max-w-[375px] mx-auto rounded-lg overflow-hidden cursor-move select-none"
                    style={{ aspectRatio: '16/9' }}
                    onMouseDown={handleMouseDown}
                >
                    <div 
                        className="absolute inset-0"
                        style={{
                            backgroundImage: `url(${imageUrl})`,
                            backgroundSize: `${100 * cropData.zoom}%`,
                            backgroundPosition: `${cropData.x}% ${cropData.y}%`,
                            backgroundRepeat: 'no-repeat'
                        }}
                    />
                    {/* Drag indicator */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className={`bg-black/40 text-white px-3 py-2 rounded-lg flex items-center gap-2 transition-opacity ${isDragging ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
                            <Move className="w-4 h-4" />
                            <span className="text-sm">Drag to reposition</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center justify-center gap-4">
                <button
                    onClick={() => handleZoom(-0.25)}
                    disabled={cropData.zoom <= 1}
                    className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ZoomOut className="w-5 h-5" />
                </button>
                <span className="text-sm text-gray-600 min-w-[60px] text-center">
                    {Math.round(cropData.zoom * 100)}%
                </span>
                <button
                    onClick={() => handleZoom(0.25)}
                    disabled={cropData.zoom >= 3}
                    className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ZoomIn className="w-5 h-5" />
                </button>
            </div>

            {/* Image Info */}
            {imageLoaded && (
                <div className="text-xs text-center text-gray-500">
                    Original: {imageDimensions.width} × {imageDimensions.height}px
                    {imageDimensions.width < BANNER_MIN_WIDTH && (
                        <span className="text-amber-600 block mt-1">
                            ⚠️ Low resolution - may appear blurry
                        </span>
                    )}
                </div>
            )}

            {/* Hidden image for dimension detection */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
                src={imageUrl} 
                alt="" 
                className="hidden" 
                onLoad={handleImageLoad}
            />
        </div>
    )
}

export default AnnouncementBanner
