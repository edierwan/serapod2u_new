/**
 * POST /api/admin/apply-password-reset-email-otp-migration
 *
 * Applies supabase/migrations/20260728_password_reset_email_otp.sql on the
 * connected Postgres (DATABASE_POOL_URL). Idempotent — safe to call twice.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>  OR  Super Admin via destructive-ops guard.
 */

import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertDestructiveOpsAllowed } from '@/lib/server/destructive-ops-guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function migrationSql(): string {
  const filePath = path.join(process.cwd(), '..', 'supabase', 'migrations', '20260728_password_reset_email_otp.sql')
  const fallback = path.join(process.cwd(), 'supabase', 'migrations', '20260728_password_reset_email_otp.sql')
  const resolved = fs.existsSync(filePath) ? filePath : fallback
  if (!fs.existsSync(resolved)) {
    throw new Error(`Migration file not found: ${resolved}`)
  }
  return fs.readFileSync(resolved, 'utf8')
}

function cronAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET || process.env.WORKER_SECRET
  if (!cronSecret) return false
  const auth = request.headers.get('authorization') || ''
  return auth === `Bearer ${cronSecret}`
}

export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) {
    const guard = await assertDestructiveOpsAllowed(request, 'apply-password-reset-email-otp-migration')
    if (guard.blocked) return guard.response
  }

  const poolUrl = process.env.DATABASE_POOL_URL || process.env.DATABASE_URL
  if (!poolUrl) {
    return NextResponse.json(
      { error: 'DATABASE_POOL_URL is not configured on this server.' },
      { status: 500 },
    )
  }

  const admin = createAdminClient()
  const probe = await admin.from('auth_verification_codes').select('email_normalized').limit(1)
  if (!probe.error) {
    const nt = await admin
      .from('notification_types')
      .select('event_code')
      .eq('event_code', 'password_reset_otp')
      .maybeSingle()
    return NextResponse.json({
      ok: true,
      alreadyApplied: true,
      message: 'email_normalized column exists; migration appears applied.',
      notificationType: nt.data?.event_code ?? null,
    })
  }

  if (!probe.error?.message?.includes('email_normalized')) {
    return NextResponse.json({ error: probe.error?.message || 'Schema probe failed' }, { status: 500 })
  }

  try {
    const pg = await import('pg')
    const client = new pg.default.Client({
      connectionString: poolUrl,
      ssl: poolUrl.includes('localhost') ? false : { rejectUnauthorized: false },
    })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query(migrationSql())
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      await client.end()
    }

    const verify = await admin.from('auth_verification_codes').select('email_normalized').limit(1)
    const nt = await admin
      .from('notification_types')
      .select('event_code, available_channels')
      .eq('event_code', 'password_reset_otp')
      .maybeSingle()

    return NextResponse.json({
      ok: true,
      alreadyApplied: false,
      message: 'Password reset email OTP migration applied.',
      emailColumn: verify.error ? verify.error.message : 'ok',
      notificationType: nt.data ?? nt.error,
    })
  } catch (err: any) {
    console.error('apply-password-reset-email-otp-migration failed:', err)
    return NextResponse.json(
      {
        error: 'Migration failed',
        details: err?.message || String(err),
        hint: 'Apply supabase/migrations/20260728_password_reset_email_otp.sql manually in Supabase SQL Editor.',
      },
      { status: 500 },
    )
  }
}
