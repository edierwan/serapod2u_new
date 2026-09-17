import { createAdminClient } from '@/lib/supabase/admin'

const STATE_COOKIE = 'ep_oauth_state'
const TOKEN_ROW_ID = 1

export function getEasyParcelClientId() {
  return String(process.env.EASYPARCEL_CLIENT_ID || '').trim()
}

export function getEasyParcelClientSecret() {
  return String(process.env.EASYPARCEL_CLIENT_SECRET || '').trim()
}

export function getEasyParcelRedirectUri() {
  return String(
    process.env.EASYPARCEL_REDIRECT_URI ||
      'https://stg.serapod2u.com/api/shipping/easyparcel/oauth/callback',
  ).trim()
}

/** Public site origin — Coolify request.origin is 0.0.0.0 inside the container. */
export function getEasyParcelPublicOrigin() {
  const env = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  if (env && !/0\.0\.0\.0|127\.0\.0\.1/i.test(env)) return env
  try {
    return new URL(getEasyParcelRedirectUri()).origin
  } catch {
    return 'https://stg.serapod2u.com'
  }
}

export function getEasyParcelApiOrigin() {
  return String(process.env.EASYPARCEL_API_BASE || 'https://api.easyparcel.com').replace(/\/$/, '')
}

export function getEasyParcelApiVersion() {
  return String(process.env.EASYPARCEL_API_VERSION || '2026-06').trim()
}

export function isEasyParcelAppConfigured() {
  return Boolean(getEasyParcelClientId() && getEasyParcelClientSecret())
}

export function easyParcelAuthUrl(state: string) {
  const url = new URL(`${getEasyParcelApiOrigin()}/oauth/login`)
  url.searchParams.set('client_id', getEasyParcelClientId())
  url.searchParams.set('redirect_uri', getEasyParcelRedirectUri())
  url.searchParams.set('state', state)
  return url.toString()
}

export function oauthStateCookie(state: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`
}

export function clearOauthStateCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

export function readOauthStateCookie(cookieHeader: string | null) {
  const raw = String(cookieHeader || '')
  const match = raw.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${STATE_COOKIE}=`))
  return match ? decodeURIComponent(match.slice(STATE_COOKIE.length + 1)) : ''
}

type TokenRow = {
  access_token: string
  refresh_token: string
  access_expires_at: string | null
  refresh_expires_at: string | null
}

function basicAuthHeader() {
  const pair = `${getEasyParcelClientId()}:${getEasyParcelClientSecret()}`
  return `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`
}

async function exchangeToken(body: Record<string, string>) {
  const res = await fetch(`${getEasyParcelApiOrigin()}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.access_token) {
    const message = json?.message || json?.error_description || json?.error || `OAuth token HTTP ${res.status}`
    return { ok: false as const, error: String(message) }
  }
  return { ok: true as const, data: json }
}

async function saveTokens(json: any) {
  const admin: any = createAdminClient()
  const row = {
    id: TOKEN_ROW_ID,
    access_token: String(json.access_token),
    refresh_token: String(json.refresh_token || ''),
    access_expires_at: json.expires_at || null,
    refresh_expires_at: json.refresh_token_expires_at || null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await admin.from('easyparcel_oauth_tokens').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(error.message || 'Failed to save EasyParcel tokens')
}

export async function saveEasyParcelAuthorizationCode(code: string) {
  const result = await exchangeToken({
    grant_type: 'authorization_code',
    redirect_uri: getEasyParcelRedirectUri(),
    code,
  })
  if (!result.ok) return result
  await saveTokens(result.data)
  return { ok: true as const }
}

async function loadTokens(): Promise<TokenRow | null> {
  const admin: any = createAdminClient()
  const { data, error } = await admin
    .from('easyparcel_oauth_tokens')
    .select('access_token, refresh_token, access_expires_at, refresh_expires_at')
    .eq('id', TOKEN_ROW_ID)
    .maybeSingle()
  if (error) {
    console.error('[easyparcel] load tokens', error)
    return null
  }
  return data
}

export async function hasEasyParcelTokens() {
  const row = await loadTokens()
  return Boolean(row?.refresh_token || row?.access_token)
}

function isExpired(iso: string | null, skewMs = 60_000) {
  if (!iso) return true
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return true
  return ts - skewMs <= Date.now()
}

export async function getEasyParcelAccessToken(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  if (!isEasyParcelAppConfigured()) {
    return { ok: false, error: 'EasyParcel OpenAPI is not configured (missing client id/secret).' }
  }

  const row = await loadTokens()
  if (!row?.access_token && !row?.refresh_token) {
    return { ok: false, error: 'EasyParcel is not connected. Authorize the account from Outdoor fulfilment.' }
  }

  if (row.access_token && !isExpired(row.access_expires_at)) {
    return { ok: true, token: row.access_token }
  }

  if (!row.refresh_token) {
    return { ok: false, error: 'EasyParcel access expired. Reconnect from Outdoor fulfilment.' }
  }

  const refreshed = await exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
    redirect_uri: getEasyParcelRedirectUri(),
  })
  if (!refreshed.ok) return refreshed
  await saveTokens({
    ...refreshed.data,
    refresh_token: refreshed.data.refresh_token || row.refresh_token,
  })
  return { ok: true, token: String(refreshed.data.access_token) }
}
