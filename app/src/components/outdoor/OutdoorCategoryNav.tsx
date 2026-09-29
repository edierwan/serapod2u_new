'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

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

function Dots() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/outdoor/brand/icons/active-button.svg" alt="" className="h-3 w-auto" />
  )
}

function activeIndex(items: OutdoorNavItem[], pathname: string, collection: string | null) {
  return items.findIndex((item) => {
    if (pathname === '/outdoor/shop' && collection) return item.key === collection
    return item.href.startsWith('/outdoor/shop/') && pathname === item.href
  })
}

function CategoryRow({ items, active }: { items: OutdoorNavItem[]; active: number }) {
  return (
    <nav className="bg-[var(--out-cream)] px-3 pb-3 pt-4" aria-label="Collections">
      <div className="mx-auto w-max max-w-full">
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
        <div
          className="mt-3 grid gap-4 sm:gap-8"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {active < 0 ? (
            <div className="col-span-full flex justify-center">
              <Dots />
            </div>
          ) : items.map((item, index) => (
            <div key={item.key} className="flex justify-center">
              {index === active ? <Dots /> : <span className="h-3" aria-hidden />}
            </div>
          ))}
        </div>
      </div>
    </nav>
  )
}

function CategoryNavLive({ items }: { items: OutdoorNavItem[] }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const active = activeIndex(items, pathname, searchParams.get('collection'))
  return <CategoryRow items={items} active={active} />
}

export default function OutdoorCategoryNav({ items }: { items: OutdoorNavItem[] }) {
  if (items.length === 0) return null
  return (
    <Suspense fallback={<CategoryRow items={items} active={-1} />}>
      <CategoryNavLive items={items} />
    </Suspense>
  )
}
