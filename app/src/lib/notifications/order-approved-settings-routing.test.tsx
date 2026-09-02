import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../..')
const migration = fs.readFileSync(
  path.join(root, '../supabase/migrations/20260831180000_order_approved_settings_routing.sql'),
  'utf8',
)
const worker = fs.readFileSync(
  path.join(root, 'src/app/api/cron/notification-outbox-worker/route.ts'),
  'utf8',
)

describe('order_approved settings routing', () => {
  it('queues only the first hop from notification settings, like reject', () => {
    expect(migration).toContain("v_event_code IN ('order_rejected', 'order_approved')")
    expect(migration).toContain("v_preset = 'sms_only'")
    expect(migration).toContain('v_first_channel')
    expect(migration).toContain('PERFORM public.queue_notification')
  })

  it('queues against the org that owns the SMS provider when HQ has it', () => {
    expect(migration).toContain("org_type_code = 'HQ'")
    expect(migration).toContain('v_provider_org_id')
  })

  it('cancels extra trigger channels for approve until the first hop', () => {
    expect(worker).toContain("event_code === 'order_rejected' || event_code === 'order_approved'")
    expect(worker).toContain('deliveryChainForPreset(routingPreset)[0]')
    expect(worker).toContain('!isFallbackHop && notifSetting')
  })
})
