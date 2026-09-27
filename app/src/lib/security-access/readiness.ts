/**
 * Operations whose every reachable mutation path goes through
 * requireAuthorization() AND the database backstop, so switching them to
 * NEW_ENFORCED actually enforces. Anything not listed here is shadow-only
 * wiring: NEW_ENFORCED would not be reliably enforced for it.
 */
export const ENFORCEMENT_READY_PERMISSIONS: readonly string[] = ['inventory.stock_count.verify']

export function isEnforcementReady(permissionKey: string): boolean {
  return ENFORCEMENT_READY_PERMISSIONS.includes(permissionKey)
}
