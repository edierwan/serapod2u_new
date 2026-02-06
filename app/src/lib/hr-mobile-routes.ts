import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

/**
 * Catch-all deep-link handler for desktop HR routes on mobile.
 *
 * If a mobile user visits e.g. /hr/leave/requests, this catches routes
 * that have desktop equivalents and redirects to the nearest mobile screen.
 *
 * This file is a parallel route — it only activates for routes that
 * DON'T already have a dedicated page.tsx (existing desktop HR pages
 * take precedence because they have their own page.tsx files).
 *
 * NOTE: This is placed as a layout-level redirect component that can
 * be composed. Since existing desktop HR routes have explicit page.tsx
 * files, those will continue to work unchanged.
 */

const MOBILE_ROUTE_MAP: Record<string, string> = {
  'attendance': '/hr/mobile/attendance',
  'clock-in-out': '/hr/mobile/attendance',
  'timesheets': '/hr/mobile/attendance',
  'leave': '/hr/mobile/leave',
  'requests': '/hr/mobile/leave',
  'approval-flow': '/hr/mobile/leave',
  'payroll': '/hr/mobile/payslip',
  'payslips': '/hr/mobile/payslip',
  'salary-structure': '/hr/mobile/payslip',
  'profile': '/hr/mobile/profile',
}

/**
 * Given a desktop HR path, find the best mobile equivalent.
 */
export function getMobileRedirect(pathname: string): string | null {
  const segments = pathname.replace('/hr/', '').split('/')
  // Check from last segment backwards
  for (let i = segments.length - 1; i >= 0; i--) {
    const match = MOBILE_ROUTE_MAP[segments[i]]
    if (match) return match
  }
  return '/hr/mobile/home'
}
