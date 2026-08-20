'use client'

import { Headphones, Megaphone, Warehouse } from 'lucide-react'
import { cn } from '@/lib/utils'

function KindBadge({ avatarKey }: { avatarKey?: string | null }) {
  if (avatarKey === 'warehouse') return <Warehouse className="h-2.5 w-2.5" />
  if (avatarKey === 'news') return <Megaphone className="h-2.5 w-2.5" />
  if (avatarKey === 'support') return <Headphones className="h-2.5 w-2.5" />
  return null
}

export default function SerappConversationAvatar({
  avatarKey,
  size = 'md',
  onDark = false,
}: {
  avatarKey?: string | null
  size?: 'sm' | 'md'
  onDark?: boolean
}) {
  const badge = KindBadge({ avatarKey })
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-full',
        size === 'sm' ? 'h-10 w-10' : 'h-12 w-12',
        onDark ? 'bg-white' : 'bg-white ring-1 ring-[#ece7e0]',
      )}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/serapp-homescreen-192.png"
        alt=""
        className="h-full w-full object-cover object-center p-0.5"
      />
      {badge && (
        <span className="absolute bottom-0 right-0 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--sera-orange)] text-white ring-2 ring-white">
          {badge}
        </span>
      )}
    </div>
  )
}
