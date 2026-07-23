import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20260722_product_variant_kkm_certificates.sql', import.meta.url),
  'utf8',
)

describe('KKM certificate migration contract', () => {
  it('widens manual_sku without renaming or dropping the compatibility column', () => {
    expect(migration).toMatch(/alter column manual_sku type text/i)
    expect(migration).not.toMatch(/drop column manual_sku|rename column manual_sku/i)
  })

  it('keeps one metadata record per variant and cascades metadata cleanup', () => {
    expect(migration).toMatch(/product_variant_id uuid not null unique/i)
    expect(migration).toMatch(/references public\.product_variants\(id\) on delete cascade/i)
  })

  it('creates a private size- and MIME-restricted bucket', () => {
    expect(migration).toContain("'kkm-certificates'")
    expect(migration).toMatch(/'kkm-certificates',\s*'kkm-certificates',\s*false/i)
    expect(migration).toContain('10485760')
    expect(migration).toContain("array['application/pdf', 'image/jpeg', 'image/png']")
  })

  it('requires the category Vape flag and HQ admin access for mutations', () => {
    expect(migration.match(/pc\.is_vape is true/g)?.length).toBeGreaterThanOrEqual(4)
    expect(migration.match(/public\.is_hq_admin\(\)/g)?.length).toBeGreaterThanOrEqual(6)
    expect(migration).toContain('variant_kkm_certificates_admin_insert')
    expect(migration).toContain('kkm_certificates_storage_delete')
  })
})
