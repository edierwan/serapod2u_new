'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Messaging & Order Channels settings (Phase 1 — §6).
 * Bot tokens remain env-only; this UI configures operational toggles and group chat IDs.
 */
export function MessagingChannelsSettingsCard() {
  const [data, setData] = useState<any>(null)
  const [warehouseChatId, setWarehouseChatId] = useState('')
  const [financeChatId, setFinanceChatId] = useState('')
  const [telegramNotifications, setTelegramNotifications] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const res = await fetch('/api/messaging/settings-status')
    const payload = await res.json().catch(() => null)
    if (!res.ok) throw new Error(payload?.error || 'Unable to load messaging settings.')
    setData(payload)
    setWarehouseChatId(payload?.settings?.warehouseTelegramChatId || '')
    setFinanceChatId(payload?.settings?.financeTelegramChatId || '')
    setTelegramNotifications(payload?.telegram?.notificationsEnabled ?? true)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await load()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load messaging settings.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const save = async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/messaging/settings-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messagingOrdersEnabled: data?.messagingOrdersEnabled ?? true,
          telegram: {
            orderingEnabled: data?.telegram?.orderingEnabled ?? true,
            notificationsEnabled: telegramNotifications,
          },
          whatsapp: { orderingEnabled: false },
          settings: {
            warehouseTelegramChatId: warehouseChatId.trim() || null,
            financeTelegramChatId: financeChatId.trim() || null,
          },
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Save failed.')
      setNotice('Messaging settings saved.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  if (error && !data) {
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
          Telegram is the Phase 1 distributor ordering channel. Confirm reserves stock and notifies warehouse immediately.
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
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.telegram?.tokenConfigured ? 'default' : 'outline'}>
              {data.telegram?.tokenConfigured ? 'Token set' : 'Token missing'}
            </Badge>
            <Badge variant={data.telegram?.webhookSecretConfigured ? 'default' : 'outline'}>
              {data.telegram?.webhookSecretConfigured ? 'Webhook secret set' : 'Webhook secret missing'}
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="warehouse-chat">Warehouse Telegram group chat ID</Label>
            <Input
              id="warehouse-chat"
              value={warehouseChatId}
              onChange={(e) => setWarehouseChatId(e.target.value)}
              placeholder="e.g. -1001234567890"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="finance-chat">Finance Telegram group chat ID</Label>
            <Input
              id="finance-chat"
              value={financeChatId}
              onChange={(e) => setFinanceChatId(e.target.value)}
              placeholder="e.g. -1009876543210"
            />
          </div>
          <label className="flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              checked={telegramNotifications}
              onChange={(e) => setTelegramNotifications(e.target.checked)}
            />
            Enable Telegram operational notifications
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 opacity-80">
          <div>
            <p className="font-semibold">WhatsApp ordering</p>
            <p className="text-[var(--sera-muted)]">{data.whatsapp?.note}</p>
          </div>
          <Badge variant="outline">Future</Badge>
        </div>

        {notice && <p className="text-emerald-700">{notice}</p>}
        {error && <p className="text-red-700">{error}</p>}

        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save messaging settings'}
        </Button>
      </CardContent>
    </Card>
  )
}
