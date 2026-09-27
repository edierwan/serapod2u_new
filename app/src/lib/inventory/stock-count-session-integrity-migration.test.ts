import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), '../supabase/migrations/20260927160000_stock_count_session_integrity.sql'), 'utf8')
const executable = sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')

describe('Stock Count session integrity migration contract', () => {
  it('guards only API roles so the SECURITY DEFINER posting workflow is unchanged', () => {
    expect(executable.match(/if current_user not in \('anon', 'authenticated'\) then/g)).toHaveLength(2)
    expect(executable).not.toMatch(/language plpgsql\s+security definer/i)
    expect(executable).toContain("(select prosecdef from pg_proc where oid = 'public.stock_count_session_api_write_guard()'::regprocedure)")
  })

  it('limits API writes to drafts and makes non-draft sessions and items immutable', () => {
    expect(executable).toContain("raise exception 'stock_count_status_transition_not_allowed'")
    expect(executable).toContain("raise exception 'stock_count_posted_session_immutable'")
    expect(executable).toContain('before insert or update or delete on public.stock_count_sessions')
    expect(executable).toContain('before insert or update or delete on public.stock_count_session_items')
  })

  it('does not rewrite any Stock Count workflow function or migration mode', () => {
    expect(executable).not.toMatch(/create or replace function public\.(verify_and_post|prepare_stock_count|finalize_stock_count|discard_stock_count)/i)
    expect(executable).not.toMatch(/sa_migration_modes/i)
  })

  it('revokes TRUNCATE from API roles', () => {
    expect(executable).toContain('revoke truncate on table public.stock_count_sessions, public.stock_count_session_items from anon, authenticated')
  })
})
