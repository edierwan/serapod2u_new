import 'server-only'

interface KpiAuditInput {
    organizationId: string
    entityType: string
    entityId: string
    action: string
    oldValues?: any
    newValues?: any
    actorUserId: string
}

/**
 * Best-effort audit log writer. Failures here must NOT break the calling
 * mutation — they are logged to console and swallowed.
 */
export async function kpiAudit(supabase: any, input: KpiAuditInput) {
    try {
        await supabase.from('hr_kpi_audit_log').insert({
            organization_id: input.organizationId,
            entity_type: input.entityType,
            entity_id: input.entityId,
            action: input.action,
            old_values: input.oldValues ?? null,
            new_values: input.newValues ?? null,
            actor_user_id: input.actorUserId,
        })
    } catch (err) {
        console.error('[kpiAudit] failed:', err)
    }
}
