'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  MessageCircle,
  Megaphone,
  ClipboardList,
  History,
  BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSerapp } from './SerappContext'

const tabs = [
  { href: '/serapp/conversation', label: 'Chat', icon: MessageCircle, badgeKey: 'chat' as const },
  { href: '/serapp/announcement', label: 'News', icon: Megaphone, badgeKey: null },
  { href: '/serapp/order', label: 'Order', icon: ClipboardList, badgeKey: null },
  { href: '/serapp/history', label: 'History', icon: History, badgeKey: null },
  { href: '/serapp/reports', label: 'Reports', icon: BarChart3, badgeKey: null },
] as const

const distributorTabs = tabs.filter(
  (tab) => tab.href === '/serapp/conversation' || tab.href === '/serapp/order' || tab.href === '/serapp/history',
)

export default function SerappBottomNav() {
  const pathname = usePathname()
  const { totalUnread, isDistributor } = useSerapp()
  const isThread = Boolean(pathname?.match(/^\/serapp\/conversation\/[^/]+$/))
  if (isThread) return null
  const visibleTabs = isDistributor ? distributorTabs : tabs

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--sera-line)] bg-[var(--sera-surface)]/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Serapp primary"
    >
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around">
        {visibleTabs.map(({ href, label, icon: Icon, badgeKey }) => {
          const active = pathname === href || pathname?.startsWith(`${href}/`)
          const showBadge = badgeKey === 'chat' && totalUnread > 0
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex min-w-[56px] flex-col items-center gap-0.5 rounded-xl px-2 py-2 transition-colors',
                active
                  ? 'text-[var(--sera-orange)]'
                  : 'text-[var(--sera-muted)] hover:text-[var(--sera-ink)]',
              )}
            >
              <span className="relative">
                <Icon className={cn('h-5 w-5', active && 'stroke-[2.5px]')} />
                {showBadge && (
                  <span className="absolute -right-2.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--sera-orange)] px-1 text-[9px] font-bold text-white">
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </span>
                )}
              </span>
              <span className={cn('text-[10px] leading-none', active ? 'font-semibold' : 'font-medium')}>
                {label}
              </span>
              {active && (
                <span className="mt-0.5 h-0.5 w-4 rounded-full bg-[var(--sera-orange)]" aria-hidden />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
