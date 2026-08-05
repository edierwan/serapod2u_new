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

const tabs = [
  { href: '/serapp/conversation', label: 'Chat', icon: MessageCircle },
  { href: '/serapp/announcement', label: 'News', icon: Megaphone },
  { href: '/serapp/order', label: 'Order', icon: ClipboardList },
  { href: '/serapp/history', label: 'History', icon: History },
  { href: '/serapp/reports', label: 'Reports', icon: BarChart3 },
] as const

export default function SerappBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--sera-line)] bg-[var(--sera-surface)]/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Serapp primary"
    >
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex min-w-[56px] flex-col items-center gap-0.5 rounded-xl px-2 py-2 transition-colors',
                active
                  ? 'text-[var(--sera-orange)]'
                  : 'text-[var(--sera-muted)] hover:text-[var(--sera-ink)]',
              )}
            >
              <Icon className={cn('h-5 w-5', active && 'stroke-[2.5px]')} />
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
