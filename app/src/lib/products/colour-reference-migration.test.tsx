import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = path.resolve(process.cwd(), '../supabase/migrations/20260925120000_product_colour_reference.sql')

describe('product colour reference migration', () => {
  it('defines the constrained, RLS-protected reference table and deterministic seed', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.product_colour_reference')
    expect(sql).toContain("hex_code ~ '^#[0-9A-F]{6}$'")
    expect(sql).toContain('ALTER TABLE public.product_colour_reference ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('public.is_hq_admin()')
    expect(sql).toContain("('Royal Blue', '#4169E1', 65, 105, 225")
    expect((sql.match(/^  \('/gm) || []).length).toBe(139)
  })
})
