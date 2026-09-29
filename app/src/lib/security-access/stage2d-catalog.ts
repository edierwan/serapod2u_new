/**
 * Stage 2D permissions (deferred authorization closure). Seeded in SHADOW by
 * supabase/migrations/20260930100000_sa_stage2d_deferred_closure.sql, each with
 * a named business role backfilled to exactly the audience of today's legacy
 * rule (stage2d-catalog.test.ts keeps this list and the migration in step).
 * Until management enforces a key, the route's legacy evaluator decides.
 */
export interface Stage2dPermission {
  key: string
  role: string
  /** The legacy rule the route applied, reproduced by the backfill. */
  legacyRule: string
}

export const STAGE2D_PERMISSIONS: readonly Stage2dPermission[] = [
  { key: 'customer.support.administer', role: 'support-inbox-administrator', legacyRule: 'role_code SA / HQ / POWER_USER' },
  { key: 'customer.report.view', role: 'customer-report-viewer', legacyRule: 'role_code SA / HQ / POWER_USER' },
  { key: 'customer.messaging.manage', role: 'customer-messaging-manager', legacyRule: 'role_level <= 20' },
  { key: 'customer.banner.manage', role: 'storefront-banner-manager', legacyRule: 'HQ organization and role_level <= 30' },
  { key: 'manufacturing.adjustment.administer', role: 'adjustment-administrator', legacyRule: 'role_code SA' },
  { key: 'platform.user.profile_edit', role: 'profile-administrator', legacyRule: 'role_level 1 or 10' },
  { key: 'hr.employee.view_internal', role: 'hr-internal-directory-viewer', legacyRule: 'role_code MANAGER or role_level <= 50' },
  { key: 'customer.crm.view', role: 'crm-viewer', legacyRule: 'HQ organization and role_level <= 50' },
  { key: 'marketing.module.view', role: 'marketing-viewer', legacyRule: 'HQ organization and role_level <= 30' },
  { key: 'product.catalog.view', role: 'catalog-viewer', legacyRule: 'HQ / DIST / SHOP organization and role_level <= 50' },
  { key: 'ecommerce.module.view', role: 'ecommerce-viewer', legacyRule: 'HQ organization and role_level <= 30' },
  { key: 'ecommerce.outdoor.operate', role: 'outdoor-store-operator', legacyRule: 'role_code SA / HQ or role_level <= 10, or HQ organization and role_level <= 30' },
  { key: 'platform.notification_monitor.view', role: 'notification-monitor-viewer', legacyRule: 'internal employee, role_level <= 40, and (role_level <= 20 or HQ organization)' },
] as const

export const STAGE2D_PERMISSION_KEYS = STAGE2D_PERMISSIONS.map(p => p.key)
