'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Home, Clock, CalendarDays, FileText, User } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ─── Tab definitions (max 5) ─────────────────────────────────────── */

const tabs = [
  { href: '/hr/mobile/home', label: 'Home', icon: Home },
  { href: '/hr/mobile/attendance', label: 'Attendance', icon: Clock },
  { href: '/hr/mobile/leave', label: 'Leave', icon: CalendarDays },
  { href: '/hr/mobile/payslip', label: 'Payslip', icon: FileText },
  { href: '/hr/mobile/profile', label: 'Profile', icon: User },
] as const

/* ─── Component ───────────────────────────────────────────────────── */

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors min-w-[56px]',
                active
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className={cn('h-5 w-5', active && 'stroke-[2.5px]')} />
              <span
                className={cn(
                  'text-[10px] leading-none',
                  active ? 'font-semibold' : 'font-medium',
                )}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
