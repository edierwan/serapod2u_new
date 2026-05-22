export interface RoadtourRegistrationContext {
  token: string
  campaign_name: string
  account_manager_name: string
  org_id: string
  qr_code_id?: string | null
  campaign_id?: string | null
  account_manager_user_id?: string | null
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function sanitizeRoadtourRegistrationContext(value: unknown): RoadtourRegistrationContext | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Record<string, unknown>
  const token = normalizeOptionalString(raw.token)
  if (!token) return null

  return {
    token,
    campaign_name: normalizeOptionalString(raw.campaign_name) || 'RoadTour',
    account_manager_name: normalizeOptionalString(raw.account_manager_name) || '',
    org_id: normalizeOptionalString(raw.org_id) || '',
    qr_code_id: normalizeOptionalString(raw.qr_code_id),
    campaign_id: normalizeOptionalString(raw.campaign_id),
    account_manager_user_id: normalizeOptionalString(raw.account_manager_user_id),
  }
}