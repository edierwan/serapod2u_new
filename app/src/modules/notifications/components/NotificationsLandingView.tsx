'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Bell, Megaphone, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import ModuleLightHeader from '@/components/layout/ModuleLightHeader'
import { cn } from '@/lib/utils'

interface NotificationsCardItem {
  id: string
  label: string
  description: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  accent: { chip: string; icon: string }
}

const notificationCards: NotificationsCardItem[] = [
  {
    id: 'failed-notifications',
    label: 'WhatsApp Activity & Recovery',
    description: 'Monitor WhatsApp delivery activity, failed notifications, provider status, and recovery actions.',
    href: '/notifications/whatsapp-activity-recovery',
    icon: AlertTriangle,
    accent: { chip: 'bg-amber-50', icon: 'text-amber-600' },
  },
  {
    id: 'notification-providers',
    label: 'Notification Providers',
    description: 'Configure SMS, Email, and WhatsApp providers used by the system.',
    href: '/notifications/providers',
    icon: Bell,
    accent: { chip: 'bg-violet-50', icon: 'text-violet-600' },
  },
  {
    id: 'notification-types',
    label: 'Notification Types',
    description: 'Manage notification event categories and delivery channel rules.',
    href: '/notifications/types',
    icon: Megaphone,
    accent: { chip: 'bg-rose-50', icon: 'text-rose-600' },
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
    <div className="w-full space-y-8">
      <ModuleLightHeader
        eyebrow="Notifications"
        title="Delivery monitoring"
        description="Monitor system notifications, WhatsApp delivery, and failed messages."
      />

      <p className="text-sm text-[var(--sera-muted)]">
        Operational monitoring lives here. Configuration pages remain reusable and are linked below.
      </p>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {notificationCards.map((item) => {
          const Icon = item.icon
          const href = item.id === 'notification-providers' ? providersHref : item.href
          const action = item.id === 'notification-providers' ? providersAction : 'Open'

          return (
            <div
              key={item.id}
              className="rounded-xl border border-[var(--sera-line)] bg-white p-5 space-y-3 transition-colors hover:border-[var(--sera-orange)]/35"
            >
              <div className="flex items-center gap-2.5">
                <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg shrink-0', item.accent.chip, item.accent.icon)}>
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold text-base text-[var(--sera-ink)]">{item.label}</h2>
                  <p className="text-xs text-[var(--sera-muted)] mt-0.5 line-clamp-2">{item.description}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => router.push(href)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-[var(--sera-muted)] hover:text-[var(--sera-ink)] hover:bg-[var(--sera-mist)] transition-colors group"
              >
                <span className="flex-1 text-left">{action}</span>
                <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--sera-orange)]" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
