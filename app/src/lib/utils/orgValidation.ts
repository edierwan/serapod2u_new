/**
 * Organization Validation Utilities
 * 
 * Shared validation rules for org creation (manual + CSV import).
 * Includes org_code format checking, type-specific field rules,
 * and friendly error translation for DB constraint violations.
 */

import type { OrgType } from './orgHierarchy'

// ─── Constants ───────────────────────────────────────────────────
export const ORG_CODE_REGEX = /^[A-Z0-9\-]{3,20}$/
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const POSTAL_CODE_REGEX = /^\d{5}$/

export const ORG_CODE_PREFIX_MAP: Record<string, string> = {
  HQ: 'HQ',
  MANU: 'MN',
  MFG: 'MN',
  DIST: 'DT',
  WH: 'WH',
  SHOP: 'SH',
}

// ─── Field-level validation ─────────────────────────────────────

export interface FieldRule {
  required: boolean
  label: string
  hint?: string
}

/** Returns field validation rules specific to each org type */
export function getFieldRules(orgType: OrgType | string): Record<string, FieldRule> {
  const base: Record<string, FieldRule> = {
    org_type_code: { required: true, label: 'Organization Type' },
    org_code: { required: true, label: 'Organization Code', hint: 'Auto-generated based on type (3-20 uppercase alphanumeric chars)' },
    org_name: { required: true, label: 'Organization Name' },
  }

  switch (orgType) {
    case 'HQ':
      return {
        ...base,
        registration_no: { required: false, label: 'Registration Number', hint: 'Company registration (e.g. SSM)' },
        address: { required: false, label: 'Address', hint: 'HQ main address' },
      }
    case 'DIST':
      return {
        ...base,
        parent_org_id: { required: true, label: 'Parent HQ' },
        contact_name: { required: false, label: 'Contact Person', hint: 'Recommended for order communication' },
        contact_phone: { required: false, label: 'Contact Phone', hint: 'Recommended for delivery coordination' },
        address: { required: false, label: 'Address', hint: 'Warehouse / office address' },
      }
    case 'SHOP':
      return {
        ...base,
        parent_org_id: { required: true, label: 'Parent Distributor' },
        contact_phone: { required: false, label: 'Contact Phone', hint: 'Recommended — needed for WhatsApp notifications' },
        address: { required: false, label: 'Address', hint: 'Shop location for delivery' },
      }
    case 'WH':
      return {
        ...base,
        parent_org_id: { required: true, label: 'Parent Organization' },
        address: { required: true, label: 'Address', hint: 'Warehouse physical address (required for logistics)' },
      }
    case 'MFG':
    case 'MANU':
      return {
        ...base,
        contact_name: { required: false, label: 'Contact Person' },
        registration_no: { required: false, label: 'Registration Number' },
      }
    default:
      return base
  }
}

// ─── Org-code validation ────────────────────────────────────────

export function validateOrgCode(code: string): string | null {
  if (!code || !code.trim()) {
    return 'Organization code is required. Try re-selecting the organization type to auto-generate it.'
  }
  if (!ORG_CODE_REGEX.test(code)) {
    return `Organization code "${code}" is invalid. Must be 3-20 uppercase letters, digits, or hyphens (e.g. SH001).`
  }
  return null
}

// ─── Full form validation ───────────────────────────────────────

export interface OrgFormData {
  org_type_code: string
  org_code: string
  org_name: string
  parent_org_id?: string
  contact_email?: string
  postal_code?: string
  latitude?: string
  longitude?: string
  [key: string]: any
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateOrgForm(data: OrgFormData): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Required fields
  if (!data.org_type_code?.trim()) {
    errors.push('Organization type is required')
  }
  if (!data.org_name?.trim()) {
    errors.push('Organization name is required')
  }

  // Org code
  const codeErr = validateOrgCode(data.org_code)
  if (codeErr) errors.push(codeErr)

  // Email format
  if (data.contact_email && !EMAIL_REGEX.test(data.contact_email)) {
    errors.push('Invalid email format')
  }

  // Postal code format (Malaysian 5-digit)
  if (data.postal_code && !POSTAL_CODE_REGEX.test(data.postal_code)) {
    errors.push('Postal code must be exactly 5 digits')
  }

  // Latitude
  if (data.latitude) {
    const lat = parseFloat(data.latitude)
    if (isNaN(lat) || lat < -90 || lat > 90) {
      errors.push('Latitude must be between -90 and 90')
    }
  }

  // Longitude
  if (data.longitude) {
    const lon = parseFloat(data.longitude)
    if (isNaN(lon) || lon < -180 || lon > 180) {
      errors.push('Longitude must be between -180 and 180')
    }
  }

  // Type-specific warnings (soft validation)
  if (data.org_type_code) {
    const rules = getFieldRules(data.org_type_code)
    // Check required fields for this type
    for (const [field, rule] of Object.entries(rules)) {
      if (rule.required && !data[field]?.toString().trim()) {
        errors.push(`${rule.label} is required for ${getOrgTypeLabel(data.org_type_code)}`)
      }
    }
    // Soft checks (warnings)
    if (data.org_type_code === 'SHOP' && !data.contact_phone?.trim()) {
      warnings.push('Contact phone is recommended for WhatsApp notifications')
    }
    if ((data.org_type_code === 'SHOP' || data.org_type_code === 'WH') && !data.address?.trim()) {
      warnings.push('Address is recommended for delivery coordination')
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

function getOrgTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    HQ: 'Headquarters',
    MFG: 'Manufacturer',
    MANU: 'Manufacturer',
    DIST: 'Distributor',
    WH: 'Warehouse',
    SHOP: 'Shop',
  }
  return labels[type] || type
}

// ─── Friendly error translation ─────────────────────────────────

/** Maps raw DB / Supabase errors to user-friendly messages */
export function translateOrgError(error: { message?: string; code?: string; details?: string } | string): string {
  const msg = typeof error === 'string' ? error : (error.message || '')
  const code = typeof error === 'string' ? '' : (error.code || '')
  const details = typeof error === 'string' ? '' : (error.details || '')

  // org_code_format constraint
  if (msg.includes('org_code_format') || details.includes('org_code_format')) {
    return 'Organization code is missing or invalid. It must be 3-20 uppercase letters, digits, or hyphens (e.g. SH001). Try re-selecting the organization type to regenerate.'
  }

  // Unique violation on org_code
  if (code === '23505' && (msg.includes('org_code') || details.includes('org_code'))) {
    return 'This organization code already exists. Please try again — a new code will be generated.'
  }

  // General unique violation
  if (code === '23505') {
    return `A duplicate record was detected. ${details || msg}`
  }

  // Not-null violation
  if (code === '23502') {
    const match = msg.match(/column "(\w+)"/)
    const col = match ? match[1].replace(/_/g, ' ') : 'a required field'
    return `Missing required field: ${col}`
  }

  // Foreign key violation
  if (code === '23503') {
    if (msg.includes('parent_org_id')) {
      return 'Selected parent organization is invalid or has been deleted.'
    }
    if (msg.includes('state_id')) {
      return 'Selected state is invalid.'
    }
    return `Invalid reference: ${details || msg}`
  }

  // Check constraint violations
  if (code === '23514' || msg.includes('check constraint')) {
    if (msg.includes('org_code')) {
      return 'Organization code format is invalid. Must be 3-20 uppercase letters/digits/hyphens.'
    }
    return `Validation failed: ${details || msg}`
  }

  // Hierarchy errors (delegate to orgHierarchy parser)
  if (msg.includes('Headquarters') || msg.includes('HQ cannot have parent')) {
    return 'HQ organizations cannot report to another organization'
  }
  if (msg.includes('Distributor must report to HQ') || msg.includes('Distributor must have')) {
    return 'Distributors must report to an HQ organization'
  }
  if (msg.includes('Shop must report to Distributor') || msg.includes('Shop must have')) {
    return 'Shops must report to a Distributor'
  }
  if (msg.includes('Warehouse must report')) {
    return 'Warehouses must report to either HQ or a Distributor'
  }
  if (msg.includes('Cannot change to Shop') || msg.includes('has child organizations')) {
    return 'Cannot change to Shop type — this organization has child organizations that must be reassigned first'
  }
  if (msg.includes('incompatible child organizations')) {
    return 'Cannot change organization type — some child organizations are not compatible with the new type'
  }

  // RLS / permission errors
  if (code === '42501' || msg.includes('permission denied') || msg.includes('row-level security')) {
    return 'You do not have permission to perform this action. Please contact your administrator.'
  }

  // digest / extension errors
  if (msg.includes('function digest') || msg.includes('does not exist')) {
    return 'A database extension is misconfigured. Please contact support.'
  }

  return msg
}
