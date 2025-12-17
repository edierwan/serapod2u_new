'use client'

import React, { useMemo } from 'react'
import { getStorageUrl, isSupabaseStorageUrl } from '@/lib/utils'

interface DynamicImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null
  fallbackSrc?: string
  /** If true, will attempt to convert Supabase storage URLs to current environment */
  dynamicStorage?: boolean
}

/**
 * Image component that automatically handles Supabase storage URL conversion.
 * Use this instead of <img> for any images that might be stored in Supabase storage.
 * 
 * When migrating between Supabase instances, this component ensures images
 * are loaded from the correct environment's storage automatically.
 * 
 * Usage:
 * ```tsx
 * <DynamicImage src={item.image_url} alt="Product" />
 * ```
 */
export default function DynamicImage({ 
  src, 
  fallbackSrc,
  dynamicStorage = true,
  alt = '',
  ...props 
}: DynamicImageProps) {
  const dynamicSrc = useMemo(() => {
    if (!src) return fallbackSrc || undefined
    
    // Only convert if it's a Supabase storage URL
    if (dynamicStorage && isSupabaseStorageUrl(src)) {
      return getStorageUrl(src) || src
    }
    
    return src
  }, [src, fallbackSrc, dynamicStorage])

  if (!dynamicSrc) {
    return null
  }

  return <img src={dynamicSrc} alt={alt} {...props} />
}

/**
 * Hook to get a dynamic storage URL for use in custom image implementations
 */
export function useDynamicImageSrc(src: string | null | undefined): string | null {
  return useMemo(() => {
    if (!src) return null
    if (isSupabaseStorageUrl(src)) {
      return getStorageUrl(src) || src
    }
    return src
  }, [src])
}
