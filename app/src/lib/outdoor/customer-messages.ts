import { UNPAID_ORDER_TTL_HOURS } from '@/lib/storefront/unpaid-order-deadline'

export type OutdoorOrderMessageEvent =
  | 'paid'
  | 'shipped'
  | 'tracking_updated'
  | 'delivered'
  | 'auto_cancelled'
  | 'cancelled'
  | 'refunded'

export type OutdoorMessageEvent = OutdoorOrderMessageEvent | 'newsletter_welcome'

export type OutdoorMessageGroup = 'order' | 'newsletter'

export interface OutdoorMessageChannels {
  email: boolean
  sms: boolean
}

export interface OutdoorMessageSettings extends OutdoorMessageChannels {
  /** Staff wording for the SMS; null uses the built-in text. */
  smsTemplate: string | null
}

export interface OutdoorMessageEventInfo extends OutdoorMessageChannels {
  event: OutdoorMessageEvent
  group: OutdoorMessageGroup
  label: string
  when: string
  /** Whether this event can be sent by SMS at all. */
  smsAvailable: boolean
  smsTemplate: string
}

export const OUTDOOR_MESSAGE_SETTINGS_TABLE = 'outdoor_customer_message_settings'

/** Every event staff can switch, with the channels and SMS text it uses when nobody has changed it. */
export const OUTDOOR_MESSAGE_EVENTS: OutdoorMessageEventInfo[] = [
  {
    event: 'paid',
    group: 'order',
    label: 'Payment received',
    when: 'The customer pays for an order.',
    email: true,
    sms: true,
    smsAvailable: true,
    smsTemplate: '[SeraOutdoor] Payment received for order {{order_no}}. Thank you! Track it here: {{track_url}}',
  },
  {
    event: 'shipped',
    group: 'order',
    label: 'Order shipped',
    when: 'The order leaves the warehouse, by courier or our own team.',
    email: true,
    sms: false,
    smsAvailable: true,
    smsTemplate: '[SeraOutdoor] Order {{order_no}} is on its way. Track it here: {{track_url}}',
  },
  {
    event: 'tracking_updated',
    group: 'order',
    label: 'New tracking number',
    when: 'The tracking number changes on an order that already shipped.',
    email: true,
    sms: false,
    smsAvailable: true,
    smsTemplate: '[SeraOutdoor] New tracking number for order {{order_no}}. See it here: {{track_url}}',
  },
  {
    event: 'delivered',
    group: 'order',
    label: 'Order delivered',
    when: 'The order is marked as delivered.',
    email: true,
    sms: true,
    smsAvailable: true,
    smsTemplate: '[SeraOutdoor] Order {{order_no}} has been delivered. Enjoy! Any problem? Report it from your order: {{account_url}}',
  },
  {
    event: 'auto_cancelled',
    group: 'order',
    label: 'Cancelled, not paid',
    when: 'The order is cancelled because it was not paid in time.',
    email: true,
    sms: false,
    smsAvailable: true,
    smsTemplate: `[SeraOutdoor] Order {{order_no}} was cancelled because payment was not completed within ${UNPAID_ORDER_TTL_HOURS} hours. You have not been charged.`,
  },
  {
    event: 'cancelled',
    group: 'order',
    label: 'Cancelled by staff',
    when: 'Staff cancel the order.',
    email: true,
    sms: false,
    smsAvailable: true,
    smsTemplate: '[SeraOutdoor] Order {{order_no}} has been cancelled. {{payment_note}} Questions? {{contact_url}}',
  },
  {
    event: 'refunded',
    group: 'order',
    label: 'Refunded',
    when: 'The money goes back to the customer.',
    email: true,
    sms: false,
    smsAvailable: true,
    smsTemplate: '[SeraOutdoor] Your refund for order {{order_no}} is on its way. It can take 5-10 business days to show.',
  },
  {
    event: 'newsletter_welcome',
    group: 'newsletter',
    label: 'Welcome email',
    when: 'Someone subscribes to Outdoor updates. Sent once per sign-up.',
    email: true,
    sms: false,
    smsAvailable: false,
    smsTemplate: '',
  },
]

/** Placeholders an Outdoor SMS may use, in the order staff see them. */
export const OUTDOOR_SMS_VARIABLES = [
  { key: 'order_no', label: 'Order number' },
  { key: 'first_name', label: "Customer's first name" },
  { key: 'amount', label: 'Order total' },
  { key: 'courier', label: 'Courier' },
  { key: 'tracking_no', label: 'Tracking number' },
  { key: 'payment_note', label: 'Refund or "not charged" line' },
  { key: 'track_url', label: 'Order tracking link' },
  { key: 'account_url', label: 'My account link' },
  { key: 'contact_url', label: 'Contact us link' },
  { key: 'shop_url', label: 'Shop link' },
] as const

export type OutdoorSmsVariable = (typeof OUTDOOR_SMS_VARIABLES)[number]['key']
export type OutdoorSmsValues = Record<OutdoorSmsVariable, string>

/** Longest SMS text staff may save: about three SMS. */
export const OUTDOOR_SMS_MAX_LENGTH = 480

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export function isOutdoorMessageEvent(value: unknown): value is OutdoorMessageEvent {
  return OUTDOOR_MESSAGE_EVENTS.some((info) => info.event === value)
}

export function defaultOutdoorMessageChannels(event: OutdoorMessageEvent): OutdoorMessageChannels {
  const info = OUTDOOR_MESSAGE_EVENTS.find((item) => item.event === event)
  return { email: info?.email ?? false, sms: info?.sms ?? false }
}

export function defaultOutdoorSmsTemplate(event: OutdoorMessageEvent): string {
  return OUTDOOR_MESSAGE_EVENTS.find((item) => item.event === event)?.smsTemplate ?? ''
}

/** Fills the placeholders; anything unknown or empty is left out rather than shown raw. */
export function renderOutdoorSms(template: string, values: Partial<OutdoorSmsValues>): string {
  return template
    .replace(PLACEHOLDER, (_, key: string) => String((values as Record<string, string | undefined>)[key] ?? ''))
    .replace(/ {2,}/g, ' ')
    .trim()
}

export function outdoorSmsSampleValues(origin: string): OutdoorSmsValues {
  const ref = 'ORD-MUM5I5DE-OAZ2'
  return {
    order_no: ref,
    first_name: 'Aina',
    amount: 'RM 189.00',
    courier: 'J&T Express',
    tracking_no: 'JT1234567890',
    payment_note: 'You have not been charged.',
    track_url: `${origin}/outdoor/track?order=${ref}`,
    account_url: `${origin}/outdoor/account`,
    contact_url: `${origin}/outdoor/contact`,
    shop_url: `${origin}/outdoor/shop`,
  }
}

/** A problem with staff wording, or null when it can be saved. */
export function outdoorSmsTemplateProblem(template: string): string | null {
  const text = template.trim()
  if (text.length > OUTDOOR_SMS_MAX_LENGTH) return `Keep the SMS under ${OUTDOOR_SMS_MAX_LENGTH} characters.`
  const known = new Set<string>(OUTDOOR_SMS_VARIABLES.map((v) => v.key))
  const unknown = [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((key) => !known.has(key))
  if (unknown.length) return `Unknown placeholder {{${unknown[0]}}}. Use only the placeholders listed.`
  if ((text.match(/\{\{|\}\}/g) || []).length !== [...text.matchAll(PLACEHOLDER)].length * 2) {
    return 'A placeholder is not closed. Write it like {{order_no}}.'
  }
  return null
}

/** How many SMS the gateway sends for this text: 160/153 plain characters, 70/67 with emoji or non-Latin text. */
export function outdoorSmsParts(text: string): { plain: boolean; parts: number } {
  const plain = /^[\x20-\x7E\n\r]*$/.test(text)
  const single = plain ? 160 : 70
  const multi = plain ? 153 : 67
  const length = [...text].length
  return { plain, parts: length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi) }
}

export function outdoorEventHasSms(event: OutdoorMessageEvent) {
  return OUTDOOR_MESSAGE_EVENTS.find((item) => item.event === event)?.smsAvailable ?? false
}

function withDefaults(event: OutdoorMessageEvent, row: any): OutdoorMessageSettings {
  const defaults = defaultOutdoorMessageChannels(event)
  const hasSms = outdoorEventHasSms(event)
  const template = typeof row?.sms_template === 'string' ? row.sms_template.trim() : ''
  return {
    email: typeof row?.email_enabled === 'boolean' ? row.email_enabled : defaults.email,
    sms: hasSms && (typeof row?.sms_enabled === 'boolean' ? row.sms_enabled : defaults.sms),
    smsTemplate: (hasSms && template) || null,
  }
}

/** The table or a column is missing until its migration runs; everything keeps its default meanwhile. */
export function isMissingTableError(error: any) {
  return ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error?.code)
}

/** What staff chose for this event; the defaults when unset or unreadable. Never throws. */
export async function outdoorMessageSettings(admin: any, event: OutdoorMessageEvent): Promise<OutdoorMessageSettings> {
  try {
    const { data, error } = await admin
      .from(OUTDOOR_MESSAGE_SETTINGS_TABLE)
      .select('*')
      .eq('event_code', event)
      .maybeSingle()
    return withDefaults(event, error ? null : data)
  } catch {
    return withDefaults(event, null)
  }
}

export async function outdoorMessageChannels(admin: any, event: OutdoorMessageEvent): Promise<OutdoorMessageChannels> {
  const { email, sms } = await outdoorMessageSettings(admin, event)
  return { email, sms }
}

/** All events with their current settings, for the staff settings screen. */
export async function listOutdoorMessageSettings(admin: any) {
  const table = admin.from(OUTDOOR_MESSAGE_SETTINGS_TABLE)
  const { data, error } = await table.select('*')
  if (error && !isMissingTableError(error)) throw error
  const ready = !error
  let templatesReady = false
  if (ready) {
    const probe = await admin.from(OUTDOOR_MESSAGE_SETTINGS_TABLE).select('event_code, sms_template').limit(1)
    if (probe.error && !isMissingTableError(probe.error)) throw probe.error
    templatesReady = !probe.error
  }
  const rows = new Map<string, any>((error ? [] : data || []).map((row: any) => [row.event_code, row]))
  return {
    ready,
    templatesReady,
    events: OUTDOOR_MESSAGE_EVENTS.map((info) => {
      const current = withDefaults(info.event, rows.get(info.event))
      return {
        event: info.event,
        group: info.group,
        label: info.label,
        when: info.when,
        smsAvailable: info.smsAvailable,
        email: current.email,
        sms: current.sms,
        smsTemplate: current.smsTemplate,
        defaults: { email: info.email, sms: info.sms, smsTemplate: info.smsTemplate },
        updated_at: (rows.get(info.event)?.updated_at as string | undefined) ?? null,
      }
    }),
  }
}
