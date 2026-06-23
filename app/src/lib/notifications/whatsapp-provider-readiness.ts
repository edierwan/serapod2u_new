export type WhatsAppProviderReadinessInput = {
  id?: string | null
  providerName?: string | null
  isActive?: boolean
  lastTestStatus?: string | null
  publicConfig?: Record<string, unknown> | null
  sensitiveConfig?: Record<string, unknown> | null
  baileysConnected?: boolean | null
}

export type WhatsAppProviderReadiness = {
  eligible: boolean
  reason: string | null
}

const valuePresent = (value: unknown) => typeof value === 'string'
  ? value.trim().length > 0
  : value !== null && value !== undefined

export function getWhatsAppProviderReadiness({
  id,
  providerName,
  isActive,
  lastTestStatus,
  publicConfig = {},
  sensitiveConfig = {},
  baileysConnected,
}: WhatsAppProviderReadinessInput): WhatsAppProviderReadiness {
  if (!id) return { eligible: false, reason: 'Save this provider configuration before setting it as default.' }
  if (!isActive) return { eligible: false, reason: 'Enable and save this provider before setting it as default.' }

  const publicValues = publicConfig || {}
  const sensitiveValues = sensitiveConfig || {}

  if (providerName === 'whatsapp_business') {
    if (!valuePresent(publicValues.phone_number_id)) {
      return { eligible: false, reason: 'Add and save the Meta Phone Number ID before setting this provider as default.' }
    }
    if (!valuePresent(sensitiveValues.access_token)) {
      return { eligible: false, reason: 'Add and save the Meta Permanent Access Token before setting this provider as default.' }
    }
    if (lastTestStatus !== 'success') {
      return { eligible: false, reason: 'Verify the Meta API connection successfully before setting this provider as default.' }
    }
    return { eligible: true, reason: null }
  }

  if (providerName === 'baileys' || providerName === 'baileys_home') {
    if (!valuePresent(publicValues.base_url)) {
      return { eligible: false, reason: 'Add and save the Baileys gateway URL before setting this provider as default.' }
    }
    if (!valuePresent(sensitiveValues.api_key)) {
      return { eligible: false, reason: 'Add and save the Baileys API key before setting this provider as default.' }
    }
    if (baileysConnected === false) {
      return { eligible: false, reason: 'Connect the Baileys WhatsApp session before setting this provider as default.' }
    }
    return { eligible: true, reason: null }
  }

  if (providerName === 'twilio') {
    if (!valuePresent(sensitiveValues.account_sid) || !valuePresent(sensitiveValues.auth_token) ||
      (!valuePresent(publicValues.from_number) && !valuePresent(publicValues.messaging_service_sid))) {
      return { eligible: false, reason: 'Complete and save the Twilio credentials and sender configuration before setting it as default.' }
    }
    return { eligible: true, reason: null }
  }

  if (providerName === 'messagebird') {
    if (!valuePresent(sensitiveValues.api_key) || !valuePresent(publicValues.channel_id)) {
      return { eligible: false, reason: 'Complete and save the MessageBird API key and channel ID before setting it as default.' }
    }
    return { eligible: true, reason: null }
  }

  return { eligible: false, reason: 'This WhatsApp provider cannot be used as the default provider.' }
}
