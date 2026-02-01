/**
 * Phone Normalization Utility
 * 
 * Handles phone number normalization to E.164 format
 * with special handling for Malaysian numbers.
 */

/**
 * Normalize a phone number to E.164 format
 * @param phone - Input phone number (any format)
 * @param defaultCountryCode - Default country code (default: '60' for Malaysia)
 * @returns Phone number in E.164 format (e.g., '+60123456789')
 */
export function normalizePhoneE164(phone: string, defaultCountryCode: string = '60'): string {
  if (!phone) return ''
  
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^0-9+]/g, '')
  
  // Remove leading + if present (we'll add it back)
  cleaned = cleaned.replace(/^\+/, '')
  
  // Handle Malaysian numbers
  if (cleaned.startsWith('0')) {
    // Local format: 0123456789 -> 60123456789
    cleaned = defaultCountryCode + cleaned.substring(1)
  } else if (/^1[0-9]{8,9}$/.test(cleaned)) {
    // Missing country code: 123456789 -> 60123456789
    cleaned = defaultCountryCode + cleaned
  }
  
  // Return with + prefix
  return '+' + cleaned
}

/**
 * Check if a phone number is valid Malaysian format
 * @param phone - Phone number to validate
 * @returns boolean indicating if phone is valid
 */
export function isValidMalaysianPhone(phone: string): boolean {
  const normalized = normalizePhoneE164(phone)
  // Malaysian mobile numbers: +601xxxxxxxx (9-10 digits after country code)
  // Malaysian landlines: +603xxxxxxxx, +604xxxxxxxx, etc.
  return /^\+60[1-9][0-9]{7,9}$/.test(normalized)
}

/**
 * Extract country code from E.164 phone number
 * @param phone - Phone number in E.164 format
 * @returns Country code without +
 */
export function extractCountryCode(phone: string): string {
  const normalized = normalizePhoneE164(phone)
  // Handle common country codes
  if (normalized.startsWith('+60')) return '60'
  if (normalized.startsWith('+1')) return '1'
  if (normalized.startsWith('+44')) return '44'
  if (normalized.startsWith('+65')) return '65'
  if (normalized.startsWith('+62')) return '62'
  if (normalized.startsWith('+66')) return '66'
  // Default: extract first 2-3 digits as country code
  const match = normalized.match(/^\+(\d{1,3})/)
  return match ? match[1] : ''
}

/**
 * Format phone number for display
 * @param phone - Phone number in any format
 * @returns Formatted phone string for display
 */
export function formatPhoneDisplay(phone: string): string {
  const normalized = normalizePhoneE164(phone)
  
  // Malaysian format: +60 12-345 6789
  if (normalized.startsWith('+60')) {
    const number = normalized.substring(3)
    if (number.length === 9) {
      return `+60 ${number.substring(0, 2)}-${number.substring(2, 5)} ${number.substring(5)}`
    } else if (number.length === 10) {
      return `+60 ${number.substring(0, 2)}-${number.substring(2, 6)} ${number.substring(6)}`
    }
  }
  
  // Default: just return normalized
  return normalized
}

/**
 * Convert WhatsApp JID to E.164 phone number
 * @param jid - WhatsApp JID (e.g., '60123456789@s.whatsapp.net')
 * @returns E.164 phone number
 */
export function jidToPhone(jid: string): string {
  if (!jid) return ''
  // Extract phone from JID format
  const phone = jid.split('@')[0].split(':')[0]
  return normalizePhoneE164(phone)
}

/**
 * Convert E.164 phone number to WhatsApp JID
 * @param phone - E.164 phone number
 * @returns WhatsApp JID
 */
export function phoneToJid(phone: string): string {
  const normalized = normalizePhoneE164(phone)
  // Remove + prefix for JID
  const number = normalized.replace(/^\+/, '')
  return `${number}@s.whatsapp.net`
}

/**
 * Compare two phone numbers (handles different formats)
 * @param phone1 - First phone number
 * @param phone2 - Second phone number
 * @returns boolean indicating if phones are the same
 */
export function phonesEqual(phone1: string, phone2: string): boolean {
  return normalizePhoneE164(phone1) === normalizePhoneE164(phone2)
}

/**
 * Mask phone number for privacy display
 * @param phone - Phone number
 * @returns Masked phone (e.g., +60 12-***-6789)
 */
export function maskPhone(phone: string): string {
  const normalized = normalizePhoneE164(phone)
  if (normalized.length < 8) return normalized
  
  const visible = 4
  const start = normalized.substring(0, normalized.length - visible - 3)
  const end = normalized.substring(normalized.length - visible)
  return `${start}***${end}`
}
