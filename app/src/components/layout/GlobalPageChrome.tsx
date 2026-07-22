'use client'

import { format } from 'date-fns'
import {
  BarChart3,
  Bell,
  Building2,
  ChevronRight,
  Database,
  Package,
  TrendingUp,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'

interface GlobalPageChromeProps {
  currentView: string
  orgName?: string | null
}

interface ChromeContext {
  section: string
  icon: LucideIcon
  crumbs: string[]
}

const SEGMENT_LABELS: Record<string, string> = {
  providers: 'Providers',
  types: 'Notification Types',
  'whatsapp-activity-recovery': 'WhatsApp Recovery',
  'whatsapp-activity': 'WhatsApp Activity',
  'delivery-logs': 'Delivery Logs',
  failed: 'Failed Messages',
  organizations: 'Organizations',
  distributors: 'Distributors',
  migration: 'Migration',
  'track-order': 'Track Order',
  'my-profile': 'My Profile',
  users: 'User Management',
  products: 'Products',
  orders: 'Orders',
  inventory: 'Inventory',
}

function titleCaseSegment(segment: string) {
  return segment
    .split(/[-_/]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function resolveChromeContext(view: string): ChromeContext {
  const id = view || 'dashboard'

  if (id === 'dashboard') {
    return { section: 'Dashboard', icon: BarChart3, crumbs: [] }
  }

  if (id === 'reporting') {
    return { section: 'Reporting', icon: TrendingUp, crumbs: [] }
  }

  if (id === 'notifications' || id.startsWith('notifications/')) {
    const tail = id === 'notifications' ? [] : id.replace(/^notifications\/?/, '').split('/').filter(Boolean)
    const crumbs = tail.map((segment) => SEGMENT_LABELS[segment] ?? titleCaseSegment(segment))
    return { section: 'Notifications', icon: Bell, crumbs }
  }

  if (id === 'my-profile') {
    return { section: 'Account', icon: User, crumbs: ['My Profile'] }
  }

  if (id === 'users') {
    return { section: 'Administration', icon: Users, crumbs: ['User Management'] }
  }

  if (id.startsWith('organizations')) {
    const tail = id === 'organizations' ? [] : id.replace(/^organizations\/?/, '').split('/').filter(Boolean)
    return {
      section: 'Administration',
      icon: Building2,
      crumbs: ['Organizations', ...tail.map((s) => SEGMENT_LABELS[s] ?? titleCaseSegment(s))].filter(Boolean),
    }
  }

  if (id === 'migration') {
    return { section: 'Administration', icon: Database, crumbs: ['Migration'] }
  }

  if (id === 'track-order') {
    return { section: 'Supply Chain', icon: Package, crumbs: ['Track Order'] }
  }

  const root = id.split('/')[0]
  const rootLabel = SEGMENT_LABELS[root] ?? titleCaseSegment(root)
  const tail = id.includes('/') ? id.split('/').slice(1) : []
  const crumbs = tail.map((segment) => SEGMENT_LABELS[segment] ?? titleCaseSegment(segment))

  return { section: rootLabel, icon: BarChart3, crumbs }
}

/** Light context bar for pages without a module top-nav — fills the chrome slot with useful context */
export default function GlobalPageChrome({ currentView, orgName }: GlobalPageChromeProps) {
  const ctx = resolveChromeContext(currentView)
  const Icon = ctx.icon
  const today = format(new Date(), 'EEE, d MMM yyyy')

  return (
    <div className="sera-global-chrome bg-white border-b border-[var(--sera-line)] print:hidden">
      <div className="sera-top-nav__inner justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 pl-10 lg:pl-0">
          <div className="flex items-center gap-1.5 shrink-0 rounded-md bg-[var(--sera-orange)]/10 px-2.5 py-0.5 text-sm font-semibold text-[var(--sera-orange-deep)]">
            <Icon className="h-3 w-3" strokeWidth={1.75} />
            <span>{ctx.section}</span>
          </div>
          {ctx.crumbs.length > 0 && (
            <div className="flex items-center gap-1 min-w-0 text-xs text-[var(--sera-muted)]">
              {ctx.crumbs.map((crumb) => (
                <span key={crumb} className="flex items-center gap-1 min-w-0">
                  <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
                  <span className="truncate">{crumb}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-3 shrink-0 text-xs text-[var(--sera-muted)]">
          {orgName ? (
            <span className="max-w-[180px] truncate font-medium text-[var(--sera-ink-soft,#2a2622)]">
              {orgName}
            </span>
          ) : null}
          <time dateTime={format(new Date(), 'yyyy-MM-dd')} className="tabular-nums whitespace-nowrap">
            {today}
          </time>
        </div>
      </div>
    </div>
  )
}
