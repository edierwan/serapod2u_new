import type { SupabaseClient } from '@supabase/supabase-js'

import {
    RECOVERY_TEMPLATES,
    type RecoveryPurpose,
    type RecoveryTemplate,
    getTemplateByKey,
    inferRecoveryTemplate,
} from '@/lib/wa-recovery/templates'

interface MessageTemplateRow {
    id: string
    code: string
    body: string
    channel: string
    is_active: boolean
    created_at?: string
}

const RECOVERY_TEMPLATE_KEYS = RECOVERY_TEMPLATES.map(template => template.key)

function cloneTemplate(template: RecoveryTemplate): RecoveryTemplate {
    return {
        ...template,
        variables: template.variables ? [...template.variables] : undefined,
    }
}

export async function loadRecoveryTemplates(
    supabaseAdmin: SupabaseClient,
    orgId: string,
): Promise<RecoveryTemplate[]> {
    const { data, error } = await (supabaseAdmin as any)
        .from('message_templates')
        .select('id, code, body, channel, is_active, created_at')
        .eq('org_id', orgId)
        .eq('channel', 'whatsapp')
        .in('code', RECOVERY_TEMPLATE_KEYS)

    if (error) {
        console.warn('[wa-recovery/template-store] load templates failed', error)
        return RECOVERY_TEMPLATES.map(cloneTemplate)
    }

    const byCode = new Map<string, MessageTemplateRow>(((data || []) as MessageTemplateRow[]).map(row => [row.code, row]))

    return RECOVERY_TEMPLATES.map((fallbackTemplate) => {
        const persisted = byCode.get(fallbackTemplate.key)
        if (!persisted) return cloneTemplate(fallbackTemplate)

        return {
            ...fallbackTemplate,
            body: persisted.body || fallbackTemplate.body,
            active: persisted.is_active,
            updated_at: persisted.created_at || fallbackTemplate.updated_at,
        }
    })
}

export function pickRecoveryTemplate(
    templates: RecoveryTemplate[],
    failedPurpose?: string | null,
    explicitTemplateKey?: string | null,
): RecoveryTemplate {
    if (explicitTemplateKey) {
        const explicit = templates.find(template => template.key === explicitTemplateKey)
        if (explicit) return explicit
        const builtin = getTemplateByKey(explicitTemplateKey)
        if (builtin) return cloneTemplate(builtin)
    }

    const inferred = inferRecoveryTemplate(failedPurpose)
    return templates.find(template => template.key === inferred.key) || cloneTemplate(inferred)
}

export async function saveRecoveryTemplate(
    supabaseAdmin: SupabaseClient,
    orgId: string,
    input: { key: RecoveryPurpose; body: string; isActive?: boolean },
): Promise<RecoveryTemplate> {
    const fallback = getTemplateByKey(input.key)
    if (!fallback) {
        throw new Error(`Unknown recovery template key: ${input.key}`)
    }

    const body = String(input.body || '').trim()
    if (!body) {
        throw new Error('Template body is required')
    }

    const { data: existing, error: existingError } = await (supabaseAdmin as any)
        .from('message_templates')
        .select('id, code, body, channel, is_active, created_at')
        .eq('org_id', orgId)
        .eq('channel', 'whatsapp')
        .eq('code', input.key)
        .maybeSingle()

    if (existingError) {
        throw new Error(existingError.message)
    }

    const isActive = input.isActive ?? true

    let row: MessageTemplateRow | null = null
    if (existing?.id) {
        const { data: updated, error: updateError } = await (supabaseAdmin as any)
            .from('message_templates')
            .update({ body, is_active: isActive })
            .eq('id', existing.id)
            .select('id, code, body, channel, is_active, created_at')
            .single()
        if (updateError) throw new Error(updateError.message)
        row = updated as MessageTemplateRow
    } else {
        const { data: inserted, error: insertError } = await (supabaseAdmin as any)
            .from('message_templates')
            .insert({
                org_id: orgId,
                channel: 'whatsapp',
                code: input.key,
                body,
                is_active: isActive,
            })
            .select('id, code, body, channel, is_active, created_at')
            .single()
        if (insertError) throw new Error(insertError.message)
        row = inserted as MessageTemplateRow
    }

    return {
        ...cloneTemplate(fallback),
        body: row.body,
        active: row.is_active,
        updated_at: row.created_at || fallback.updated_at,
    }
}