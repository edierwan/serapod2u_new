import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeIdentityEmail, normalizeIdentityPhone } from './normalize'

const sqlSuite = readFileSync(
  resolve(process.cwd(), '..', 'supabase', 'tests', 'security', 'identity_foundation', '10_normalization_resolution.sql'),
  'utf8',
)
const migration = readFileSync(resolve(process.cwd(), '..', 'supabase', 'migrations', '20260929110000_identity_foundation.sql'), 'utf8')

/** Cases the database suite certifies: identity_normalize_<kind>('in'), 'out' | NULL::text */
function sqlCases(kind: 'email' | 'phone'): Array<[string, string | null]> {
  const re = new RegExp(`public\\.identity_normalize_${kind}\\('((?:[^']|'')*)'\\),\\s*(NULL::text|'((?:[^']|'')*)')`, 'g')
  return [...sqlSuite.matchAll(re)].map(m => [m[1].replace(/''/g, "'"), m[2] === 'NULL::text' ? null : m[3].replace(/''/g, "'")])
}

describe('identity email normalization', () => {
  it('trims and lowercases; rejects empty or malformed', () => {
    expect(normalizeIdentityEmail('  Foo.Bar@Example.COM ')).toBe('foo.bar@example.com')
    expect(normalizeIdentityEmail('not-an-email')).toBeNull()
    expect(normalizeIdentityEmail('   ')).toBeNull()
    expect(normalizeIdentityEmail(null)).toBeNull()
  })

  it('matches every case certified against the database function', () => {
    const cases = sqlCases('email')
    expect(cases.length).toBeGreaterThanOrEqual(3)
    for (const [input, expected] of cases) expect(normalizeIdentityEmail(input), input).toBe(expected)
  })
})

describe('identity phone normalization (strict E.164, Malaysia-aware, no guessing)', () => {
  it.each([
    ['0123456789', '+60123456789'],
    ['012-345 6789', '+60123456789'],
    ['(012) 345.6789', '+60123456789'],
    ['+60 12-345 6789', '+60123456789'],
    ['60123456789', '+60123456789'],
    ['01112345678', '+601112345678'],
    ['0312345678', '+60312345678'],
    ['+65 9123 4567', '+6591234567'],
    ['0065 9123 4567', '+6591234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeIdentityPhone(input)).toBe(expected)
  })

  it.each(['123456789', '6591234567', '012-ABC-6789', '+60 12', '+600123456789', '', '   ', '+', '0'])(
    'never guesses or accepts invalid input: %j',
    (input) => {
      expect(normalizeIdentityPhone(input)).toBeNull()
    },
  )

  it('matches every case certified against the database function', () => {
    const cases = sqlCases('phone')
    expect(cases.length).toBeGreaterThanOrEqual(10)
    for (const [input, expected] of cases) expect(normalizeIdentityPhone(input), input).toBe(expected)
  })

  it('agrees with the migration post-condition self-test', () => {
    const seg = migration.slice(migration.indexOf('postcondition: normalization self-test') - 700, migration.indexOf('postcondition: normalization self-test'))
    const checks = [...seg.matchAll(/identity_normalize_phone\('([^']*)'\) (<> '([^']*)'|is not null)/g)]
    expect(checks.length).toBeGreaterThanOrEqual(4)
    for (const c of checks) expect(normalizeIdentityPhone(c[1]), c[1]).toBe(c[3] ?? null)
  })
})
