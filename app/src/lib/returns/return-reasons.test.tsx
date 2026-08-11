import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { DEFAULT_RETURN_REASONS } from '@/lib/returns/constants'

describe('return product reason master', () => {
  it('includes Authority Seizure and Packaging Change before Other', () => {
    const codes = DEFAULT_RETURN_REASONS.map((r) => r.code)
    expect(codes).toContain('authority_seizure')
    expect(codes).toContain('packaging_change')
    expect(codes.indexOf('authority_seizure')).toBeLessThan(codes.indexOf('other'))
    expect(codes.indexOf('packaging_change')).toBeLessThan(codes.indexOf('other'))
    expect(DEFAULT_RETURN_REASONS.find((r) => r.code === 'authority_seizure')?.label).toBe('Authority Seizure')
    expect(DEFAULT_RETURN_REASONS.find((r) => r.code === 'packaging_change')?.label).toBe('Packaging Change')
  })

  it('adds the two reasons via additive migration without dropping existing ones', () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), '../supabase/migrations/20260811090000_return_reasons_authority_packaging.sql'),
      'utf8',
    )
    expect(migration).toContain("('authority_seizure', 'Authority Seizure'")
    expect(migration).toContain("('packaging_change',  'Packaging Change'")
    expect(migration).toContain('ON CONFLICT (code) DO UPDATE')
    expect(migration).not.toContain('DROP TABLE')
    expect(migration).not.toContain('DELETE FROM public.return_reasons')
  })
})
