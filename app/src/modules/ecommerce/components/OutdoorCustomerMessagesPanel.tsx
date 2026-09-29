'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { outdoorPublicOrigin } from '@/lib/outdoor/auth-return'
import {
  OUTDOOR_SMS_VARIABLES,
  outdoorSmsParts,
  outdoorSmsSampleValues,
  outdoorSmsTemplateProblem,
  renderOutdoorSms,
  type OutdoorMessageEvent,
} from '@/lib/outdoor/customer-messages'

interface EventSetting {
  event: OutdoorMessageEvent
  label: string
  when: string
  email: boolean
  sms: boolean
  smsTemplate: string | null
  defaults: { email: boolean; sms: boolean; smsTemplate: string }
}

type Channel = 'email' | 'sms'

const API = '/api/admin/store/customer-messages'

function SmsEditor({
  setting,
  enabled,
  saving,
  onSave,
  onCancel,
}: {
  setting: EventSetting
  enabled: boolean
  saving: boolean
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(setting.smsTemplate ?? setting.defaults.smsTemplate)
  const box = useRef<HTMLTextAreaElement>(null)
  const preview = renderOutdoorSms(draft.trim() || setting.defaults.smsTemplate, outdoorSmsSampleValues(outdoorPublicOrigin()))
  const { plain, parts } = outdoorSmsParts(preview)
  const problem = draft.trim() ? outdoorSmsTemplateProblem(draft) : null

  const insert = (key: string) => {
    const token = `{{${key}}}`
    const el = box.current
    const start = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? draft.length
    setDraft(draft.slice(0, start) + token + draft.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-muted-foreground" htmlFor={`sms-${setting.event}`}>
        SMS text for {setting.label}
      </label>
      <textarea
        id={`sms-${setting.event}`}
        ref={box}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        disabled={!enabled}
        rows={3}
        className="w-full rounded-lg border border-[var(--sera-line)] bg-white p-2 font-mono text-sm"
      />
      <div className="flex flex-wrap gap-1.5">
        {OUTDOOR_SMS_VARIABLES.map(v => (
          <button
            key={v.key}
            type="button"
            title={v.label}
            disabled={!enabled}
            onClick={() => insert(v.key)}
            className="rounded-full border border-[var(--sera-line)] bg-white px-2 py-0.5 font-mono text-[11px] text-foreground hover:border-[var(--sera-orange,#f97316)] disabled:opacity-50"
          >
            {`{{${v.key}}}`}
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-white p-3">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Preview</p>
        <p className="whitespace-pre-wrap text-sm text-foreground" data-testid="sms-preview">{preview}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {[...preview].length} characters · {parts} SMS
          {parts > 1 ? ' — longer texts are sent as several SMS and cost more.' : ''}
          {!plain ? ' Emoji or non-Latin letters make each SMS only 70 characters.' : ''}
        </p>
      </div>
      {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!enabled || saving || Boolean(problem)}
          onClick={() => onSave(draft)}
          className="rounded-lg bg-[var(--sera-orange,#f97316)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save SMS text'}
        </button>
        <button
          type="button"
          disabled={!enabled || saving}
          onClick={() => setDraft(setting.defaults.smsTemplate)}
          className="rounded-lg border border-[var(--sera-line)] px-3 py-1.5 text-sm"
        >
          Use default text
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  )
}

/** Which Outdoor order events email or text the customer, and what the SMS says. */
export function OutdoorCustomerMessagesPanel() {
  const [events, setEvents] = useState<EventSetting[]>([])
  const [ready, setReady] = useState(true)
  const [templatesReady, setTemplatesReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [editing, setEditing] = useState<OutdoorMessageEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applyList = (data: any) => {
    if (Array.isArray(data?.events)) setEvents(data.events)
    setReady(data?.ready !== false)
    setTemplatesReady(data?.templatesReady === true)
  }

  useEffect(() => {
    let cancelled = false
    fetch(API)
      .then(async res => {
        const data = await res.json().catch(() => null)
        if (cancelled) return
        if (res.status === 401) throw new Error('Only store admins can change customer messages.')
        if (!res.ok) throw new Error(data?.error || 'Could not load the customer message settings.')
        applyList(data)
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Could not load the customer message settings.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const save = async (setting: EventSetting, change: Partial<Pick<EventSetting, 'email' | 'sms'>> & { smsTemplate?: string }, key: string) => {
    const next = { email: setting.email, sms: setting.sms, ...change }
    const previous = events
    setEvents(list => list.map(item => (item.event === setting.event ? { ...item, email: next.email, sms: next.sms } : item)))
    setSaving(key)
    setError(null)
    try {
      const res = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: setting.event, ...next }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not save this change.')
      applyList(data)
      return true
    } catch (err: any) {
      setEvents(previous)
      setError(err.message || 'Could not save this change.')
      return false
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
        Choose which order events send the Outdoor customer an email or an SMS, and what each SMS says. SMS only goes to Malaysian mobile numbers and needs an active SMS provider in Notification Providers.
      </p>
      {!ready ? (
        <p className="sera-sc-panel p-3 text-sm text-amber-700">
          These are the default settings. Changes can be saved once the database update for customer messages is applied.
        </p>
      ) : !templatesReady ? (
        <p className="sera-sc-panel p-3 text-sm text-amber-700">
          The switches work. Editing the SMS text needs the database update for customer SMS texts.
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
                <Fragment key={setting.event}>
                  <tr>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{setting.label}</p>
                      <p className="text-xs text-muted-foreground">{setting.when}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(editing === setting.event ? null : setting.event)}
                          className="text-xs font-medium text-[var(--sera-orange,#f97316)] hover:underline"
                        >
                          {editing === setting.event ? 'Close SMS text' : 'Edit SMS text'}
                        </button>
                        {setting.smsTemplate ? (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Custom SMS text</span>
                        ) : null}
                      </div>
                    </td>
                    {(['email', 'sms'] as const).map(channel => (
                      <td key={channel} className="px-4 py-3 text-center align-top">
                        <div className="inline-flex flex-col items-center gap-1">
                          <Switch
                            checked={setting[channel]}
                            disabled={!ready || saving !== null}
                            onCheckedChange={value => save(setting, { [channel]: value } as Partial<Record<Channel, boolean>>, `${setting.event}:${channel}`)}
                            aria-label={`${channel === 'email' ? 'Email' : 'SMS'} for ${setting.label}`}
                          />
                          {setting[channel] !== setting.defaults[channel] ? (
                            <span className="text-[10px] text-muted-foreground">Changed</span>
                          ) : null}
                        </div>
                      </td>
                    ))}
                  </tr>
                  {editing === setting.event ? (
                    <tr className="bg-accent/10">
                      <td colSpan={3} className="px-4 py-4">
                        <SmsEditor
                          setting={setting}
                          enabled={ready && templatesReady}
                          saving={saving === `${setting.event}:template`}
                          onCancel={() => setEditing(null)}
                          onSave={async text => {
                            if (await save(setting, { smsTemplate: text }, `${setting.event}:template`)) setEditing(null)
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
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
