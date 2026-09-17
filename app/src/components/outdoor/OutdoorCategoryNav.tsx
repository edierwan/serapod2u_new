'use client'

import Link from 'next/link'

export type OutdoorNavItem = {
  key: string
  label: string
  href: string
  icon: 'new' | 'chair' | 'tumbler' | 'mat'
}

const ICON_SRC: Record<OutdoorNavItem['icon'], string> = {
  new: '/outdoor/brand/icons/new-in.svg',
  chair: '/outdoor/brand/icons/chair.svg',
  tumbler: '/outdoor/brand/icons/tumbler.svg',
  mat: '/outdoor/brand/icons/mat.svg',
}

export default function OutdoorCategoryNav({ items }: { items: OutdoorNavItem[] }) {
  if (items.length === 0) return null

  return (
    <nav className="bg-[var(--out-cream)] px-3 pb-3 pt-4" aria-label="Collections">
      <div className="flex justify-center gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-8">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="flex w-[4.6rem] shrink-0 flex-col items-center text-center sm:w-24"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ICON_SRC[item.icon]} alt="" className="h-[4.35rem] w-[4.35rem] sm:h-24 sm:w-24" />
            <span className="mt-2 text-[11px] font-medium leading-snug text-[var(--out-bark)] sm:text-xs">
              {item.label}
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-3 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/outdoor/brand/icons/active-button.svg" alt="" className="h-3 w-auto" />
      </div>
    </nav>
  )
}
