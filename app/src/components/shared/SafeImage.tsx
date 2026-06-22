'use client'

/**
 * SafeImage — a defensive <img> wrapper that prevents broken image icons.
 *
 * - Rewrites storage paths via `getStorageUrl()` so seed data pointing at an
 *   old Supabase project is resolved to the current instance.
 * - Tracks load errors in local state and swaps to a clean fallback
 *   (gray rounded box with an icon) when the URL is missing or fails to load.
 *
 * Usage:
 *   <SafeImage src={product.image_url} alt={product.product_name} className="h-10 w-10 object-contain" />
 */

import { useState, type ImgHTMLAttributes } from 'react'
import { Package, type LucideIcon } from 'lucide-react'
import { getStorageUrl } from '@/lib/utils'

export interface SafeImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
    /** Raw image URL or storage path. `null`/`undefined`/empty → fallback. */
    src: string | null | undefined
    /** Alt text for the image. */
    alt?: string
    /** Tailwind classes applied to the <img> when present. */
    className?: string
    /** Tailwind classes applied to the fallback wrapper. Defaults to a neutral gray box. */
    fallbackClassName?: string
    /** Icon shown in the fallback. Defaults to `Package`. */
    fallbackIcon?: LucideIcon
    /** Tailwind classes applied to the fallback icon. */
    fallbackIconClassName?: string
}

export default function SafeImage({
    src,
    alt = '',
    className,
    fallbackClassName = 'bg-slate-50',
    fallbackIcon: FallbackIcon = Package,
    fallbackIconClassName = 'h-4 w-4 text-slate-300',
    ...imgProps
}: SafeImageProps) {
    const [failed, setFailed] = useState(false)

    const resolved = getStorageUrl(src) || (src ? String(src).trim() : '')
    const showImage = resolved && !failed

    if (!showImage) {
        return (
            <div
                className={`flex items-center justify-center overflow-hidden ${fallbackClassName} ${className ?? ''}`}
                role="img"
                aria-label={alt || 'Image unavailable'}
            >
                <FallbackIcon className={fallbackIconClassName} />
            </div>
        )
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={resolved}
            alt={alt}
            className={className}
            onError={() => setFailed(true)}
            {...imgProps}
        />
    )
}