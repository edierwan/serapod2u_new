import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Phone validation result
 */
export interface PhoneValidationResult {
  isValid: boolean
  error?: string
  country?: 'MY' | 'CN'
  normalizedPhone?: string // E.164 format with + prefix
}

/**
 * Validate phone number for Malaysia or China telco formats
 * 
 * Malaysia formats:
 * - Mobile: 01x-xxx xxxx (10-11 digits after country code)
 *   - 010, 011, 012, 013, 014, 015, 016, 017, 018, 019
 * - With country code: +60, 60, or starting with 0
 * 
 * China formats:
 * - Mobile: 1xx xxxx xxxx (11 digits starting with 1)
 * - With country code: +86, 86, or starting with 1
 */
export function validatePhoneNumber(phone: string): PhoneValidationResult {
  if (!phone || phone.trim() === '') {
    return { isValid: true } // Phone is optional
  }
  
  // Remove all non-digit characters except + at the start
  const hasPlus = phone.startsWith('+')
  let cleaned = phone.replace(/\D/g, '')
  
  if (cleaned.length === 0) {
    return { 
      isValid: false, 
      error: 'Please enter a valid phone number' 
    }
  }
  
  // Detect country and validate format
  let country: 'MY' | 'CN' | undefined
  let normalizedPhone: string | undefined
  
  // Check for Malaysia format
  // +60, 60, or starts with 0
  if (cleaned.startsWith('60')) {
    country = 'MY'
    const localNumber = cleaned.substring(2) // Remove country code
    
    // Malaysian mobile numbers: 9-10 digits after country code (01x-xxxxxxx or 01x-xxxxxxxx)
    if (localNumber.length < 9 || localNumber.length > 10) {
      return {
        isValid: false,
        error: `Malaysian phone number must be 9-10 digits after country code. You entered ${localNumber.length} digits.`,
        country: 'MY'
      }
    }
    
    // Must start with 1 (mobile) after removing leading 0 or directly
    if (!localNumber.startsWith('1')) {
      return {
        isValid: false,
        error: 'Malaysian mobile number must start with 01 (e.g., 012, 013, 014...)',
        country: 'MY'
      }
    }
    
    normalizedPhone = `+${cleaned}`
    
  } else if (cleaned.startsWith('0') && cleaned.length >= 10 && cleaned.length <= 11) {
    // Malaysian format starting with 0
    country = 'MY'
    
    if (!cleaned.startsWith('01')) {
      return {
        isValid: false,
        error: 'Malaysian mobile number must start with 01 (e.g., 012, 013, 014...)',
        country: 'MY'
      }
    }
    
    // Convert to E.164: replace leading 0 with 60
    normalizedPhone = `+60${cleaned.substring(1)}`
    
  } else if (cleaned.startsWith('86')) {
    country = 'CN'
    const localNumber = cleaned.substring(2) // Remove country code
    
    // Chinese mobile numbers: 11 digits starting with 1
    if (localNumber.length !== 11) {
      return {
        isValid: false,
        error: `Chinese phone number must be 11 digits after country code. You entered ${localNumber.length} digits.`,
        country: 'CN'
      }
    }
    
    if (!localNumber.startsWith('1')) {
      return {
        isValid: false,
        error: 'Chinese mobile number must start with 1 (e.g., 13x, 15x, 18x...)',
        country: 'CN'
      }
    }
    
    normalizedPhone = `+${cleaned}`
    
  } else if (cleaned.startsWith('1') && cleaned.length === 11) {
    // Could be Chinese number without country code
    country = 'CN'
    
    // Validate Chinese mobile prefixes (13x, 14x, 15x, 16x, 17x, 18x, 19x)
    const prefix = cleaned.substring(0, 2)
    if (!['13', '14', '15', '16', '17', '18', '19'].includes(prefix)) {
      return {
        isValid: false,
        error: 'Chinese mobile number must start with 13, 14, 15, 16, 17, 18, or 19',
        country: 'CN'
      }
    }
    
    normalizedPhone = `+86${cleaned}`
    
  } else if (cleaned.startsWith('01') && cleaned.length >= 10 && cleaned.length <= 11) {
    // Malaysian format starting with 01
    country = 'MY'
    normalizedPhone = `+60${cleaned.substring(1)}`
    
  } else {
    // Unable to determine country
    return {
      isValid: false,
      error: 'Please enter a valid Malaysian (+60) or Chinese (+86) phone number. Malaysian: 01x-xxxxxxx, Chinese: 1xxxxxxxxxx'
    }
  }
  
  return {
    isValid: true,
    country,
    normalizedPhone
  }
}

/**
 * Normalize phone number to E.164 format for database storage
 * ALWAYS returns with + prefix for consistency
 * Handles both Malaysia (+60) and China (+86) formats
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  
  const result = validatePhoneNumber(phone)
  
  if (result.isValid && result.normalizedPhone) {
    // Always return WITH + prefix for E.164 standard
    return result.normalizedPhone.startsWith('+') ? result.normalizedPhone : `+${result.normalizedPhone}`
  }
  
  // Fallback to basic normalization for backwards compatibility
  let cleaned = phone.replace(/\D/g, '')
  
  // If it starts with '0', assume Malaysia and replace with '60'
  if (cleaned.startsWith('0')) {
    cleaned = '60' + cleaned.substring(1)
  }
  
  // Always return with + prefix
  return cleaned ? `+${cleaned}` : ''
}

/**
 * Format phone number for display
 */
export function formatPhoneDisplay(phone: string): string {
  if (!phone) return ''
  
  const result = validatePhoneNumber(phone)
  
  if (result.isValid && result.normalizedPhone) {
    if (result.country === 'MY') {
      // Format as +60 12-345 6789
      const digits = result.normalizedPhone.replace(/\D/g, '')
      if (digits.length >= 11) {
        return `+60 ${digits.substring(2, 4)}-${digits.substring(4, 7)} ${digits.substring(7)}`
      }
    } else if (result.country === 'CN') {
      // Format as +86 138 0000 0000
      const digits = result.normalizedPhone.replace(/\D/g, '')
      if (digits.length >= 13) {
        return `+86 ${digits.substring(2, 5)} ${digits.substring(5, 9)} ${digits.substring(9)}`
      }
    }
  }
  
  return phone
}