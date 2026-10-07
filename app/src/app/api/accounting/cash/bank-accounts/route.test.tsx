import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, any>
const db: Record<string, Row[]> = {}
const updates: Row[] = []

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let payload: Row | null = null
  const run = () => {
    const out = (db[table] ||= []).filter(r => filters.every(f => f(r)))
    if (payload) { updates.push({ table, ...payload }); out.forEach(r => Object.assign(r, payload)) }
    return out
  }
  const b: any = {
    select: () => b,
    update: (p: Row) => { payload = p; return b },
    eq: (c: string, v: any) => { filters.push(r => r[c] === v); return b },
    order: () => b,
    single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
    then: (resolve: any) => resolve({ data: run(), error: null }),
  }
  return b
}
const supabase = { auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) }, from: (t: string) => query(t) }
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))
vi.mock('@/lib/security-access/finance', () => ({ financeAllowed: vi.fn(async () => true) }))

const { PATCH } = await import('./route')
const patch = (body: Row) => PATCH(new Request('http://x/api/accounting/cash/bank-accounts', { method: 'PATCH', body: JSON.stringify(body) }))

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  updates.length = 0
  db.users = [{ id: 'user-1', organization_id: 'org-1', is_active: true, roles: { role_level: 10 } }]
  db.bank_accounts = [{ id: 'bank-1', company_id: 'org-1', account_name: 'Main', opening_balance: 0, opening_balance_date: null, statement_frequency: 'monthly', current_balance: 50 }]
})

describe('bank account opening balance lock', () => {
  it('lets Finance edit other fields and resend the unchanged opening balance', async () => {
    const res = await patch({ id: 'bank-1', account_name: 'Main HLB', opening_balance: 0, current_balance: 999, company_id: 'org-x' })
    expect(res.status).toBe(200)
    const sent = updates.find(u => u.table === 'bank_accounts')!
    expect(sent).toMatchObject({ account_name: 'Main HLB' })
    expect(sent).not.toHaveProperty('opening_balance')
    expect(sent).not.toHaveProperty('current_balance')
    expect(sent).not.toHaveProperty('company_id')
  })

  it('refuses an opening balance or date change by anyone but a Super Admin', async () => {
    expect((await patch({ id: 'bank-1', opening_balance: 3023152.33 })).status).toBe(403)
    expect((await patch({ id: 'bank-1', opening_balance_date: '2026-06-30' })).status).toBe(403)
    expect(db.bank_accounts[0].opening_balance).toBe(0)

    db.users[0].roles = { role_level: 1 }
    const res = await patch({ id: 'bank-1', opening_balance: 3023152.33, opening_balance_date: '2026-06-30' })
    expect(res.status).toBe(200)
    expect(db.bank_accounts[0]).toMatchObject({ opening_balance: 3023152.33, opening_balance_date: '2026-06-30' })
  })

  it('locks the statement frequency to Super Admin after creation', async () => {
    expect((await patch({ id: 'bank-1', statement_frequency: 'monthly' })).status).toBe(200) // unchanged value is fine
    const denied = await patch({ id: 'bank-1', statement_frequency: 'daily' })
    expect(denied.status).toBe(403)
    expect((await denied.json()).error).toMatch(/statement frequency/)
    expect((await patch({ id: 'bank-1', statement_frequency: 'weekly' })).status).toBe(400)
    db.users[0].roles = { role_level: 1 }
    expect((await patch({ id: 'bank-1', statement_frequency: 'daily' })).status).toBe(200)
    expect(db.bank_accounts[0].statement_frequency).toBe('daily')
  })

  it('validates the opening balance date format', async () => {
    db.users[0].roles = { role_level: 1 }
    expect((await patch({ id: 'bank-1', opening_balance_date: '30/06/2026' })).status).toBe(400)
  })
})
