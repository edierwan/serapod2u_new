'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Bell, Megaphone, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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
    id: 'failed-notifications',
    label: 'WhatsApp Activity & Recovery',
    description: 'Monitor WhatsApp delivery activity, failed notifications, provider status, and recovery actions.',
    href: '/notifications/whatsapp-activity-recovery',
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
  const [providersHref, setProvidersHref] = useState('/notifications/providers?channel=whatsapp&provider=meta&tab=configuration')
  const [providersAction, setProvidersAction] = useState('Continue Setup')

  useEffect(() => {
    const loadProviderDestination = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('notification_provider_configs')
        .select('provider_name,is_active,is_default,config_public,last_test_status')
        .eq('channel', 'whatsapp')

      const records = data || []
      const selected = records.find(record => record.is_default) || records.find(record => record.is_active) || records.find(record => record.provider_name === 'whatsapp_business')
      if (!selected) return

      const aliases: Record<string, string> = {
        whatsapp_business: 'meta',
        baileys: 'baileys-hostinger',
        baileys_home: 'baileys-home',
        twilio: 'twilio',
        messagebird: 'messagebird'
      }
      const provider = aliases[selected.provider_name] || 'meta'
      const tab = selected.provider_name === 'baileys' || selected.provider_name === 'baileys_home' ? 'status' : 'configuration'
      const metaIncomplete = selected.provider_name === 'whatsapp_business' && !(
        (selected.config_public as any)?.phone_number_id && (selected.config_public as any)?.waba_id
      )

      setProvidersHref(`/notifications/providers?channel=whatsapp&provider=${provider}&tab=${tab}`)
      setProvidersAction(metaIncomplete ? 'Continue Setup' : 'Manage')
    }

    loadProviderDestination().catch(error => console.error('Failed to resolve notification provider destination', error))
  }, [])

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
          const href = item.id === 'notification-providers' ? providersHref : item.href
          const action = item.id === 'notification-providers' ? providersAction : 'Open'
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
                onClick={() => router.push(href)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors group"
              >
                <span className="flex-1 text-left">{action}</span>
                <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
