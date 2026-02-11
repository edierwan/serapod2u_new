'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { PAYROLL_MAPPING_KEYS, CLAIMS_MAPPING_KEYS } from './types'
import type { HrGlMapping, GlAccountOption, HrAccountingConfig } from './types'

// ── Get auth context ─────────────────────────────────────────────

async function getAuthContext(supabase: any) {
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData?.user?.id) {
    return { success: false as const, error: 'Not authenticated' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, organization_id, roles(role_level)')
    .eq('id', authData.user.id)
    .single()

  if (profileError || !profile) {
    return { success: false as const, error: 'Failed to load user profile' }
  }

  return {
    success: true as const,
    data: {
      id: profile.id as string,
      organization_id: profile.organization_id as string | null,
      role_level: (profile.roles as any)?.role_level ?? null,
    },
  }
}

// ── Load HR Accounting Config ────────────────────────────────────

export async function getHrAccountingConfig(
  organizationId: string
): Promise<{ success: boolean; data?: HrAccountingConfig; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    // Get company_id via RPC
    const { data: companyId, error: companyError } = await supabase.rpc(
      'get_company_id',
      { p_org_id: organizationId }
    )

    if (companyError || !companyId) {
      return { success: false, error: 'Could not resolve company for this organization' }
    }

    // Load existing mappings
    const { data: mappings, error: mapError } = await supabase
      .from('hr_gl_mappings')
      .select('*')
      .eq('organization_id', organizationId)
      .in('document_type', ['PAYROLL_RUN', 'EXPENSE_CLAIM'])
      .order('document_type', { ascending: true })
      .order('mapping_key', { ascending: true })

    if (mapError) {
      console.error('Error loading HR GL mappings:', mapError)
      return { success: false, error: mapError.message }
    }

    // Load GL accounts for the company
    const { data: accounts, error: accError } = await supabase
      .from('gl_accounts')
      .select('id, code, name, account_type, subtype, is_active')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('code', { ascending: true })

    if (accError) {
      console.error('Error loading GL accounts:', accError)
      return { success: false, error: accError.message }
    }

    // Check if HR COA template accounts exist
    const hrCodes = ['6100', '2200', '2210', '2220', '2230', '2240', '2300']
    const hasCoaTemplate = hrCodes.every((code: string) =>
      (accounts || []).some((a: any) => a.code === code)
    )

    return {
      success: true,
      data: {
        mappings: (mappings || []) as HrGlMapping[],
        accounts: (accounts || []) as GlAccountOption[],
        hasCoaTemplate,
      },
    }
  } catch (error) {
    console.error('Error in getHrAccountingConfig:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ── Apply COA Template ───────────────────────────────────────────

export async function applyHrCoaTemplate(
  organizationId: string,
  template: string = 'SME_MY_PAYROLL_SPLIT'
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const supabase = (await createClient()) as any
    const ctx = await getAuthContext(supabase)
    if (!ctx.success || !ctx.data) return { success: false, error: ctx.error }

    if (ctx.data.role_level !== null && ctx.data.role_level > 20) {
      return { success: false, error: 'Insufficient permissions' }
    }

    // Resolve company_id
    const { data: companyId, error: companyError } = await supabase.rpc(
      'get_company_id',
      { p_org_id: organizationId }
    )

    if (companyError || !companyId) {
      return { success: false, error: 'Could not resolve company' }
    }

    // Call the template function
    const { data, error } = await supabase.rpc('apply_hr_coa_template', {
      p_company_id: companyId,
      p_template: template,
    })

    if (error) {
      console.error('Error applying COA template:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/hr')
    return { success: true, data }
  } catch (error) {
    console.error('Error in applyHrCoaTemplate:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ── Setup default mappings ───────────────────────────────────────

export async function setupDefaultHrGlMappings(
  organizationId: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const supabase = (await createClient()) as any
    const ctx = await getAuthContext(supabase)
    if (!ctx.success || !ctx.data) return { success: false, error: ctx.error }

    if (ctx.data.role_level !== null && ctx.data.role_level > 20) {
      return { success: false, error: 'Insufficient permissions' }
    }

    const { data, error } = await supabase.rpc('setup_hr_gl_mappings', {
      p_organization_id: organizationId,
    })

    if (error) {
      console.error('Error setting up HR GL mappings:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/hr')
    return { success: true, data }
  } catch (error) {
    console.error('Error in setupDefaultHrGlMappings:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ── Save individual mapping ──────────────────────────────────────

export async function saveHrGlMapping(
  organizationId: string,
  documentType: string,
  mappingKey: string,
  accountId: string | null,
  side: 'debit' | 'credit'
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = (await createClient()) as any
    const ctx = await getAuthContext(supabase)
    if (!ctx.success || !ctx.data) return { success: false, error: ctx.error }

    if (ctx.data.role_level !== null && ctx.data.role_level > 20) {
      return { success: false, error: 'Insufficient permissions' }
    }

    // Check if mapping exists
    const { data: existing } = await supabase
      .from('hr_gl_mappings')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('document_type', documentType)
      .eq('mapping_key', mappingKey)
      .maybeSingle()

    const updateFields =
      side === 'debit'
        ? { expense_account_id: accountId }
        : { offset_account_id: accountId }

    if (existing) {
      const { error } = await supabase
        .from('hr_gl_mappings')
        .update({ ...updateFields, updated_at: new Date().toISOString() })
        .eq('id', existing.id)

      if (error) return { success: false, error: error.message }
    } else {
      const { error } = await supabase.from('hr_gl_mappings').insert({
        organization_id: organizationId,
        document_type: documentType,
        mapping_key: mappingKey,
        ...updateFields,
        is_active: true,
      })

      if (error) return { success: false, error: error.message }
    }

    revalidatePath('/hr')
    return { success: true }
  } catch (error) {
    console.error('Error in saveHrGlMapping:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ── Validate all mappings complete ───────────────────────────────

export async function validateHrGlMappings(
  organizationId: string
): Promise<{ success: boolean; valid: boolean; missing: string[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const { data: mappings, error } = await supabase
      .from('hr_gl_mappings')
      .select('document_type, mapping_key, expense_account_id, offset_account_id')
      .eq('organization_id', organizationId)
      .eq('is_active', true)

    if (error) return { success: false, valid: false, missing: [], error: error.message }

    const missing: string[] = []

    // Check payroll required keys
    for (const pk of PAYROLL_MAPPING_KEYS) {
      if (!pk.required) continue
      const m = (mappings || []).find(
        (r: any) => r.document_type === 'PAYROLL_RUN' && r.mapping_key === pk.key
      )
      const accountId = pk.side === 'debit' ? m?.expense_account_id : m?.offset_account_id
      if (!m || !accountId) {
        missing.push(`Payroll: ${pk.label}`)
      }
    }

    // Check claims required keys
    for (const ck of CLAIMS_MAPPING_KEYS) {
      if (!ck.required) continue
      const m = (mappings || []).find(
        (r: any) => r.document_type === 'EXPENSE_CLAIM' && r.mapping_key === ck.key
      )
      const accountId = ck.side === 'debit' ? m?.expense_account_id : m?.offset_account_id
      if (!m || !accountId) {
        missing.push(`Claims: ${ck.label}`)
      }
    }

    return { success: true, valid: missing.length === 0, missing }
  } catch (error) {
    return {
      success: false,
      valid: false,
      missing: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
