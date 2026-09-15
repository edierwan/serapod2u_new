/**
 * Minimal in-memory Supabase client for route/helper tests.
 *
 * Supports the PostgREST builder subset used by the warehouse receiving code:
 * select (incl. { count: 'exact', head: true }), eq, neq, gt/gte/lt/lte, is, in, order, limit, range,
 * single, maybeSingle, update(...).<filters>.select(), insert, and rpc().
 * Selected columns are ignored — full rows (with any embedded objects stored on
 * them) are returned.
 */
type Row = Record<string, any>
type Filter = (row: Row) => boolean

export interface FakeSupabase {
  tables: Record<string, Row[]>
  rpcCalls: { name: string; args: any }[]
  updates: { table: string; payload: Row; matched: number }[]
  inserts: { table: string; rows: number }[]
  ignoredFilters: string[]
  from: (table: string) => any
  rpc: (name: string, args: any) => Promise<{ data: any; error: any }>
  failOn?: (op: { table: string; kind: 'select' | 'update' | 'insert' }) => { message: string } | null
}

export function createFakeSupabase(
  tables: Record<string, Row[]>,
  rpcHandlers: Record<string, (args: any) => { data: any; error: any }> = {},
): FakeSupabase {
  const client: FakeSupabase = {
    tables,
    rpcCalls: [],
    updates: [],
    inserts: [],
    ignoredFilters: [],
    from(table: string) {
      return builder(client, table)
    },
    async rpc(name: string, args: any) {
      client.rpcCalls.push({ name, args })
      const handler = rpcHandlers[name]
      return handler ? handler(args) : { data: null, error: { message: `rpc ${name} not mocked` } }
    },
  }
  return client
}

function builder(client: FakeSupabase, table: string) {
  const filters: Filter[] = []
  let kind: 'select' | 'update' | 'insert' = 'select'
  let payload: Row | Row[] | null = null
  let head = false
  let wantCount = false
  let returnRows = false
  let limitN: number | null = null
  let rangeWindow: [number, number] | null = null
  let orderBy: { col: string; asc: boolean } | null = null
  let mode: 'many' | 'single' | 'maybeSingle' = 'many'

  const rows = () => (client.tables[table] ||= [])

  const run = () => {
    const failure = client.failOn?.({ table, kind })
    if (failure) return { data: null, error: failure, count: null }

    if (kind === 'insert') {
      const list = Array.isArray(payload) ? payload : [payload as Row]
      rows().push(...list.map((r) => ({ ...r })))
      client.inserts.push({ table, rows: list.length })
      return { data: returnRows ? list : null, error: null, count: null }
    }

    let matched = rows().filter((r) => filters.every((f) => f(r)))
    if (kind === 'update') {
      for (const r of matched) Object.assign(r, payload)
      client.updates.push({ table, payload: payload as Row, matched: matched.length })
      if (mode !== 'many') return { data: matched[0] ? { ...matched[0] } : null, error: null, count: matched.length }
      return { data: returnRows ? matched.map((r) => ({ ...r })) : null, error: null, count: matched.length }
    }

    if (orderBy) {
      const { col, asc } = orderBy
      matched = [...matched].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1))
    }
    const count = matched.length
    if (limitN !== null) matched = matched.slice(0, limitN)
    if (rangeWindow) matched = matched.slice(rangeWindow[0], rangeWindow[1] + 1)
    if (head) return { data: null, error: null, count }
    if (mode === 'single') {
      return matched.length === 1
        ? { data: matched[0], error: null, count }
        : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' }, count }
    }
    if (mode === 'maybeSingle') return { data: matched[0] ?? null, error: null, count }
    return { data: matched, error: null, count: wantCount ? count : null }
  }

  const b: any = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (kind === 'select') {
        head = !!opts?.head
        wantCount = !!opts?.count
      } else {
        returnRows = true
      }
      return b
    },
    update(p: Row) { kind = 'update'; payload = p; return b },
    insert(p: Row | Row[]) { kind = 'insert'; payload = p; return b },
    eq(col: string, val: any) { filters.push((r) => r[col] === val); return b },
    neq(col: string, val: any) { filters.push((r) => r[col] !== val); return b },
    gt(col: string, val: any) { filters.push((r) => r[col] > val); return b },
    gte(col: string, val: any) { filters.push((r) => r[col] >= val); return b },
    lt(col: string, val: any) { filters.push((r) => r[col] < val); return b },
    lte(col: string, val: any) { filters.push((r) => r[col] <= val); return b },
    is(col: string, val: any) { filters.push((r) => (r[col] ?? null) === val); return b },
    /** Accepted for chain compatibility but NOT applied (tests must not depend on them). */
    or(_expr: string) { client.ignoredFilters.push(`${table}.or`); return b },
    not(_col: string, _op: string, _val: any) { client.ignoredFilters.push(`${table}.not`); return b },
    ilike(_col: string, _val: string) { client.ignoredFilters.push(`${table}.ilike`); return b },
    range(from: number, to: number) { rangeWindow = [from, to]; return b },
    in(col: string, vals: any[]) { const set = new Set(vals); filters.push((r) => set.has(r[col])); return b },
    order(col: string, opts?: { ascending?: boolean }) { orderBy = { col, asc: opts?.ascending !== false }; return b },
    limit(n: number) { limitN = n; return b },
    single() { mode = 'single'; return Promise.resolve(run()) },
    maybeSingle() { mode = 'maybeSingle'; return Promise.resolve(run()) },
    then(resolve: (v: any) => unknown, reject?: (e: any) => unknown) {
      return Promise.resolve().then(run).then(resolve, reject)
    },
  }
  return b
}

/** Build qr_codes rows for a batch. */
export function makeQrCodes(
  batchId: string,
  spec: { count: number; status: string; isBuffer: boolean; variantId?: string; prefix?: string },
): Row[] {
  const prefix = spec.prefix || `${spec.isBuffer ? 'b' : 'u'}-${spec.status}`
  return Array.from({ length: spec.count }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(6, '0')}`,
    batch_id: batchId,
    variant_id: spec.variantId || 'variant-1',
    is_buffer: spec.isBuffer,
    status: spec.status,
  }))
}
