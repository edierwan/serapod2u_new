import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

describe('messaging partial fulfilment migration', () => {
  it('gates ready-to-ship on distributor accept when prepared qty is short', () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), '../supabase/migrations/20260810190000_messaging_partial_fulfilment.sql'),
      'utf8',
    )
    expect(migration).toContain('messaging_set_prepared_quantities')
    expect(migration).toContain('messaging_accept_partial')
    expect(migration).toContain('awaiting_partial_confirmation')
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.messaging_ready_to_ship')
    expect(migration).toContain('messaging_apply_prepared_quantities')
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.orders_approve')
  })
})
