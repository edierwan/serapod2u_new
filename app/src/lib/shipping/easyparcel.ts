/**
 * EasyParcel Malaysia OpenAPI client (server-only).
 * Individual API is deprecated; this uses OAuth 2.0 + OpenAPI 2026-06.
 *
 * Env:
 *   EASYPARCEL_CLIENT_ID / EASYPARCEL_CLIENT_SECRET
 *   EASYPARCEL_REDIRECT_URI
 *   EASYPARCEL_API_BASE          default https://api.easyparcel.com
 *   EASYPARCEL_API_VERSION       default 2026-06
 *   EASYPARCEL_PICK_*            warehouse pickup address
 *   EASYPARCEL_DEFAULT_WEIGHT    kg, default 1
 */

import { toEasyParcelSubdivisionCode } from '@/lib/shipping/malaysia-states'
import {
  getEasyParcelAccessToken,
  getEasyParcelApiOrigin,
  getEasyParcelApiVersion,
  hasEasyParcelTokens,
  isEasyParcelAppConfigured,
} from '@/lib/shipping/easyparcel-oauth'

export type EasyParcelRate = {
  serviceId: string
  courierName: string
  serviceName: string
  price: number
  delivery: string | null
}

export function getEasyParcelPickup() {
  return {
    pick_code: String(process.env.EASYPARCEL_PICK_CODE || '').trim(),
    pick_state: String(process.env.EASYPARCEL_PICK_STATE || '').trim(),
    pick_country: String(process.env.EASYPARCEL_PICK_COUNTRY || 'MY').trim().toUpperCase(),
    pick_name: String(process.env.EASYPARCEL_PICK_NAME || 'Serapod Outdoor').trim(),
    pick_company: String(process.env.EASYPARCEL_PICK_COMPANY || 'Serapod').trim(),
    pick_contact: String(process.env.EASYPARCEL_PICK_CONTACT || '').trim(),
    pick_mobile: String(process.env.EASYPARCEL_PICK_MOBILE || '').trim(),
    pick_email: String(process.env.EASYPARCEL_PICK_EMAIL || '').trim(),
    pick_addr1: String(process.env.EASYPARCEL_PICK_ADDR1 || '').trim(),
    pick_city: String(process.env.EASYPARCEL_PICK_CITY || '').trim(),
  }
}

export function isEasyParcelAppReady() {
  return isEasyParcelAppConfigured()
}

export async function isEasyParcelConfigured() {
  if (!isEasyParcelAppConfigured()) return false
  return hasEasyParcelTokens()
}

function openApiUrl(path: string) {
  return `${getEasyParcelApiOrigin()}/open_api/${getEasyParcelApiVersion()}${path}`
}

async function openApi(path: string, body: unknown) {
  const token = await getEasyParcelAccessToken()
  if (!token.ok) return token

  const res = await fetch(openApiUrl(path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const message = json?.message || json?.error || `EasyParcel HTTP ${res.status}`
    return { ok: false as const, error: String(message) }
  }
  return { ok: true as const, data: json }
}

export function toMalaysiaPhone(raw: string) {
  let digits = String(raw || '').replace(/\D/g, '')
  if (digits.startsWith('60')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

export async function easyParcelRateCheck(input: {
  sendCode: string
  sendState: string
  sendCountry?: string
  weightKg?: number
}): Promise<{ ok: true; rates: EasyParcelRate[] } | { ok: false; error: string }> {
  const pickup = getEasyParcelPickup()
  const pickIso = toEasyParcelSubdivisionCode(pickup.pick_state)
  const sendIso = toEasyParcelSubdivisionCode(input.sendState)
  if (!pickup.pick_code || !pickIso) {
    return { ok: false, error: 'EasyParcel pickup postcode/state is not configured.' }
  }
  if (!sendIso) {
    return { ok: false, error: 'Receiver state is not a valid Malaysia state.' }
  }

  const weight = input.weightKg ?? Number(process.env.EASYPARCEL_DEFAULT_WEIGHT || 1)
  const result = await openApi('/shipment/quotations', {
    shipment: [
      {
        sender: {
          postcode: pickup.pick_code,
          subdivision_code: pickIso,
          country: pickup.pick_country,
        },
        receiver: {
          postcode: input.sendCode,
          subdivision_code: sendIso,
          country: (input.sendCountry || 'MY').toUpperCase(),
        },
        parcel_value: 50,
        weight,
        width: 10,
        length: 10,
        height: 10,
      },
    ],
  })
  if (!result.ok) return result

  const rates: EasyParcelRate[] = []
  const rows = result.data?.data
  const first = Array.isArray(rows) ? rows[0] : null
  const quotations = first?.quotations || []
  for (const row of Array.isArray(quotations) ? quotations : []) {
    const serviceId = String(row?.courier?.service_id || '').trim()
    const price = Number(row?.pricing?.total_amount || row?.pricing?.shipment_price || 0)
    if (!serviceId || !(price >= 0)) continue
    rates.push({
      serviceId,
      courierName: String(row?.courier?.courier_name || 'Courier'),
      serviceName: String(row?.courier?.service_name || 'Standard'),
      price,
      delivery: row?.courier?.delivery_duration || null,
    })
  }
  rates.sort((a, b) => a.price - b.price)
  return { ok: true, rates }
}

export async function easyParcelSubmitOrder(input: {
  serviceId: string
  weightKg?: number
  content: string
  value: number
  reference: string
  receiver: {
    name: string
    phone: string
    email: string
    addr1: string
    addr2?: string
    city: string
    state: string
    postcode: string
    country?: string
  }
}): Promise<
  | { ok: true; orderNo: string | null; awb: string | null; raw: any }
  | { ok: false; error: string }
> {
  const pickup = getEasyParcelPickup()
  const pickIso = toEasyParcelSubdivisionCode(pickup.pick_state)
  const sendIso = toEasyParcelSubdivisionCode(input.receiver.state)
  const weight = input.weightKg ?? Number(process.env.EASYPARCEL_DEFAULT_WEIGHT || 1)
  const collectDate = new Date().toISOString().slice(0, 10)
  const senderPhone = toMalaysiaPhone(pickup.pick_mobile || pickup.pick_contact)
  const receiverPhone = toMalaysiaPhone(input.receiver.phone)

  if (!pickup.pick_code || !pickIso || !pickup.pick_addr1 || !pickup.pick_city || !senderPhone) {
    return { ok: false, error: 'EasyParcel pickup address/phone is not fully configured.' }
  }
  if (!sendIso) {
    return { ok: false, error: 'Receiver state is not a valid Malaysia state.' }
  }

  const result = await openApi('/shipment/submit_orders', {
    shipment: [
      {
        reference: input.reference,
        service_id: input.serviceId,
        collection_date: collectDate,
        weight,
        height: 10,
        length: 10,
        width: 10,
        item: [
          {
            content: input.content.slice(0, 35) || 'Outdoor order',
            weight,
            height: 10,
            length: 10,
            width: 10,
            currency_code: 'MYR',
            value: Number(input.value) || 1,
            quantity: 1,
          },
        ],
        sender: {
          name: pickup.pick_name,
          company: pickup.pick_company,
          phone_number_country_code: 'MY',
          phone_number: senderPhone,
          email: pickup.pick_email || undefined,
          address_1: pickup.pick_addr1,
          postcode: pickup.pick_code,
          city: pickup.pick_city,
          subdivision_code: pickIso,
          country_code: pickup.pick_country,
        },
        receiver: {
          name: input.receiver.name,
          phone_number_country_code: 'MY',
          phone_number: receiverPhone,
          email: input.receiver.email,
          address_1: input.receiver.addr1,
          address_2: input.receiver.addr2 || undefined,
          postcode: input.receiver.postcode,
          city: input.receiver.city,
          subdivision_code: sendIso,
          country_code: (input.receiver.country || 'MY').toUpperCase(),
        },
        feature: {
          sms_tracking: false,
          email_tracking: false,
          whatsapp_tracking: false,
        },
      },
    ],
  })
  if (!result.ok) return result

  const first = Array.isArray(result.data?.data) ? result.data.data[0] : result.data?.data
  const shipment = Array.isArray(first?.shipments) ? first.shipments[0] : first?.shipments
  return {
    ok: true,
    orderNo: first?.order_details?.order_number || shipment?.shipment_number || null,
    awb: shipment?.awb_number || shipment?.shipment_number || null,
    raw: result.data,
  }
}

export type EasyParcelTrackingEvent = {
  status: string
  date: string | null
  location: string | null
  remark: string | null
}

export async function easyParcelTrackAwb(
  awbNo: string,
): Promise<
  | { ok: true; events: EasyParcelTrackingEvent[]; latestStatus: string | null; raw: any }
  | { ok: false; error: string }
> {
  const awb = String(awbNo || '').trim()
  if (!awb) return { ok: false, error: 'Tracking number is required.' }

  const result = await openApi('/shipment/tracking_status', { awb_numbers: [awb] })
  if (!result.ok) return result

  const results = result.data?.data?.results || result.data?.data || []
  const first = Array.isArray(results) ? results[0] : results
  const log = first?.status_log || []
  const events: EasyParcelTrackingEvent[] = (Array.isArray(log) ? log : []).map((row: any) => ({
    status: String(row.tracking_status || row.status || '').trim() || 'Update',
    date: row.event_date || null,
    location: row.location || null,
    remark: null,
  }))

  return {
    ok: true,
    events,
    latestStatus: first?.latest_tracking_status || events[0]?.status || null,
    raw: result.data,
  }
}
