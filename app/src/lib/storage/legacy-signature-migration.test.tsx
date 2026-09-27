import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260928180000_legacy_signature_private_access.sql'),
  'utf8',
)

describe('legacy signature private access migration', () => {
  it('adds authenticated, SELECT-only compatibility without reopening buckets', () => {
    expect(sql).toMatch(/create policy documents_signature_select_own_legacy/i)
    expect(sql).toMatch(/for select to authenticated/i)
    expect(sql).not.toMatch(/to anon/i)
    expect(sql).not.toMatch(/set\s+public\s*=\s*true/i)
    expect(sql).not.toMatch(/for\s+(insert|update|delete)\s+to\s+authenticated/i)
  })

  it('derives the legacy filename owner from auth.uid and restricts its shape', () => {
    expect(sql).toContain("'^signatures/' || auth.uid()::text || '_[0-9]+[.][A-Za-z0-9]+$'")
    expect(sql).toContain("bucket_id = 'documents'")
  })

  it('retains private-bucket and current nested-policy postconditions', () => {
    expect(sql).toContain("id in ('documents', 'order-documents') and public")
    expect(sql).toContain("polname = 'documents_signature_select_own'")
    expect(sql).toContain("p.polroles = array['authenticated'::regrole::oid]")
    expect(sql).toContain('p.polqual is not null')
    expect(sql).not.toMatch(/select\s+pg_get_expr/i)
  })
})
