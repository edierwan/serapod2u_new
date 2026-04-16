import {
  formatPhoneDisplay as formatPhoneDisplayShared,
  isValidE164Phone,
  jidToPhone as jidToPhoneShared,
  maskPhone as maskPhoneShared,
  normalizePhoneToE164,
  parsePhone,
  phoneToJid as phoneToJidShared,
  samePhone,
  toProviderPhone,
} from '../../../shared/phone/index.js'

export { isValidE164Phone, parsePhone, samePhone, toProviderPhone }

export function normalizePhoneE164(phone: string, defaultCountryCode: string = '60'): string {
  return normalizePhoneToE164(phone, { defaultCountryCode }) || ''
}

export function isValidMalaysianPhone(phone: string): boolean {
  const normalized = normalizePhoneE164(phone)
  return /^\+60[1-9][0-9]{7,9}$/.test(normalized)
}

export function extractCountryCode(phone: string): string {
  const normalized = normalizePhoneE164(phone)
  const match = normalized.match(/^\+(\d{1,3})/)
  return match ? match[1] : ''
}

export function formatPhoneDisplay(phone: string): string {
  return formatPhoneDisplayShared(phone)
}

export function jidToPhone(jid: string): string {
  return jidToPhoneShared(jid) || ''
}

export function phoneToJid(phone: string): string {
  return phoneToJidShared(phone)
}

export function phonesEqual(phone1: string, phone2: string): boolean {
  return samePhone(phone1, phone2)
}

export function maskPhone(phone: string): string {
  return maskPhoneShared(phone)
}
