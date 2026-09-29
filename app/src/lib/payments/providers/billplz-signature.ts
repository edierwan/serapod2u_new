import { createHmac, timingSafeEqual } from 'crypto'

function signatureKey(key: string) {
  return key.replace(/[\[\]]/g, '')
}

function isSignatureField(key: string, preferBillplzNamespace: boolean) {
  const compact = signatureKey(key).toLowerCase()
  if (compact === 'xsignature' || compact === 'billplzx_signature' || compact.endsWith('x_signature')) {
    return false
  }
  if (preferBillplzNamespace) return key.startsWith('billplz[') || compact.startsWith('billplz')
  return compact !== 'ref' && compact !== 'provider'
}

export function flattenPaymentParams(
  params: URLSearchParams | Record<string, string | string[] | undefined | null>,
) {
  const out: Record<string, string> = {}
  const entries =
    params instanceof URLSearchParams
      ? Array.from(params.entries())
      : Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v] as const)

  for (const [key, value] of entries) {
    if (value == null) continue
    out[key] = String(value)
    const nested = key.match(/^billplz\[(.+)\]$/i)
    if (nested) out[nested[1]] = String(value)
  }
  return out
}

export function billplzSourceString(payload: Record<string, string>) {
  const preferBillplzNamespace = Object.keys(payload).some((k) => k.startsWith('billplz['))
  const pairs = Object.entries(payload)
    .filter(([key]) => isSignatureField(key, preferBillplzNamespace))
    .map(([key, value]) => `${signatureKey(key)}${value ?? ''}`)
  pairs.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  return pairs.join('|')
}

export function verifyBillplzSignature(payload: Record<string, string>, xSignatureKey: string) {
  const provided =
    payload.x_signature ||
    payload['billplz[x_signature]'] ||
    payload.billplz_x_signature ||
    ''
  if (!xSignatureKey || !provided) return false
  const expected = createHmac('sha256', xSignatureKey).update(billplzSourceString(payload)).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
