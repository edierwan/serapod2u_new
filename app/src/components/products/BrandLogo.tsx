'use client'

import { Image as ImageIcon } from 'lucide-react'
import SafeImage from '@/components/shared/SafeImage'
import { resolveBrandLogoUrl } from '@/lib/brands/logo'

interface BrandLogoProps {
  name: string
  logoUrl: string | null | undefined
  className: string
  iconClassName?: string
}

export default function BrandLogo({ name, logoUrl, className, iconClassName }: BrandLogoProps) {
  const displayUrl = /^(blob:|data:)/i.test(String(logoUrl || '').trim())
    ? String(logoUrl).trim()
    : resolveBrandLogoUrl(logoUrl)

  return (
    <SafeImage
      src={displayUrl}
      alt={logoUrl ? `${name} logo` : `${name} brand placeholder`}
      className={className}
      fallbackClassName="bg-slate-50 text-slate-400"
      fallbackIcon={ImageIcon}
      fallbackIconClassName={iconClassName || 'h-5 w-5 text-slate-300'}
    />
  )
}
