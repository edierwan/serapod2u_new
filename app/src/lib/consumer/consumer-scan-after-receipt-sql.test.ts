import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRE_WAREHOUSE_QR_STATUSES } from './qr-scan-eligibility'

const migrationsDir = path.resolve(__dirname, '../../../../supabase/migrations')
const sql = readFileSync(path.join(migrationsDir, '20260915120000_consumer_scan_after_first_warehouse_receipt.sql'), 'utf-8')
const source = readFileSync(path.join(migrationsDir, '20260813093000_buffer_qr_collect_points_eligible.sql'), 'utf-8')
const executable = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

function fn(name: string) {
  const start = executable.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = executable.indexOf('CREATE OR REPLACE FUNCTION', start + 10)
  return executable.slice(start, next === -1 ? undefined : next)
}

describe('consumer scan after first warehouse receipt — SQL', () => {
  it('introduces no table, column, index, constraint or QR status', () => {
    expect(executable).not.toMatch(/\b(ALTER|CREATE\s+TABLE|CREATE\s+INDEX|ADD\s+COLUMN|CONSTRAINT|CHECK\s*\(|CREATE\s+TYPE|DROP)\b/i)
    expect(executable.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2)
  })

  it.each(['consumer_collect_points', 'consumer_claim_gift'])('%s accepts pre-warehouse statuses only behind the receipt gate', (name) => {
    const body = fn(name)
    for (const status of PRE_WAREHOUSE_QR_STATUSES) expect(body).toContain(`'${status}'`)
    expect(body).toContain('v_pre_warehouse_statuses')
    expect(body).toMatch(/warehouse_receipt_items wri\s+WHERE wri\.order_id = v_qr_record\.order_id AND wri\.received_now > 0/)
    expect(body).toMatch(/qr_batches qb\s+WHERE qb\.order_id = v_qr_record\.order_id AND qb\.receiving_status = 'completed'/)
    // Existing accepted statuses remain.
    expect(body).toMatch(/v_valid_statuses\s+text\[\]\s*:=\s*ARRAY\[\s*'received_warehouse'/i)
  })

  it('keeps the existing consumer_collect_points signature, blocked list and buffer rule', () => {
    const body = fn('consumer_collect_points')
    expect(body).toContain("p_allow_dual_claim boolean DEFAULT true")
    expect(body).toContain('IF v_qr_record.status = ANY (v_blocked_statuses) THEN')
    expect(body).toContain('AND v_qr_record.status = ANY (v_buffer_statuses) THEN')
    // Everything after the status gate is byte-identical to the previous definition.
    const tail = (s: string) => s.slice(s.indexOf('IF NOT v_status_ok THEN'), s.indexOf('$$;', s.indexOf('IF NOT v_status_ok THEN')))
    expect(tail(body)).toBe(tail(source))
  })

  it('keeps the existing consumer_claim_gift signature and redemption logic', () => {
    const body = fn('consumer_claim_gift')
    expect(body).toContain('p_consumer_name text DEFAULT NULL::text, p_consumer_phone text DEFAULT NULL::text, p_consumer_email text DEFAULT NULL::text')
    expect(body).toContain('IF v_qr_record.is_redeemed THEN')
    expect(body).toContain("v_redemption_code := 'GFT-'")
  })

  it('is the latest migration touching these functions', () => {
    const later = readdirSync(migrationsDir).filter((f) => f > '20260915120000_consumer_scan_after_first_warehouse_receipt.sql' && f.endsWith('.sql'))
      .filter((f) => /consumer_(collect_points|claim_gift)/.test(readFileSync(path.join(migrationsDir, f), 'utf-8')))
    expect(later).toEqual([])
  })
})

describe('consumer scan routes reuse the shared receipt gate', () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, '../../app/api', p), 'utf-8')
  it.each(['consumer/collect-points/route.ts', 'consumer/collect-points-auth/route.ts'])('%s', (p) => {
    const src = read(p)
    expect(src).toContain('const scanStatus = await resolveConsumerScanStatus(supabaseAdmin, qrCodeData)')
    expect(src).toContain('isQrEligibleForCollectPoints({ status: scanStatus, isBuffer: isBufferFlag })')
  })
  it('verify/[code]/route.ts', () => {
    const src = read('verify/[code]/route.ts')
    expect(src).toContain('const scanStatus = await resolveConsumerScanStatus(supabaseAdmin, qrCode)')
    expect(src).toContain('!validStatuses.has(scanStatus)')
  })
})
