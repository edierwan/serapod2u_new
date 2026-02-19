'use client'

import { useState } from 'react'
import StoreBannerManagerView from './StoreBannerManagerView'
import LoginHeroBannerManagerView from './LoginHeroBannerManagerView'

// ── Types ─────────────────────────────────────────────────────────

type BannerTab = 'landing' | 'login'

interface HeroBannersUnifiedViewProps {
  userProfile: any
  onViewChange: (view: string) => void
  initialTab?: BannerTab
}

// ── Tab styles ────────────────────────────────────────────────────

const TAB_CONFIG: { key: BannerTab; label: string; description: string }[] = [
  { key: 'landing', label: 'Landing Hero Banner', description: 'Storefront homepage hero slider' },
  { key: 'login', label: 'Login Hero Banner', description: 'Login page hero banners' },
]

// ── Component ─────────────────────────────────────────────────────

export default function HeroBannersUnifiedView({
  userProfile,
  onViewChange,
  initialTab = 'landing',
}: HeroBannersUnifiedViewProps) {
  const [activeTab, setActiveTab] = useState<BannerTab>(initialTab)

  return (
    <div className="space-y-0">
      {/* Tabs — sits above the child view's own header */}
      <div className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <nav className="flex gap-0 px-4 sm:px-6" aria-label="Banner type tabs">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`
                relative px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap
                ${activeTab === tab.key
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700 border-b-2 border-transparent hover:border-gray-300'
                }
              `}
              title={tab.description}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Active tab content */}
      {activeTab === 'landing' ? (
        <StoreBannerManagerView
          userProfile={userProfile}
          onViewChange={onViewChange}
        />
      ) : (
        <LoginHeroBannerManagerView
          userProfile={userProfile}
          onViewChange={onViewChange}
        />
      )}
    </div>
  )
}
