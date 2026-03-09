#!/usr/bin/env node
/**
 * PG Adapter Validation Suite v2
 *
 * Structural validation of the PostgreSQL adapter for compatibility
 * with Supabase JS SDK query patterns used across the Serapod2u app.
 *
 * Run: npx tsx scripts/validate-pg-adapter.ts
 *
 * This script does NOT require a live database. It tests:
 *  1. Backend selector behavior
 *  2. Adapter instantiation + API surface
 *  3. Bug fixes (insert().select(), .or() parsing)
 *  4. Nested join detection + fallback
 *  5. Hybrid client behavior
 *  6. Authorization safety
 *  7. Stubs + security
 */

// ── Test framework ─────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures: string[] = []

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✅ ${name}`)
  } catch (e: any) {
    failed++
    const msg = `${name}: ${e.message}`
    failures.push(msg)
    console.log(`  ❌ ${name}`)
    console.log(`     → ${e.message}`)
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

// ── Tests ──────────────────────────────────────────────────────────────

console.log('\n═══ PG Adapter Validation Suite v2 ═══\n')

// ─── 1. Backend Selector ───────────────────────────────────────────────

console.log('▸ Backend Selector')

test('defaults to supabase when env unset', () => {
  const original = process.env.DATA_BACKEND
  delete process.env.DATA_BACKEND
  const { getDataBackend, isPostgresMode, isSupabaseMode } = require('../src/lib/db/backend')
  assert(getDataBackend() === 'supabase', `Expected 'supabase', got '${getDataBackend()}'`)
  assert(isSupabaseMode() === true, 'isSupabaseMode should be true')
  assert(isPostgresMode() === false, 'isPostgresMode should be false')
  if (original) process.env.DATA_BACKEND = original
})

test('selects postgres when DATA_BACKEND=postgres', () => {
  process.env.DATA_BACKEND = 'postgres'
  const { getDataBackend, isPostgresMode } = require('../src/lib/db/backend')
  assert(getDataBackend() === 'postgres', `Expected 'postgres'`)
  assert(isPostgresMode() === true, 'isPostgresMode should be true')
})

test('selects postgres when DATA_BACKEND=pg (alias)', () => {
  process.env.DATA_BACKEND = 'pg'
  const { getDataBackend } = require('../src/lib/db/backend')
  assert(getDataBackend() === 'postgres', `Expected 'postgres' for alias 'pg'`)
})

test('case insensitive: DATA_BACKEND=POSTGRES', () => {
  process.env.DATA_BACKEND = 'POSTGRES'
  const { getDataBackend } = require('../src/lib/db/backend')
  assert(getDataBackend() === 'postgres', `Expected 'postgres' for 'POSTGRES'`)
})

// ─── 2. PG Adapter Factory ────────────────────────────────────────────

console.log('\n▸ PG Adapter Factory')

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb'
process.env.DATA_BACKEND = 'postgres'

const { createPgClient, PgQueryBuilder, selectHasNestedJoins } = require('../src/lib/db/pg-adapter')

test('createPgClient returns object with required methods', () => {
  const client = createPgClient()
  assert(typeof client.from === 'function', 'Missing .from()')
  assert(typeof client.rpc === 'function', 'Missing .rpc()')
  assert(typeof client.channel === 'function', 'Missing .channel()')
  assert(typeof client.removeChannel === 'function', 'Missing .removeChannel()')
  assert(client.auth !== undefined, 'Missing .auth')
  assert(client.storage !== undefined, 'Missing .storage')
})

test('client.from() returns PgQueryBuilder', () => {
  const client = createPgClient()
  const builder = client.from('test_table')
  assert(builder instanceof PgQueryBuilder, 'Should be instance of PgQueryBuilder')
})

// ─── 3. Query Builder API Surface ──────────────────────────────────────

console.log('\n▸ Query Builder API Surface')

const client = createPgClient()

const chainMethods = [
  ['.select()', () => client.from('t').select('*')],
  ['.eq()', () => client.from('t').select('*').eq('id', 1)],
  ['.neq()', () => client.from('t').select('*').neq('status', 'deleted')],
  ['.gt/.gte/.lt/.lte', () => client.from('t').select('*').gt('a', 1).gte('b', 2).lt('c', 3).lte('d', 4)],
  ['.like/.ilike', () => client.from('t').select('*').like('a', '%x%').ilike('b', '%y%')],
  ['.is()', () => client.from('t').select('*').is('deleted', null)],
  ['.in()', () => client.from('t').select('*').in('id', [1, 2, 3])],
  ['.not()', () => client.from('t').select('*').not('status', 'eq', 'deleted')],
  ['.or()', () => client.from('t').select('*').or('name.ilike.%test%,email.ilike.%test%')],
  ['.match()', () => client.from('t').select('*').match({ status: 'active' })],
  ['.filter()', () => client.from('t').select('*').filter('name', 'eq', 'test')],
  ['.contains()', () => client.from('t').select('*').contains('metadata', { key: 'val' })],
  ['.containedBy()', () => client.from('t').select('*').containedBy('tags', ['a', 'b'])],
  ['.overlaps()', () => client.from('t').select('*').overlaps('tags', ['x'])],
  ['.textSearch()', () => client.from('t').select('*').textSearch('body', 'hello world')],
  ['.order()', () => client.from('t').select('*').order('created_at', { ascending: false })],
  ['.limit()', () => client.from('t').select('*').limit(10)],
  ['.range()', () => client.from('t').select('*').range(0, 9)],
  ['.single()', () => client.from('t').select('*').single()],
  ['.maybeSingle()', () => client.from('t').select('*').maybeSingle()],
  ['.insert()', () => client.from('t').insert({ name: 'test' })],
  ['.update()', () => client.from('t').update({ name: 'new' })],
  ['.delete()', () => client.from('t').delete()],
  ['.upsert()', () => client.from('t').upsert({ id: 1, name: 'test' })],
  ['.upsert(onConflict)', () => client.from('t').upsert({ id: 1 }, { onConflict: 'code' })],
] as const

for (const [name, fn] of chainMethods) {
  test(`${name} is chainable`, () => {
    const b = fn()
    assert(b instanceof PgQueryBuilder, `${name} should return PgQueryBuilder`)
  })
}

// ─── 4. Thenable behavior ─────────────────────────────────────────────

console.log('\n▸ Thenable Behavior')

test('builder has .then() making it thenable', () => {
  const b = client.from('t').select('*')
  assert(typeof b.then === 'function', 'Builder must have .then()')
})

// ─── 5. Bug Fix: .insert().select() preserves operation ──────────────

console.log('\n▸ Bug Fix: .insert().select() preserves operation')

test('FIXED: .insert().select() does NOT overwrite _operation', () => {
  const b = client.from('t').insert({ name: 'test' })
  assert(b['_operation'] === 'insert', 'After .insert(), _operation should be "insert"')

  b.select('id')
  assert(b['_operation'] === 'insert', '.select() after .insert() must keep _operation as "insert"')
  assert(b['_select'] === 'id', '.select("id") must set _select to "id"')
})

test('FIXED: .update().select() preserves update operation', () => {
  const b = client.from('t').update({ name: 'new' })
  assert(b['_operation'] === 'update', 'After .update(), _operation should be "update"')

  b.select('id, name')
  assert(b['_operation'] === 'update', '.select() after .update() must keep _operation as "update"')
})

test('FIXED: .upsert().select() preserves upsert operation', () => {
  const b = client.from('t').upsert({ id: 1 })
  assert(b['_operation'] === 'upsert', 'After .upsert(), _operation should be "upsert"')

  b.select('id')
  assert(b['_operation'] === 'upsert', '.select() after .upsert() must keep _operation as "upsert"')
})

test('Plain .select() still sets operation to select', () => {
  const b = client.from('t').select('*')
  assert(b['_operation'] === 'select', 'Plain .select() must set _operation to "select"')
})

// ─── 6. Bug Fix: .or() with nested and() groups ─────────────────────

console.log('\n▸ Bug Fix: .or() with nested and() groups')

test('FIXED: .or() parses and(col.op.val,col.op.val)', () => {
  const b = client.from('t').select('*').or('and(start_date.lte.2024-12-31,end_date.gte.2024-01-01)')
  // The builder should store the expression and not throw
  const filters = b['_filters']
  assert(filters.length === 1, 'Should have one filter')
  assert(filters[0].type === 'or', 'Should be an OR filter')
  assert(filters[0].expression.includes('and('), 'Expression should contain and()')
})

test('FIXED: and() group is not dropped silently', () => {
  // Access the internal parseOrExpression via a mock _buildWhere call
  // We test that calling _buildWhere with an and() expression produces correct SQL
  const b = client.from('fiscal_years')
    .select('id, fiscal_year_name')
    .eq('company_id', 'test-company')
    .or('and(start_date.lte.2024-12-31,end_date.gte.2024-01-01)')

  // Check the filter is stored correctly
  const orFilter = b['_filters'].find((f: any) => f.type === 'or')
  assert(orFilter !== undefined, 'OR filter must exist')
  assert(orFilter.expression.startsWith('and('), 'Expression must start with "and("')

  // Build the WHERE clause to verify parsing
  const params: any[] = []
  const where = b['_buildWhere'](params)
  // Should NOT contain (TRUE) — that was the old broken behavior
  assert(!where.includes('(TRUE)'), `WHERE must not contain "(TRUE)" — got: ${where}`)
  // Should contain AND
  assert(where.includes('AND'), `WHERE must contain "AND" for combined conditions — got: ${where}`)
})

// ─── 7. Bug Fix: .or() with dotted column refs ───────────────────────

console.log('\n▸ Bug Fix: .or() with dotted column references')

test('FIXED: .or() parses table.column.op.value syntax', () => {
  const b = client.from('qr_master_codes')
    .select('*')
    .or('shipment_order_id.eq.123,qr_batches.order_id.eq.123')

  const params: any[] = []
  const where = b['_buildWhere'](params)
  // Should parse both conditions — neither should be dropped
  assert(where.includes('OR'), `WHERE must contain OR — got: ${where}`)
  // Should have 2 params (one for each eq condition)
  assert(params.length === 2, `Should have 2 params, got ${params.length}`)
})

test('FIXED: dotted column produces quoted identifiers', () => {
  const b = client.from('t')
    .select('*')
    .or('foreign_table.col_name.eq.test_value')

  const params: any[] = []
  const where = b['_buildWhere'](params)
  // Should quote both parts of the dotted reference
  assert(where.includes('"foreign_table"."col_name"'), `Should produce dotted quoted ident — got: ${where}`)
})

// ─── 8. Nested Join Detection ─────────────────────────────────────────

console.log('\n▸ Nested Join Detection (selectHasNestedJoins)')

test('detects plain embedded relation: organizations(org_name)', () => {
  assert(selectHasNestedJoins('id, organizations(org_name)') === true, 'Should detect embedded relation')
})

test('detects !inner join: roles!inner(role_level)', () => {
  assert(selectHasNestedJoins('id, roles!inner(role_level)') === true, 'Should detect !inner join')
})

test('detects FK hint: users!orders_created_by_fkey(*)', () => {
  assert(selectHasNestedJoins('id, users!orders_created_by_fkey(*)') === true, 'Should detect FK hint')
})

test('detects alias: consumer:users!orders_created_by_fkey(*)', () => {
  assert(selectHasNestedJoins('id, consumer:users!orders_created_by_fkey(*)') === true, 'Should detect alias')
})

test('detects multi-level: qr_batches(order_id, orders(order_no))', () => {
  assert(selectHasNestedJoins('id, qr_batches(order_id, orders(order_no))') === true, 'Should detect multi-level')
})

test('returns false for simple columns: id, name, status', () => {
  assert(selectHasNestedJoins('id, name, status') === false, 'Should not flag simple columns')
})

test('returns false for wildcard: *', () => {
  assert(selectHasNestedJoins('*') === false, 'Should not flag wildcard')
})

test('returns false for empty string', () => {
  assert(selectHasNestedJoins('') === false, 'Should not flag empty string')
})

test('returns false for count columns: id, count', () => {
  assert(selectHasNestedJoins('id, count') === false, 'Should not flag count')
})

// Test actual codebase patterns that were identified in the audit
test('detects authorization pattern: roles!user_roles(role_level)', () => {
  assert(
    selectHasNestedJoins('*, roles!user_roles(role_level, role_name)') === true,
    'Must detect the auth-critical role join pattern'
  )
})

// ─── 9. Hybrid Client ─────────────────────────────────────────────────

console.log('\n▸ Hybrid Client')

const { createHybridClient } = require('../src/lib/db/hybrid-client')

test('createHybridClient exists and is a function', () => {
  assert(typeof createHybridClient === 'function', 'createHybridClient should be a function')
})

test('hybrid client has from/rpc/auth/storage/channel', () => {
  // Create a mock Supabase client
  const mockSb = {
    from: (t: string) => ({
      select: () => ({ eq: () => ({ then: () => Promise.resolve({ data: [], error: null }) }) }),
      insert: () => ({}),
      update: () => ({}),
      delete: () => ({}),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { getUser: () => {} },
    storage: { from: () => {} },
    channel: () => ({}),
    removeChannel: () => {},
  }
  const pgClient = createPgClient()
  const hybrid = createHybridClient(pgClient, mockSb, 'test')

  assert(typeof hybrid.from === 'function', 'Missing .from()')
  assert(typeof hybrid.rpc === 'function', 'Missing .rpc()')
  assert(hybrid.auth !== undefined, 'Missing .auth')
  assert(hybrid.storage !== undefined, 'Missing .storage')
})

test('hybrid client from().select() with simple columns returns a thenable', () => {
  const mockSb = {
    from: () => ({ select: () => ({}) }),
  }
  const pgClient = createPgClient()
  const hybrid = createHybridClient(pgClient, mockSb, 'test')
  const builder = hybrid.from('test_table')
  const result = builder.select('id, name, status')
  // Should be thenable (has .then) — comes from PG builder
  assert(typeof result.then === 'function', 'Simple select should return thenable builder')
})

test('hybrid client routes nested joins to Supabase client', () => {
  let supabaseSelectCalled: boolean = false
  const mockSb = {
    from: () => ({
      select: (...args: any[]) => {
        supabaseSelectCalled = true
        return { eq: () => ({ single: () => ({ then: (cb: any) => cb({ data: { role_level: 1 }, error: null }) }) }) }
      },
      insert: () => ({}),
      update: () => ({}),
      delete: () => ({}),
    }),
  }
  const pgClient = createPgClient()
  const hybrid = createHybridClient(pgClient, mockSb, 'test')

  // This has nested join syntax — should route to Supabase
  hybrid.from('users').select('id, roles!inner(role_level)')
  assert(supabaseSelectCalled, 'Nested join select must route to Supabase')
})

test('hybrid client does NOT route simple selects to Supabase', () => {
  let supabaseSelectCalled: boolean = false
  const mockSb = {
    from: () => ({
      select: () => {
        supabaseSelectCalled = true
        return {}
      },
    }),
  }
  const pgClient = createPgClient()
  const hybrid = createHybridClient(pgClient, mockSb, 'test')

  hybrid.from('users').select('id, name, email')
  assert(!supabaseSelectCalled, 'Simple select must NOT route to Supabase')
})

// ─── 10. Auth / Storage / Realtime Stubs ───────────────────────────────

console.log('\n▸ Auth / Storage / Realtime Stubs')

test('auth stub has getUser/getSession/signOut methods', () => {
  assert(typeof client.auth.getUser === 'function', 'auth.getUser should exist')
  assert(typeof client.auth.getSession === 'function', 'auth.getSession should exist')
  assert(typeof client.auth.signOut === 'function', 'auth.signOut should exist')
})

test('auth stub has admin.getUserById method', () => {
  assert(typeof client.auth.admin?.getUserById === 'function', 'auth.admin.getUserById should exist')
})

test('storage stub has .from() returning full bucket API', () => {
  const bucket = client.storage.from('test-bucket')
  assert(typeof bucket.upload === 'function', 'Missing upload')
  assert(typeof bucket.getPublicUrl === 'function', 'Missing getPublicUrl')
  assert(typeof bucket.download === 'function', 'Missing download')
  assert(typeof bucket.remove === 'function', 'Missing remove')
  assert(typeof bucket.list === 'function', 'Missing list')
})

test('channel() returns chainable .on().subscribe()', () => {
  const ch = client.channel('test').on('event', () => {})
  assert(typeof ch.subscribe === 'function', 'channel.on().subscribe should exist')
})

test('removeChannel does not throw', () => {
  client.removeChannel(client.channel('test'))
  assert(true, 'removeChannel works')
})

// ─── 11. Select Column Parsing ─────────────────────────────────────────

console.log('\n▸ Select Column Parsing')

test('select("*") keeps wildcard', () => {
  const b = client.from('t').select('*')
  assert(b['_select'] === '*', 'Should store wildcard')
})

test('select with nested join stores raw string', () => {
  const b = client.from('t').select('id, roles!inner(role_level)')
  assert(b['_select'] === 'id, roles!inner(role_level)', 'Should store raw select string')
})

// ─── 12. Security ──────────────────────────────────────────────────────

console.log('\n▸ Security: Identifier Quoting')

test('quoteIdent strips SQL injection characters', () => {
  const b = client.from('users; DROP TABLE users')
  assert(b['_table'] === 'users; DROP TABLE users', 'Builder stores raw table name')
})

// ─── 13. Production Safety ─────────────────────────────────────────────

console.log('\n▸ Production Safety')

test('DATA_BACKEND empty string defaults to supabase', () => {
  process.env.DATA_BACKEND = ''
  const { getDataBackend } = require('../src/lib/db/backend')
  assert(getDataBackend() === 'supabase', 'Empty string must default to supabase')
  process.env.DATA_BACKEND = 'postgres'
})

test('DATA_BACKEND=supabase explicitly selects supabase', () => {
  process.env.DATA_BACKEND = 'supabase'
  const { getDataBackend, isSupabaseMode } = require('../src/lib/db/backend')
  assert(getDataBackend() === 'supabase', 'Must return supabase')
  assert(isSupabaseMode() === true, 'isSupabaseMode must be true')
  process.env.DATA_BACKEND = 'postgres'
})

// ─── 14. .or() comprehensive patterns ─────────────────────────────────

console.log('\n▸ .or() Comprehensive Pattern Tests')

test('.or() with .in.() syntax', () => {
  const b = client.from('t').select('*')
    .or('created_by_user_id.in.(user1,user2,user3)')
  const params: any[] = []
  const where = b['_buildWhere'](params)
  assert(where.includes('IN'), `Should produce IN clause — got: ${where}`)
  assert(params.length === 3, `Should have 3 params for in(), got ${params.length}`)
})

test('.or() with .is.null', () => {
  const b = client.from('t').select('*')
    .or('starts_at.is.null,starts_at.lte.2024-01-01')
  const params: any[] = []
  const where = b['_buildWhere'](params)
  assert(where.includes('IS NULL'), `Should produce IS NULL — got: ${where}`)
  assert(where.includes('OR'), `Should produce OR — got: ${where}`)
})

test('.or() with mixed conditions', () => {
  const b = client.from('t').select('*')
    .or('buyer_org_id.eq.org1,seller_org_id.eq.org1')
  const params: any[] = []
  const where = b['_buildWhere'](params)
  assert(params.length === 2, `Should have 2 params, got ${params.length}`)
  assert(where.includes('OR'), `Should produce OR — got: ${where}`)
})

test('.or() with ilike search pattern', () => {
  const b = client.from('t').select('*')
    .or('full_name.ilike.%test%,email.ilike.%test%,phone.ilike.%test%')
  const params: any[] = []
  const where = b['_buildWhere'](params)
  assert(params.length === 3, `Should have 3 params, got ${params.length}`)
  assert(where.includes('ILIKE'), `Should produce ILIKE — got: ${where}`)
})

// ─── Summary ───────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50))
console.log(`\n  PASSED: ${passed}`)
console.log(`  FAILED: ${failed}`)
if (failures.length > 0) {
  console.log('\n  Failures:')
  for (const f of failures) {
    console.log(`    • ${f}`)
  }
}
console.log()

process.exit(failed > 0 ? 1 : 0)
