'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import type { OutdoorMessageEvent } from '@/lib/outdoor/customer-messages'

interface EventSetting {
  event: OutdoorMessageEvent
  label: string
  when: string
  email: boolean
  sms: boolean
  defaults: { email: boolean; sms: boolean }
}

type Channel = 'email' | 'sms'

const API = '/api/admin/store/customer-messages'

/** Which Outdoor order events email or text the customer. */
export function OutdoorCustomerMessagesPanel() {
  const [events, setEvents] = useState<EventSetting[]>([])
  const [ready, setReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(API)
      .then(async res => {
        const data = await res.json().catch(() => null)
        if (cancelled) return
        if (res.status === 401) throw new Error('Only store admins can change customer messages.')
        if (!res.ok) throw new Error(data?.error || 'Could not load the customer message settings.')
        setEvents(Array.isArray(data?.events) ? data.events : [])
        setReady(data?.ready !== false)
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Could not load the customer message settings.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const toggle = async (setting: EventSetting, channel: Channel, value: boolean) => {
    const next = { email: setting.email, sms: setting.sms, [channel]: value }
    const previous = events
    setEvents(list => list.map(item => (item.event === setting.event ? { ...item, ...next } : item)))
    setSaving(`${setting.event}:${channel}`)
    setError(null)
    try {
      const res = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: setting.event, ...next }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not save this change.')
      if (Array.isArray(data?.events)) setEvents(data.events)
      setReady(data?.ready !== false)
    } catch (err: any) {
      setEvents(previous)
      setError(err.message || 'Could not save this change.')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Choose which order events send the Outdoor customer an email or an SMS. SMS only goes to Malaysian mobile numbers and needs an active SMS provider in Notification Providers.
      </p>
      {!ready ? (
        <p className="sera-sc-panel p-3 text-sm text-amber-700">
          These are the default settings. Changes can be saved once the database update for customer messages is applied.
        </p>
      ) : null}
      {error ? <p className="sera-sc-panel p-3 text-sm text-destructive">{error}</p> : null}
      {events.length === 0 ? null : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-accent/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Event</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground w-24">Email</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground w-24">SMS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map(setting => (
                <tr key={setting.event}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{setting.label}</p>
                    <p className="text-xs text-muted-foreground">{setting.when}</p>
                  </td>
                  {(['email', 'sms'] as const).map(channel => (
                    <td key={channel} className="px-4 py-3 text-center">
                      <div className="inline-flex flex-col items-center gap-1">
                        <Switch
                          checked={setting[channel]}
                          disabled={!ready || saving !== null}
                          onCheckedChange={value => toggle(setting, channel, value)}
                          aria-label={`${channel === 'email' ? 'Email' : 'SMS'} for ${setting.label}`}
                        />
                        {setting[channel] !== setting.defaults[channel] ? (
                          <span className="text-[10px] text-muted-foreground">Changed</span>
                        ) : null}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        The Outdoor inbox always gets its own notice when an order is paid.
      </p>
    </div>
  )
}
