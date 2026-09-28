import { NextResponse } from 'next/server'
import { requireSecurityActor } from '@/lib/security-access/admin-api'
import { ALL_ENFORCEMENT_READY_PERMISSIONS } from '@/lib/security-access/readiness'

export const dynamic = 'force-dynamic'

// Only these setting keys are shown; values are policy parameters, never secrets.
const VISIBLE_SETTINGS = [
  'lifecycle.sync_enabled', 'lifecycle.contractor_default_expiry_days', 'access_request.max_temporary_days',
  'access_request.pending_expiry_days', 'delegation.max_days', 'emergency_access.enabled',
  'emergency_access.mfa_step_up_available', 'emergency_access.max_minutes', 'legacy_authorization.read_only',
]

/**
 * Governance read model (security.audit.view): service identities (metadata
 * only — environment variable NAMES, never values; presence is reported as a
 * boolean), settings, readiness, parity evidence, authority policies and the
 * access change log.
 */
export async function GET() {
  const actor = await requireSecurityActor('security.audit.view')
  if (actor instanceof NextResponse) return actor
  const admin = actor.admin
  const [services, settings, changes, authority, parity, compat, readiness] = await Promise.all([
    admin.from('sa_service_identities').select('id,identity_key,name,purpose,identity_kind,owner_team,status,credential_type,credential_reference,scope_description,last_used_at,last_rotated_at,rotation_due_at').order('identity_kind').order('name'),
    admin.from('sa_settings').select('setting_key,setting_value,description,updated_at').in('setting_key', VISIBLE_SETTINGS),
    admin.from('sa_access_change_log').select('id,occurred_at,actor_id,actor_kind,action,target_user_id,entity_type,entity_id,details,reason').order('occurred_at', { ascending: false }).limit(200),
    admin.from('sa_authority_policies').select('id,policy_key,name,permission_key,document_type,organization_id,role_id,currency,min_amount,max_amount,max_variance_percent,status,effective_from,effective_until').order('policy_key'),
    admin.rpc('sa_shadow_parity_summary', { p_since: '30 days' }),
    admin.rpc('sa_compat_parity_report', { p_permission: null }),
    admin.from('sa_enforcement_readiness').select('permission_key,database_backstop,intentional_tightening,notes'),
  ])
  const credentialConfigured = (name: string | null) => (name ? Boolean(process.env[name]) : null)
  const compatRows: any[] = compat.error ? [] : compat.data || []
  return NextResponse.json({
    serviceIdentities: (services.data || []).map((s: any) => ({ ...s, credential_configured: credentialConfigured(s.credential_reference) })),
    settings: settings.data || [],
    accessChanges: changes.data || [],
    authorityPolicies: authority.data || [],
    shadowParity: parity.error ? [] : parity.data || [],
    compatParity: {
      checked: compatRows.length,
      legacyAllowNewDeny: compatRows.filter(r => r.classification === 'LEGACY_ALLOW_NEW_DENY').length,
      legacyDenyNewAllow: compatRows.filter(r => r.classification === 'LEGACY_DENY_NEW_ALLOW').length,
    },
    readiness: readiness.data || [],
    enforcementReadyInCode: ALL_ENFORCEMENT_READY_PERMISSIONS,
    emergencyAccess: {
      available: false,
      prerequisite: 'Multi-factor step-up (Supabase MFA, AAL2) must be enrolled for administrators and enforced by the application before emergency access can be enabled.',
    },
  })
}
