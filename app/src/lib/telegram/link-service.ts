import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSerappAccessDecision } from '@/lib/serapp/access'
import {
  TELEGRAM_LINK_TOKEN_LENGTH,
  TELEGRAM_LINK_TOKEN_TTL_MINUTES,
} from '@/lib/telegram/constants'
import type { TelegramLinkRow, TelegramLinkTokenRow, TelegramSessionJson } from '@/lib/telegram/types'

function generateLinkToken(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(TELEGRAM_LINK_TOKEN_LENGTH)
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')
}

export async function createTelegramLinkToken(userId: string): Promise<TelegramLinkTokenRow> {
  const admin = createAdminClient()
  const token = generateLinkToken()
  const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TOKEN_TTL_MINUTES * 60_000).toISOString()

  const { data, error } = await admin
    .from('telegram_link_tokens')
    .insert({
      user_id: userId,
      token,
      expires_at: expiresAt,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw Object.assign(new Error(error?.message || 'Failed to create link token.'), { status: 500 })
  }

  return data as TelegramLinkTokenRow
}

export async function getTelegramLinkByUserId(userId: string): Promise<TelegramLinkRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('telegram_links')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  return (data as TelegramLinkRow | null) || null
}

export async function getTelegramLinkByTelegramUserId(
  telegramUserId: number,
): Promise<TelegramLinkRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('telegram_links')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  return (data as TelegramLinkRow | null) || null
}

export async function consumeTelegramLinkToken(input: {
  token: string
  telegramUserId: number
  telegramChatId: number
  telegramUsername?: string | null
  telegramFirstName?: string | null
}): Promise<TelegramLinkRow> {
  const admin = createAdminClient()
  const normalized = input.token.trim().toUpperCase()
  if (!normalized) {
    throw Object.assign(new Error('Link code is required.'), { status: 400 })
  }

  const { data: tokenRow, error: tokenError } = await admin
    .from('telegram_link_tokens')
    .select('*')
    .eq('token', normalized)
    .is('consumed_at', null)
    .maybeSingle()

  if (tokenError) throw tokenError
  if (!tokenRow) {
    throw Object.assign(new Error('Invalid or expired link code. Generate a new one from Serapp.'), { status: 404 })
  }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error('Link code expired. Generate a new one from Serapp.'), { status: 410 })
  }

  const { data: userRow, error: userError } = await admin
    .from('users')
    .select(`
      id,
      organization_id,
      account_scope,
      organizations:organization_id ( id, org_name, org_type_code )
    `)
    .eq('id', tokenRow.user_id)
    .single()

  if (userError || !userRow?.organization_id) {
    throw Object.assign(new Error('Linked Serapod account not found.'), { status: 404 })
  }

  const organization = Array.isArray(userRow.organizations)
    ? userRow.organizations[0]
    : userRow.organizations

  const access = getSerappAccessDecision({
    accountScope: userRow.account_scope,
    orgTypeCode: organization?.org_type_code,
    organizationId: userRow.organization_id,
    roleLevel: null,
  })

  if (!access.allowed || !access.isDistributor) {
    throw Object.assign(
      new Error('Only distributor portal accounts can link Telegram for ordering.'),
      { status: 403 },
    )
  }

  const { data: existingForTelegram } = await admin
    .from('telegram_links')
    .select('id, user_id')
    .eq('telegram_user_id', input.telegramUserId)
    .eq('is_active', true)
    .maybeSingle()

  if (existingForTelegram && existingForTelegram.user_id !== tokenRow.user_id) {
    throw Object.assign(
      new Error('This Telegram account is already linked to another Serapod user.'),
      { status: 409 },
    )
  }

  const linkPayload = {
    user_id: tokenRow.user_id,
    organization_id: userRow.organization_id,
    telegram_user_id: input.telegramUserId,
    telegram_chat_id: input.telegramChatId,
    telegram_username: input.telegramUsername || null,
    telegram_first_name: input.telegramFirstName || null,
    is_active: true,
    linked_at: new Date().toISOString(),
    session_json: {},
  }

  const { data: link, error: linkError } = await admin
    .from('telegram_links')
    .upsert(linkPayload, { onConflict: 'user_id' })
    .select('*')
    .single()

  if (linkError || !link) {
    throw Object.assign(new Error(linkError?.message || 'Failed to save Telegram link.'), { status: 500 })
  }

  await admin
    .from('telegram_link_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', tokenRow.id)

  return link as TelegramLinkRow
}

export async function updateTelegramSession(
  linkId: string,
  session: TelegramSessionJson,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('telegram_links')
    .update({
      session_json: session,
      last_message_at: new Date().toISOString(),
    })
    .eq('id', linkId)

  if (error) throw error
}

export async function unlinkTelegramAccount(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('telegram_links')
    .delete()
    .eq('user_id', userId)

  if (error) throw error
}
