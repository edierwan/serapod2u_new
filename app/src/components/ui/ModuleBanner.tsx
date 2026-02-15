'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '@/components/providers/ThemeProvider'
import { cn } from '@/lib/utils'
import {
  BarChart3,
  Truck,
  UsersRound,
  Briefcase,
  Calculator,
  Settings,
  type LucideIcon,
} from 'lucide-react'

// ── Module definitions ───────────────────────────────────────────

type ModuleId = 'dashboard' | 'supply' | 'customer' | 'hr' | 'finance' | 'settings'

interface ModuleConfig {
  icon: LucideIcon
  label: string
  /** Whether banner shows greeting (Good Morning) + firstName, or static title + subtitle */
  useGreeting: boolean
  /** Static title displayed when useGreeting is false */
  staticTitle?: string
  /** Static subtitle displayed when useGreeting is false */
  staticSubtitle?: string
}

const MODULE_CONFIG: Record<ModuleId, ModuleConfig> = {
  dashboard: {
    icon: BarChart3,
    label: 'Dashboard Overview',
    useGreeting: false,
    staticTitle: 'Dashboard',
    staticSubtitle: 'Overview and analytics for your organization',
  },
  supply: {
    icon: Truck,
    label: 'Supply Chain Module',
    useGreeting: false,
    staticTitle: 'SUPPLY CHAIN',
    staticSubtitle: 'Manage products, orders, QR traceability, and inventory movements.',
  },
  customer: {
    icon: UsersRound,
    label: 'Customer & Growth Module',
    useGreeting: false,
    staticTitle: 'CUSTOMER & GROWTH',
    staticSubtitle: 'Manage customer engagement, marketing campaigns, loyalty programs, and product catalog.',
  },
  hr: {
    icon: Briefcase,
    label: 'Human Resources',
    useGreeting: true,
  },
  finance: {
    icon: Calculator,
    label: 'Finance & Accounting',
    useGreeting: true,
  },
  settings: {
    icon: Settings,
    label: 'Settings',
    useGreeting: true,
  },
}

// ── Color tokens per module (dull, professional, enterprise) ─────

const BANNER_GRADIENTS: Record<'light' | 'dark', Record<ModuleId, string>> = {
  light: {
    dashboard: 'linear-gradient(135deg, #1F2A44, #2F3F66)',
    supply:    'linear-gradient(135deg, #8B5E1A, #C48A2E)',
    customer:  'linear-gradient(135deg, #1E6F5C, #2E8B78)',
    hr:        'linear-gradient(135deg, #2F4FA2, #4F6EDB)',
    finance:   'linear-gradient(135deg, #1B7A57, #2FAF7C)',
    settings:  'linear-gradient(135deg, #3E4655, #5B6678)',
  },
  dark: {
    dashboard: 'linear-gradient(135deg, #131A2C, #1E2842)',
    supply:    'linear-gradient(135deg, #5A3B10, #7A5A1E)',
    customer:  'linear-gradient(135deg, #12493D, #1A6656)',
    hr:        'linear-gradient(135deg, #1E3370, #2E4AA0)',
    finance:   'linear-gradient(135deg, #145C43, #1C7A5B)',
    settings:  'linear-gradient(135deg, #252C36, #394150)',
  },
}

// ── Greeting helper ──────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'Good Morning'
  if (hour >= 12 && hour < 18) return 'Good Afternoon'
  return 'Good Evening'
}

// ── Component ────────────────────────────────────────────────────

interface ModuleBannerProps {
  /** Which module banner to render */
  module: ModuleId
  /** Override title (optional) */
  title?: string
  /** Override subtitle (optional) */
  subtitle?: string
  /** User name for greeting banners */
  userName?: string | null
  /** Custom banner image URL – takes precedence over gradient */
  bannerImageUrl?: string | null
  /** Additional className */
  className?: string
}

export default function ModuleBanner({
  module,
  title,
  subtitle,
  userName,
  bannerImageUrl,
  className,
}: ModuleBannerProps) {
  const { resolvedTheme } = useTheme()
  const config = MODULE_CONFIG[module]
  const Icon = config.icon

  // Hydration-safe greeting
  const [greeting, setGreeting] = useState('Welcome')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setGreeting(getGreeting())
    const interval = setInterval(() => setGreeting(getGreeting()), 60_000)
    return () => clearInterval(interval)
  }, [])

  const firstName = useMemo(() => {
    if (!userName) return 'User'
    return userName.trim().split(' ')[0]
  }, [userName])

  // Resolve gradient for current theme
  const themeKey = resolvedTheme === 'dark' ? 'dark' : 'light'
  const gradient = BANNER_GRADIENTS[themeKey][module]

  // Final display values
  const displayTitle = title ?? (config.useGreeting ? (mounted ? greeting : 'Welcome') : config.staticTitle!)
  const displaySubtitle = subtitle ?? (config.useGreeting ? firstName : config.staticSubtitle!)

  return (
    <div
      className={cn(
        'module-banner relative w-full rounded-xl overflow-hidden mb-6',
        className
      )}
      style={{ minHeight: 160 }}
    >
      {/* Background layer */}
      {bannerImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bannerImageUrl}
          alt={`${config.label} Banner`}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div
          className="absolute inset-0 banner-gradient-animated"
          style={{ background: gradient, backgroundSize: '200% 200%' }}
        />
      )}

      {/* Overlay gradient for text readability */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/20 to-transparent" />

      {/* Subtle inner shadow for depth */}
      <div className="absolute inset-0 shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]" />

      {/* Abstract radial overlay — soft, blended */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 80% 40%, rgba(255,255,255,0.12), transparent 60%)',
          opacity: 0.15,
          mixBlendMode: 'overlay',
          maskImage: 'linear-gradient(to left, black 30%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to left, black 30%, transparent 100%)',
        }}
      />

      {/* Decorative circles — very subtle */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -right-10 -top-10 w-64 h-64 bg-white/[0.04] rounded-full" />
        <div className="absolute right-20 bottom-0 w-40 h-40 bg-white/[0.04] rounded-full" />
        <div className="absolute left-1/2 -bottom-6 w-32 h-32 bg-white/[0.04] rounded-full" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col justify-center px-6 md:px-8 py-8 md:py-10 h-[160px] md:h-[200px]">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-white/15 backdrop-blur-sm">
            <Icon className="h-5 w-5 text-white" />
          </div>
          <span className="text-white/80 text-sm font-medium tracking-wide uppercase">
            {config.label}
          </span>
        </div>

        {config.useGreeting ? (
          <>
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-tight drop-shadow-sm">
              {displayTitle}
            </h1>
            <p className="text-lg md:text-xl text-white/90 font-medium mt-1 drop-shadow-sm">
              {displaySubtitle}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-tight drop-shadow-sm">
              {displayTitle}
            </h1>
            <p className="text-sm md:text-base text-white/90 font-medium mt-1 drop-shadow-sm">
              {displaySubtitle}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
