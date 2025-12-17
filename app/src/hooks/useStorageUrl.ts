'use client'

import { useMemo } from 'react'
import { getStorageUrl, extractStoragePath, isSupabaseStorageUrl } from '@/lib/utils'

/**
 * Hook to convert storage URLs to the current environment's Supabase instance
 * This ensures images work correctly when migrating between Supabase instances
 * 
 * Usage:
 * ```tsx
 * const { getUrl } = useStorageUrl()
 * <img src={getUrl(item.image_url)} />
 * ```
 */
export function useStorageUrl() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  /**
   * Convert a storage URL or path to the current environment's URL
   */
  const getUrl = useMemo(() => {
    return (pathOrUrl: string | null | undefined, bucket?: string): string | null => {
      return getStorageUrl(pathOrUrl, bucket)
    }
  }, [supabaseUrl])

  /**
   * Extract just the relative path from a full URL
   */
  const extractPath = useMemo(() => {
    return (fullUrl: string | null | undefined): string | null => {
      return extractStoragePath(fullUrl)
    }
  }, [])

  /**
   * Check if URL is a Supabase storage URL
   */
  const isStorageUrl = useMemo(() => {
    return (url: string | null | undefined): boolean => {
      return isSupabaseStorageUrl(url)
    }
  }, [])

  return {
    getUrl,
    extractPath,
    isStorageUrl,
    supabaseUrl
  }
}

/**
 * Simple function version for use outside React components
 * Re-exported from utils for convenience
 */
export { getStorageUrl, extractStoragePath, isSupabaseStorageUrl }
