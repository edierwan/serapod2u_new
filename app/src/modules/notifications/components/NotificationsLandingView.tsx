'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight, Bell, MessageSquare, Megaphone, AlertTriangle, ListChecks } from 'lucide-react'

interface NotificationsCardItem {
  id: string
  label: string
  description: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  accent: { bg: string; text: string; hoverBorder: string }
}

const notificationCards: NotificationsCardItem[] = [
  {
    id: 'whatsapp-activity',
    label: 'WhatsApp Activity',
    description: 'Monitor WhatsApp notification events and delivery flow in real time.',
    href: '/notifications/whatsapp-activity',
    icon: MessageSquare,
    accent: { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-300', hoverBorder: 'hover:border-emerald-200 dark:hover:border-emerald-800' },
  },
  {
    id: 'delivery-logs',
    label: 'Delivery Logs',
    description: 'Review outbound notification delivery logs and status history.',
    href: '/notifications/delivery-logs',
    icon: ListChecks,
    accent: { bg: 'bg-sky-50 dark:bg-sky-900/30', text: 'text-sky-600 dark:text-sky-300', hoverBorder: 'hover:border-sky-200 dark:hover:border-sky-800' },
  },
  {
    id: 'failed-notifications',
    label: 'Failed Notifications',
    description: 'Track failed sends and trigger recovery actions safely.',
    href: '/notifications/failed',
    icon: AlertTriangle,
    accent: { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-300', hoverBorder: 'hover:border-amber-200 dark:hover:border-amber-800' },
  },
  {
    id: 'notification-providers',
    label: 'Notification Providers',
    description: 'Configure SMS, Email, and WhatsApp providers used by the system.',
    href: '/notifications/providers',
    icon: Bell,
    accent: { bg: 'bg-violet-50 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-300', hoverBorder: 'hover:border-violet-200 dark:hover:border-violet-800' },
  },
  {
    id: 'notification-types',
    label: 'Notification Types',
    description: 'Manage notification event categories and delivery channel rules.',
    href: '/notifications/types',
    icon: Megaphone,
    accent: { bg: 'bg-rose-50 dark:bg-rose-900/30', text: 'text-rose-600 dark:text-rose-300', hoverBorder: 'hover:border-rose-200 dark:hover:border-rose-800' },
  },
]

export default function NotificationsLandingView() {
  const router = useRouter()

  return (
    <div className="w-full space-y-6">
      <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-r from-slate-700 to-slate-600 px-6 py-8 text-white">
        <div className="relative z-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium">
            <Bell className="h-4 w-4" />
            <span>NOTIFICATIONS</span>
          </div>
          <h1 className="text-3xl font-semibold">Notifications</h1>
          <p className="mt-2 text-sm text-slate-100/90">
            Monitor system notifications, WhatsApp delivery, and failed messages.
          </p>
        </div>
      </div>

      <div>
        <p className="text-sm text-muted-foreground">
          Operational monitoring lives here. Configuration pages remain reusable and are linked below.
        </p>
      </div>

      <div className="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {notificationCards.map((item) => {
          const Icon = item.icon
          return (
            <div
              key={item.id}
              className={`bg-card border border-border rounded-xl p-5 space-y-3 hover:shadow-md ${item.accent.hoverBorder} transition-all duration-200 group/card`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`flex items-center justify-center h-9 w-9 rounded-lg ${item.accent.bg} ${item.accent.text}`}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h2 className="font-semibold text-base text-foreground">{item.label}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                </div>
              </div>

              <button
                onClick={() => router.push(item.href)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors group"
              >
                <span className="flex-1 text-left">Open</span>
                <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
