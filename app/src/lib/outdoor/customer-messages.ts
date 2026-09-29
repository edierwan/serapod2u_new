export type OutdoorMessageEvent =
  | 'paid'
  | 'shipped'
  | 'tracking_updated'
  | 'delivered'
  | 'auto_cancelled'
  | 'cancelled'
  | 'refunded'

export interface OutdoorMessageChannels {
  email: boolean
  sms: boolean
}

export interface OutdoorMessageEventInfo extends OutdoorMessageChannels {
  event: OutdoorMessageEvent
  label: string
  when: string
}

export const OUTDOOR_MESSAGE_SETTINGS_TABLE = 'outdoor_customer_message_settings'

/** Every event staff can switch, with the channels it uses when nobody has changed it. */
export const OUTDOOR_MESSAGE_EVENTS: OutdoorMessageEventInfo[] = [
  { event: 'paid', label: 'Payment received', when: 'The customer pays for an order.', email: true, sms: true },
  { event: 'shipped', label: 'Order shipped', when: 'The order leaves the warehouse, by courier or our own team.', email: true, sms: false },
  { event: 'tracking_updated', label: 'New tracking number', when: 'The tracking number changes on an order that already shipped.', email: true, sms: false },
  { event: 'delivered', label: 'Order delivered', when: 'The order is marked as delivered.', email: true, sms: true },
  { event: 'auto_cancelled', label: 'Cancelled, not paid', when: 'The order is cancelled because it was not paid in time.', email: true, sms: false },
  { event: 'cancelled', label: 'Cancelled by staff', when: 'Staff cancel the order.', email: true, sms: false },
  { event: 'refunded', label: 'Refunded', when: 'The money goes back to the customer.', email: true, sms: false },
]

export function isOutdoorMessageEvent(value: unknown): value is OutdoorMessageEvent {
  return OUTDOOR_MESSAGE_EVENTS.some((info) => info.event === value)
}

export function defaultOutdoorMessageChannels(event: OutdoorMessageEvent): OutdoorMessageChannels {
  const info = OUTDOOR_MESSAGE_EVENTS.find((item) => item.event === event)
  return { email: info?.email ?? false, sms: info?.sms ?? false }
}

function withDefaults(event: OutdoorMessageEvent, row: any): OutdoorMessageChannels {
  const defaults = defaultOutdoorMessageChannels(event)
  return {
    email: typeof row?.email_enabled === 'boolean' ? row.email_enabled : defaults.email,
    sms: typeof row?.sms_enabled === 'boolean' ? row.sms_enabled : defaults.sms,
  }
}

/** The table is missing until its migration runs; everything keeps its default meanwhile. */
export function isMissingTableError(error: any) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

/** Channels staff chose for this event; the default when unset or unreadable. Never throws. */
export async function outdoorMessageChannels(admin: any, event: OutdoorMessageEvent): Promise<OutdoorMessageChannels> {
  try {
    const { data, error } = await admin
      .from(OUTDOOR_MESSAGE_SETTINGS_TABLE)
      .select('email_enabled, sms_enabled')
      .eq('event_code', event)
      .maybeSingle()
    return withDefaults(event, error ? null : data)
  } catch {
    return defaultOutdoorMessageChannels(event)
  }
}

/** All events with their current channels, for the staff settings screen. */
export async function listOutdoorMessageSettings(admin: any) {
  const { data, error } = await admin
    .from(OUTDOOR_MESSAGE_SETTINGS_TABLE)
    .select('event_code, email_enabled, sms_enabled, updated_at')
  if (error && !isMissingTableError(error)) throw error
  const rows = new Map<string, any>((error ? [] : data || []).map((row: any) => [row.event_code, row]))
  return {
    ready: !error,
    events: OUTDOOR_MESSAGE_EVENTS.map((info) => ({
      ...info,
      ...withDefaults(info.event, rows.get(info.event)),
      defaults: { email: info.email, sms: info.sms },
      updated_at: (rows.get(info.event)?.updated_at as string | undefined) ?? null,
    })),
  }
}
