/** Malaysia states for Outdoor checkout / EasyParcel OpenAPI subdivision_code. */

export const MALAYSIA_STATES = [
  { label: 'Johor', code: 'johor', iso: 'MY-01' },
  { label: 'Kedah', code: 'kedah', iso: 'MY-02' },
  { label: 'Kelantan', code: 'kelantan', iso: 'MY-03' },
  { label: 'Melaka', code: 'melaka', iso: 'MY-04' },
  { label: 'Negeri Sembilan', code: 'negeri-sembilan', iso: 'MY-05' },
  { label: 'Pahang', code: 'pahang', iso: 'MY-06' },
  { label: 'Penang', code: 'penang', iso: 'MY-07' },
  { label: 'Perak', code: 'perak', iso: 'MY-08' },
  { label: 'Perlis', code: 'perlis', iso: 'MY-09' },
  { label: 'Sabah', code: 'sabah', iso: 'MY-12' },
  { label: 'Sarawak', code: 'sarawak', iso: 'MY-13' },
  { label: 'Selangor', code: 'selangor', iso: 'MY-10' },
  { label: 'Terengganu', code: 'terengganu', iso: 'MY-11' },
  { label: 'Kuala Lumpur', code: 'kuala-lumpur', iso: 'MY-14' },
  { label: 'Labuan', code: 'labuan', iso: 'MY-15' },
  { label: 'Putrajaya', code: 'putrajaya', iso: 'MY-16' },
] as const

export function toEasyParcelState(labelOrCode: string): string {
  const raw = String(labelOrCode || '').trim().toLowerCase()
  if (!raw) return ''
  const byCode = MALAYSIA_STATES.find((s) => s.code === raw)
  if (byCode) return byCode.code
  const byLabel = MALAYSIA_STATES.find((s) => s.label.toLowerCase() === raw)
  if (byLabel) return byLabel.code
  return raw.replace(/\s+/g, '-')
}

/** ISO 3166-2 MY code for EasyParcel OpenAPI (e.g. Selangor → MY-10). */
export function toEasyParcelSubdivisionCode(labelOrCode: string): string {
  const raw = String(labelOrCode || '').trim()
  if (!raw) return ''
  const upper = raw.toUpperCase()
  if (/^MY-\d{2}$/.test(upper)) return upper
  const slug = toEasyParcelState(raw)
  const match = MALAYSIA_STATES.find((s) => s.code === slug)
  return match?.iso || ''
}
