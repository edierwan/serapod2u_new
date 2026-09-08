/**
 * EasyParcel Malaysia API client (server-only).
 * Keys never leave the backend.
 *
 * Env:
 *   EASYPARCEL_API_KEY
 *   EASYPARCEL_API_BASE   default https://connect.easyparcel.my/?ac=
 *                        demo:     https://demo.connect.easyparcel.my/?ac=
 *   EASYPARCEL_PICK_CODE / PICK_STATE / PICK_COUNTRY (default MY)
 *   EASYPARCEL_PICK_NAME / PICK_COMPANY / PICK_CONTACT / PICK_MOBILE
 *   EASYPARCEL_PICK_ADDR1 / PICK_CITY
 *   EASYPARCEL_DEFAULT_WEIGHT (kg, default 1)
 */

export type EasyParcelRate = {
  serviceId: string
  courierName: string
  serviceName: string
  price: number
  delivery: string | null
}

function apiKey() {
  return String(process.env.EASYPARCEL_API_KEY || '').trim()
}

function apiBase() {
  return String(process.env.EASYPARCEL_API_BASE || 'https://connect.easyparcel.my/?ac=').trim()
}

export function isEasyParcelConfigured() {
  return Boolean(apiKey())
}

export function getEasyParcelPickup() {
  return {
    pick_code: String(process.env.EASYPARCEL_PICK_CODE || '').trim(),
    pick_state: String(process.env.EASYPARCEL_PICK_STATE || '').trim().toLowerCase(),
    pick_country: String(process.env.EASYPARCEL_PICK_COUNTRY || 'MY').trim().toUpperCase(),
    pick_name: String(process.env.EASYPARCEL_PICK_NAME || 'Serapod Outdoor').trim(),
    pick_company: String(process.env.EASYPARCEL_PICK_COMPANY || 'Serapod').trim(),
    pick_contact: String(process.env.EASYPARCEL_PICK_CONTACT || '').trim(),
    pick_mobile: String(process.env.EASYPARCEL_PICK_MOBILE || '').trim(),
    pick_addr1: String(process.env.EASYPARCEL_PICK_ADDR1 || '').trim(),
    pick_city: String(process.env.EASYPARCEL_PICK_CITY || '').trim(),
  }
}

async function postAction(action: string, body: Record<string, unknown>) {
  const key = apiKey()
  if (!key) {
    return { ok: false as const, error: 'EasyParcel is not configured (missing EASYPARCEL_API_KEY).' }
  }

  const url = `${apiBase()}${action}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(
      Object.entries({ api: key, ...flattenParams(body) }).map(([k, v]) => [k, String(v)]),
    ),
  })

  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false as const, error: 'EasyParcel returned a non-JSON response.' }
  }

  if (!res.ok) {
    return { ok: false as const, error: `EasyParcel HTTP ${res.status}` }
  }

  return { ok: true as const, data: json }
}

/** Flatten nested bulk[0][key] style for EasyParcel form posts. */
function flattenParams(input: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}[${key}]` : key
    if (value == null) continue
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === 'object') {
          Object.assign(out, flattenParams(item as Record<string, unknown>, `${path}[${index}]`))
        } else {
          out[`${path}[${index}]`] = String(item)
        }
      })
    } else if (typeof value === 'object') {
      Object.assign(out, flattenParams(value as Record<string, unknown>, path))
    } else {
      out[path] = String(value)
    }
  }
  return out
}

export async function easyParcelRateCheck(input: {
  sendCode: string
  sendState: string
  sendCountry?: string
  weightKg?: number
}): Promise<{ ok: true; rates: EasyParcelRate[] } | { ok: false; error: string }> {
  const pickup = getEasyParcelPickup()
  if (!pickup.pick_code || !pickup.pick_state) {
    return { ok: false, error: 'EasyParcel pickup postcode/state is not configured.' }
  }

  const weight = input.weightKg ?? Number(process.env.EASYPARCEL_DEFAULT_WEIGHT || 1)
  const result = await postAction('EPRateCheckingBulk', {
    bulk: [
      {
        pick_code: pickup.pick_code,
        pick_state: pickup.pick_state,
        pick_country: pickup.pick_country,
        send_code: input.sendCode,
        send_state: input.sendState.toLowerCase(),
        send_country: (input.sendCountry || 'MY').toUpperCase(),
        weight: String(weight),
        width: '0',
        length: '0',
        height: '0',
      },
    ],
  })

  if (!result.ok) return result

  const rates: EasyParcelRate[] = []
  const resultRows = result.data?.result || result.data?.results || []
  const first = Array.isArray(resultRows) ? resultRows[0] : null
  const rateList = first?.rates || first?.rate || []

  for (const row of Array.isArray(rateList) ? rateList : []) {
    const serviceId = String(row.service_id || row.serviceid || '').trim()
    const price = Number(row.price || row.total_price || row.rate || 0)
    if (!serviceId || !(price >= 0)) continue
    rates.push({
      serviceId,
      courierName: String(row.courier_name || row.courier || row.company || 'Courier'),
      serviceName: String(row.service_name || row.service || row.courier_name || 'Standard'),
      price,
      delivery: row.delivery || row.estimated_delivery || null,
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
  const weight = input.weightKg ?? Number(process.env.EASYPARCEL_DEFAULT_WEIGHT || 1)
  const collectDate = new Date().toISOString().slice(0, 10)

  const result = await postAction('EPSubmitOrderBulk', {
    bulk: [
      {
        weight: String(weight),
        width: '1',
        length: '1',
        height: '1',
        content: input.content.slice(0, 35),
        value: String(input.value),
        service_id: input.serviceId,
        pick_point: '',
        pick_name: pickup.pick_name,
        pick_company: pickup.pick_company,
        pick_contact: pickup.pick_contact || pickup.pick_mobile,
        pick_mobile: pickup.pick_mobile || pickup.pick_contact,
        pick_addr1: pickup.pick_addr1,
        pick_addr2: '',
        pick_addr3: '',
        pick_addr4: '',
        pick_city: pickup.pick_city,
        pick_state: pickup.pick_state,
        pick_code: pickup.pick_code,
        pick_country: pickup.pick_country,
        send_point: '',
        send_name: input.receiver.name,
        send_company: '',
        send_contact: input.receiver.phone,
        send_mobile: input.receiver.phone,
        send_addr1: input.receiver.addr1,
        send_addr2: input.receiver.addr2 || '',
        send_addr3: '',
        send_addr4: '',
        send_city: input.receiver.city,
        send_state: input.receiver.state.toLowerCase(),
        send_code: input.receiver.postcode,
        send_country: (input.receiver.country || 'MY').toUpperCase(),
        collect_date: collectDate,
        sms: '0',
        send_email: input.receiver.email,
        reference: input.reference,
      },
    ],
  })

  if (!result.ok) return result

  const rows = result.data?.result || result.data?.results || []
  const first = Array.isArray(rows) ? rows[0] : null
  return {
    ok: true,
    orderNo: first?.order_number || first?.order_no || first?.orderno || null,
    awb: first?.parcel?.[0]?.awb || first?.awb || first?.awb_no || null,
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

  const result = await postAction('EPTrackingBulk', {
    bulk: [{ awb_no: awb }],
  })
  if (!result.ok) return result

  const rows = result.data?.result || result.data?.results || []
  const first = Array.isArray(rows) ? rows[0] : null
  const eventsRaw = first?.tracking || first?.events || first?.parcel_status || []
  const events: EasyParcelTrackingEvent[] = (Array.isArray(eventsRaw) ? eventsRaw : []).map((row: any) => ({
    status: String(row.status || row.event || row.description || '').trim() || 'Update',
    date: row.date || row.event_date || row.datetime || null,
    location: row.location || row.city || null,
    remark: row.remark || row.message || null,
  }))

  return {
    ok: true,
    events,
    latestStatus: events[0]?.status || first?.status || null,
    raw: result.data,
  }
}
