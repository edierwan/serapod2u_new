/** Malaysia states for Outdoor checkout / EasyParcel send_state. */

export const MALAYSIA_STATES = [
  { label: 'Johor', code: 'johor' },
  { label: 'Kedah', code: 'kedah' },
  { label: 'Kelantan', code: 'kelantan' },
  { label: 'Melaka', code: 'melaka' },
  { label: 'Negeri Sembilan', code: 'negeri-sembilan' },
  { label: 'Pahang', code: 'pahang' },
  { label: 'Penang', code: 'penang' },
  { label: 'Perak', code: 'perak' },
  { label: 'Perlis', code: 'perlis' },
  { label: 'Sabah', code: 'sabah' },
  { label: 'Sarawak', code: 'sarawak' },
  { label: 'Selangor', code: 'selangor' },
  { label: 'Terengganu', code: 'terengganu' },
  { label: 'Kuala Lumpur', code: 'kuala-lumpur' },
  { label: 'Labuan', code: 'labuan' },
  { label: 'Putrajaya', code: 'putrajaya' },
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
