import React, { useState, useMemo } from 'react'
import { Package } from 'lucide-react'
import { getStorageUrl } from '@/lib/utils'

interface ProductThumbnailProps {
  src?: string | null
  alt?: string
  size?: number // px
  className?: string
}

/**
 * Compact product thumbnail used inside Movement History rows.
 * - Fixed size box (default 36px)
 * - Centers content and uses object-contain (no cropping)
 * - Neutral background and rounded corners
 * - Automatically converts storage URLs to current environment
 */
export default function ProductThumbnail({ src, alt = 'Product image', size = 36, className = '' }: ProductThumbnailProps) {
  const [loaded, setLoaded] = useState<boolean>(!!src)
  
  // Convert storage URL to current environment
  const dynamicSrc = useMemo(() => {
    return src ? (getStorageUrl(src) || src) : null
  }, [src])

  const containerStyle = {
    width: `${size}px`,
    height: `${size}px`
  }

  return (
    <div
      style={containerStyle}
      className={`relative rounded-md overflow-hidden flex-shrink-0 bg-gray-100 flex items-center justify-center ${className}`}
      aria-hidden={dynamicSrc ? undefined : 'true'}
    >
      {dynamicSrc && loaded ? (
        // use img with object-contain to keep whole image visible
        <img
          src={dynamicSrc}
          alt={alt}
          className="max-w-full max-h-full object-contain"
          onError={() => setLoaded(false)}
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full text-gray-400">
          <Package className="w-4 h-4" />
        </div>
      )}
    </div>
  )
}
