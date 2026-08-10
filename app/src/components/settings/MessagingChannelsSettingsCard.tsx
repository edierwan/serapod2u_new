'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/**
 * Read-only Messaging & Order Channels status (Phase 1).
 * Secrets stay server-side; this only shows configuration presence.
 */
export function MessagingChannelsSettingsCard() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/messaging/settings-status')
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error(payload?.error || 'Unable to load messaging settings.')
        if (!cancelled) setData(payload)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load messaging settings.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Messaging & Order Channels</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!data) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Messaging & Order Channels</CardTitle>
        <CardDescription>
          Telegram is the Phase 1 distributor ordering channel. WhatsApp is reserved for a later phase.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <div>
            <p className="font-semibold">Telegram ordering</p>
            <p className="text-[var(--sera-muted)]">
              Bot: {data.telegram?.botUsername ? `@${data.telegram.botUsername}` : 'username not set'}
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant={data.telegram?.tokenConfigured ? 'default' : 'outline'}>
              {data.telegram?.tokenConfigured ? 'Token set' : 'Token missing'}
            </Badge>
            <Badge variant={data.telegram?.webhookSecretConfigured ? 'default' : 'outline'}>
              {data.telegram?.webhookSecretConfigured ? 'Webhook secret set' : 'Webhook secret missing'}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 opacity-80">
          <div>
            <p className="font-semibold">WhatsApp ordering</p>
            <p className="text-[var(--sera-muted)]">{data.whatsapp?.note}</p>
          </div>
          <Badge variant="outline">Future</Badge>
        </div>
      </CardContent>
    </Card>
  )
}
