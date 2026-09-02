'use client'

import { useRouter } from 'next/navigation'
import { Mail, MessageCircle, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

const CHANNELS = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    href: '/notifications/whatsapp-activity-recovery',
    icon: MessageCircle,
  },
  {
    id: 'sms',
    label: 'SMS',
    href: '/notifications/sms-activity',
    icon: MessageSquare,
  },
  {
    id: 'email',
    label: 'Email',
    href: '/notifications/email-activity',
    icon: Mail,
  },
] as const

export default function NotificationChannelSwitch({ active }: { active: 'whatsapp' | 'sms' | 'email' }) {
  const router = useRouter()

  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
      {CHANNELS.map((channel) => {
        const Icon = channel.icon
        const isActive = channel.id === active
        return (
          <button
            key={channel.id}
            type="button"
            onClick={() => router.push(channel.href)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {channel.label}
          </button>
        )
      })}
    </div>
  )
}
