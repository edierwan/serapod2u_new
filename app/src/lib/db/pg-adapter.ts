/**
 * PostgreSQL Query Builder — Supabase-Compatible Adapter
 *
 * Mimics the Supabase JS SDK query builder API so existing app code
 * works unchanged when the backend is switched to direct PostgreSQL.
 *
 * Supported patterns:
 *   client.from('table').select('*').eq('id', x).single()
 *   client.from('table').insert({ ... }).select('id')
 *   client.from('table').update({ ... }).eq('id', x)
 *   client.from('table').delete().eq('id', x)
 *   client.from('table').upsert({ ... }, { onConflict: 'col' })
 *   client.rpc('function_name', { param1: val1 })
 *   client.from('table').select('id', { count: 'exact', head: true })
 *   .or('and(start_date.lte.X,end_date.gte.Y)')  — nested and()
 *   .or('foreign_table.col.eq.X')                 — dotted column refs
 *
 * Nested FK joins (e.g. `roles!user_roles(role_level)`):
 *   Detected automatically. When DATA_BACKEND=postgres and a query uses
 *   unsupported relational select syntax, the query is automatically
 *   routed to the Supabase client via the fallback mechanism. This
 *   prevents silent partial data — every query either fully runs on
 *   PostgreSQL or fully runs on Supabase.
 *
 * Limitations (Phase 1):
 *   - No RLS enforcement (use PostgreSQL roles/policies if needed).
 *   - Realtime subscriptions (.channel/.on) are not supported. Those remain
 *     on Supabase even in hybrid mode.
 *
 * This module is server-side only. Never import it in client components.
 */

import type { Pool, PoolConfig, QueryResult } from 'pg'

// ── Lazy pg module loader ────────────────────────────────────────────────
// Uses an indirect require to prevent bundlers (webpack/turbopack) from
// statically analyzing and pulling 'pg' into client component bundles.
// The `type` import above is erased at compile time (types-only).
let _pg: typeof import('pg') | null = null
function loadPg(): typeof import('pg') {
  if (!_pg) {
    // Indirect require: prevents turbopack/webpack static analysis
    // eslint-disable-next-line no-eval
    const dynamicRequire = eval('require') as NodeRequire
    _pg = dynamicRequire('pg')
  }
  return _pg!
}

// ── Connection Pool (singleton) ──────────────────────────────────────────

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.DATABASE_POOL_URL
    if (!connectionString) {
      throw new Error(
        '[PgAdapter] Missing DATABASE_URL or DATABASE_POOL_URL. ' +
        'Set one of these env vars to use the PostgreSQL backend.'
      )
    }

    const config: PoolConfig = {
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      // Disable SSL for local/Docker connections; enable (permissive) for external
      ssl: (() => {
        if (connectionString.includes('sslmode=disable')) return false
        // Extract hostname from connection string
        const hostMatch = connectionString.match(/@([^:/?]+)/)
        const host = hostMatch?.[1] || ''
        // Docker hostnames, localhost, private IPs don't need SSL
        if (host === 'localhost' || host === '127.0.0.1' || !host.includes('.')) return false
        return { rejectUnauthorized: false }
      })(),
    }

    const { Pool: PgPool } = loadPg()
    pool = new PgPool(config)

    pool.on('error', (err) => {
      console.error('[PgAdapter] Unexpected pool error:', err.message)
    })
  }
  return pool
}

/** Graceful shutdown — call on process exit */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

// ── Types ────────────────────────────────────────────────────────────────

interface PgResult<T = any> {
  data: T | null
  error: PgError | null
  count: number | null
  status: number
  statusText: string
}

interface PgError {
  message: string
  details?: string
  hint?: string
  code?: string
}

type FilterOp = {
  column: string
  op: string
  value: any
}

type OrFilter = {
  type: 'or'
  expression: string
}

type OrderSpec = {
  column: string
  ascending: boolean
  nullsFirst?: boolean
}

interface SelectOptions {
  count?: 'exact' | 'planned' | 'estimated'
  head?: boolean
}

// ── Supabase .or() expression parser ─────────────────────────────────────

/**
 * Parse Supabase-style .or() filter expressions into SQL WHERE conditions.
 *
 * Input:  "full_name.ilike.%test%,email.ilike.%test%,status.eq.active"
 * Output: "(full_name ILIKE $1 OR email ILIKE $2 OR status = $3)"
 */
function parseOrExpression(
  expr: string,
  params: any[],
  paramOffset: number
): { sql: string; newParams: any[]; paramCount: number } {
  const parts: string[] = []
  const newParams: any[] = []

  // Split on commas but handle nested parentheses for .in.()
  const conditions = splitOrConditions(expr)

  for (const cond of conditions) {
    const parsed = parseSingleCondition(cond.trim(), params.length + newParams.length + paramOffset)
    if (parsed) {
      parts.push(parsed.sql)
      newParams.push(...parsed.params)
    }
  }

  return {
    sql: parts.length > 0 ? `(${parts.join(' OR ')})` : '(TRUE)',
    newParams,
    paramCount: newParams.length,
  }
}

/** Split .or() expression respecting parentheses (for .in.(...)) */
function splitOrConditions(expr: string): string[] {
  const results: string[] = []
  let current = ''
  let depth = 0

  for (const ch of expr) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      results.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) results.push(current)
  return results
}

/** Parse a single filter condition like "full_name.ilike.%test%" */
function parseSingleCondition(
  cond: string,
  paramIdx: number
): { sql: string; params: any[] } | null {
  // Handle nested and(...) groups: and(col1.op.val,col2.op.val)
  const andMatch = cond.match(/^and\((.+)\)$/)
  if (andMatch) {
    const inner = splitOrConditions(andMatch[1])
    const andParts: { sql: string; params: any[] }[] = []
    let idx = paramIdx
    for (const c of inner) {
      const parsed = parseSingleCondition(c.trim(), idx)
      if (parsed) {
        andParts.push(parsed)
        idx += parsed.params.length
      }
    }
    if (andParts.length === 0) return null
    return {
      sql: `(${andParts.map((p) => p.sql).join(' AND ')})`,
      params: andParts.flatMap((p) => p.params),
    }
  }

  // Handle .in.(...) syntax — supports dotted table.col references
  const inMatch = cond.match(/^([\w.]+)\.in\.\((.+)\)$/)
  if (inMatch) {
    const col = quoteIdentDotted(inMatch[1])
    const vals = inMatch[2].split(',').map((v) => v.trim())
    const placeholders = vals.map((_, i) => `$${paramIdx + i + 1}`)
    return {
      sql: `${col} IN (${placeholders.join(', ')})`,
      params: vals,
    }
  }

  // Handle .is.null / .is.true / .is.false — supports dotted refs
  const isMatch = cond.match(/^([\w.]+)\.is\.(null|true|false)$/i)
  if (isMatch) {
    const col = quoteIdentDotted(isMatch[1])
    const val = isMatch[2].toLowerCase()
    if (val === 'null') return { sql: `${col} IS NULL`, params: [] }
    if (val === 'true') return { sql: `${col} IS TRUE`, params: [] }
    return { sql: `${col} IS FALSE`, params: [] }
  }

  // Handle standard ops: col.op.value (or table.col.op.value)
  const stdMatch = cond.match(/^([\w]+(?:\.[\w]+)??)\.(eq|neq|gt|gte|lt|lte|like|ilike)\.(.+)$/)
  if (stdMatch) {
    const col = quoteIdentDotted(stdMatch[1])
    const op = stdMatch[2]
    const val = stdMatch[3]
    const sqlOp = mapOp(op)
    return {
      sql: `${col} ${sqlOp} $${paramIdx + 1}`,
      params: [val],
    }
  }

  // Handle negation: not.col.op.value (or not.table.col.op.value)
  const notMatch = cond.match(/^not\.([\w]+(?:\.[\w]+)??)\.(eq|neq|gt|gte|lt|lte|like|ilike)\.(.+)$/)
  if (notMatch) {
    const col = quoteIdentDotted(notMatch[1])
    const op = notMatch[2]
    const val = notMatch[3]
    const sqlOp = mapOp(op)
    return {
      sql: `NOT (${col} ${sqlOp} $${paramIdx + 1})`,
      params: [val],
    }
  }

  console.warn(`[PgAdapter] Unparseable .or() condition: ${cond}`)
  return null
}

function mapOp(op: string): string {
  const ops: Record<string, string> = {
    eq: '=',
    neq: '!=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    like: 'LIKE',
    ilike: 'ILIKE',
  }
  return ops[op] || '='
}

// ── Identifier quoting ───────────────────────────────────────────────────

/** Quote a SQL identifier to prevent injection. Only allows alphanumeric + underscores. */
function quoteIdent(name: string): string {
  // Strip anything that isn't alphanumeric, underscore, or dot
  const cleaned = name.replace(/[^a-zA-Z0-9_.]/g, '')
  if (cleaned !== name) {
    console.warn(`[PgAdapter] Sanitized identifier: "${name}" → "${cleaned}"`)
  }
  return `"${cleaned}"`
}

/** Quote a possibly-dotted identifier like "table.column" → "table"."column" */
function quoteIdentDotted(name: string): string {
  if (name.includes('.')) {
    return name.split('.').map(quoteIdent).join('.')
  }
  return quoteIdent(name)
}

/** Parse select columns — strip foreign key join syntax */
function parseSelectColumns(select: string): string[] {
  if (select === '*') return ['*']

  const cols: string[] = []
  let depth = 0
  let current = ''

  for (const ch of select) {
    if (ch === '(') { depth++; continue }
    if (ch === ')') { depth--; continue }
    if (depth > 0) continue // skip nested join definitions

    if (ch === ',') {
      const col = current.trim()
      if (col) cols.push(col)
      current = ''
    } else {
      current += ch
    }
  }

  const last = current.trim()
  if (last) cols.push(last)

  // Clean up: remove alias hints like "roles!inner" → ignore
  return cols
    .map((c) => c.split('!')[0].trim()) // strip "table!fkey" syntax
    .filter((c) => {
      // Keep actual column references only (alphanumeric + underscores + *)
      // Skip what looks like a table name for a join
      return /^[\w*]+$/.test(c)
    })
}

/**
 * Detect whether a select string contains Supabase relational/FK join syntax.
 *
 * Returns true if the select uses any of:
 *   - Embedded relation: "relation_name(col1, col2)"
 *   - FK hint: "relation!fk_name(col)"
 *   - Inner join: "relation!inner(col)"
 *   - Alias: "alias:relation!fk(col)"
 *
 * This is used to trigger automatic Supabase fallback in PG mode.
 */
export function selectHasNestedJoins(select: string): boolean {
  if (!select || select === '*') return false
  // Match: word( or word!word( or word:word( or word:word!word(
  return /[\w]\s*\(/.test(select) || /!\w+/.test(select) || /\w+:\w+/.test(select)
}

// ── FK Relationship Cache ────────────────────────────────────────────────

interface FkRelation {
  source_table: string
  source_column: string
  target_table: string
  target_column: string
}

let _fkCache: FkRelation[] | null = null
let _fkCacheTime = 0
const FK_CACHE_TTL = 60_000 // 60 seconds

async function getFkRelations(pgPool: Pool): Promise<FkRelation[]> {
  if (_fkCache && (Date.now() - _fkCacheTime) < FK_CACHE_TTL) return _fkCache
  try {
    const result = await pgPool.query(`
      SELECT
        kcu.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_name AS target_table,
        ccu.column_name AS target_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    `)
    _fkCache = result.rows
    _fkCacheTime = Date.now()
  } catch (err) {
    console.error('[PgAdapter] Failed to load FK relations:', err)
    _fkCache = []
  }
  return _fkCache!
}

/** Clear FK cache (useful when schema changes) */
export function clearFkCache(): void { _fkCache = null }

// ── Embed Types & Parser ─────────────────────────────────────────────────

interface EmbedSpec {
  alias: string       // Property name in result
  table: string       // Actual table to query
  fkHint?: string     // Explicit FK hint (e.g., "user_roles" in roles!user_roles)
  innerJoin: boolean  // !inner hint
  selectStr: string   // Raw sub-select string (may contain nested embeds)
}

interface ParsedSelect {
  baseColumns: string[]
  embeds: EmbedSpec[]
}

/**
 * Parse a Supabase-style select string into base columns and embedded relations.
 *
 * Examples:
 *   "*, organization(name)"
 *     → baseColumns: ['*'], embeds: [{ alias: 'organization', table: 'organization', selectStr: 'name' }]
 *
 *   "id, items:order_items(*, product:products(name))"
 *     → baseColumns: ['id'], embeds: [{ alias: 'items', table: 'order_items', selectStr: '*, product:products(name)' }]
 */
function parseSelectWithEmbeds(select: string): ParsedSelect {
  const baseColumns: string[] = []
  const embeds: EmbedSpec[] = []

  // Split at top-level commas (depth 0)
  const parts: string[] = []
  let depth = 0, current = ''
  for (const ch of select) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())

  for (const part of parts) {
    // Match embed: [alias:]table[!hint](sub-select)
    const m = part.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\((.+)\)$/s)
    if (m) {
      embeds.push({
        alias: m[1] || m[2],
        table: m[2],
        fkHint: m[3],
        innerJoin: m[3] === 'inner',
        selectStr: m[4],
      })
    } else {
      // Regular column — strip !hint syntax
      const col = part.replace(/!\w+/g, '').trim()
      if (col && /^[\w*.:]+$/.test(col)) {
        baseColumns.push(col)
      }
    }
  }

  return { baseColumns, embeds }
}

// ── FK Resolver ──────────────────────────────────────────────────────────

interface ResolvedFk {
  direction: 'forward' | 'reverse'
  fkTable: string       // Table that has the FK column
  fkColumn: string      // FK column name
  pkTable: string       // Referenced table
  pkColumn: string      // Referenced PK column
  junctionTable?: string // For many-to-many through junction
  junctionFkToBase?: string
  junctionFkToEmbed?: string
  junctionTargetTable?: string
}

/**
 * Resolve FK relationship between baseTable and embedTable.
 * Returns the FK info with direction (forward = many-to-one, reverse = one-to-many).
 */
function resolveEmbed(
  fks: FkRelation[],
  baseTable: string,
  embedTable: string,
  fkHint?: string
): ResolvedFk | null {
  // Table name candidates: as-is, +s, +es, y→ies
  const candidates = [
    embedTable,
    embedTable + 's',
    embedTable + 'es',
    embedTable.replace(/y$/, 'ies'),
    embedTable.replace(/s$/, ''),  // Try removing trailing s
  ]

  // 0) FK Column Hint: embedTable is actually an FK column name (Supabase alias:fk_col syntax)
  //    e.g. roles:role_code(...) → embedTable="role_code", resolve via FK on baseTable.role_code
  {
    const fk = fks.find(f => f.source_table === baseTable && f.source_column === embedTable)
    if (fk) {
      return {
        direction: 'forward',
        fkTable: baseTable,
        fkColumn: fk.source_column,
        pkTable: fk.target_table,
        pkColumn: fk.target_column,
      }
    }
  }

  // 1) Forward: base table has FK → embed table (many-to-one, returns object)
  for (const candidate of candidates) {
    const fk = fks.find(f => f.source_table === baseTable && f.target_table === candidate)
    if (fk) {
      return {
        direction: 'forward',
        fkTable: baseTable,
        fkColumn: fk.source_column,
        pkTable: fk.target_table,
        pkColumn: fk.target_column,
      }
    }
  }

  // 2) Reverse: embed table has FK → base table (one-to-many, returns array)
  for (const candidate of candidates) {
    const fk = fks.find(f => f.source_table === candidate && f.target_table === baseTable)
    if (fk) {
      return {
        direction: 'reverse',
        fkTable: fk.source_table,
        fkColumn: fk.source_column,
        pkTable: baseTable,
        pkColumn: fk.target_column,
      }
    }
  }

  // 3) FK hint: junction table (many-to-many)
  if (fkHint && fkHint !== 'inner') {
    const jToBase = fks.find(f => f.source_table === fkHint && f.target_table === baseTable)
    for (const candidate of candidates) {
      const jToEmbed = fks.find(f => f.source_table === fkHint && f.target_table === candidate)
      if (jToBase && jToEmbed) {
        return {
          direction: 'reverse',
          fkTable: fkHint,
          fkColumn: jToBase.source_column,
          pkTable: baseTable,
          pkColumn: jToBase.target_column,
          junctionTable: fkHint,
          junctionFkToBase: jToBase.source_column,
          junctionFkToEmbed: jToEmbed.source_column,
          junctionTargetTable: jToEmbed.target_table,
        }
      }
    }
  }

  // 4) Guess from naming convention: embed_table_id
  const singularEmbed = embedTable.replace(/s$/, '')
  const guessCol = singularEmbed + '_id'
  const guessFk = fks.find(f => f.source_table === baseTable && f.source_column === guessCol)
  if (guessFk) {
    return {
      direction: 'forward',
      fkTable: baseTable,
      fkColumn: guessFk.source_column,
      pkTable: guessFk.target_table,
      pkColumn: guessFk.target_column,
    }
  }

  // Reverse guess: base_table_id in embed table
  const singularBase = baseTable.replace(/s$/, '')
  const guessRevCol = singularBase + '_id'
  for (const candidate of candidates) {
    const revFk = fks.find(f => f.source_table === candidate && f.source_column === guessRevCol)
    if (revFk) {
      return {
        direction: 'reverse',
        fkTable: candidate,
        fkColumn: guessRevCol,
        pkTable: baseTable,
        pkColumn: revFk.target_column,
      }
    }
  }

  return null
}

// ── Embed Resolution & Stitching ─────────────────────────────────────────

/**
 * Resolve an embed: fetch related rows and attach them to base rows.
 * Handles nested embeds recursively.
 */
async function resolveAndStitchEmbed(
  pgPool: Pool,
  fks: FkRelation[],
  baseTable: string,
  rows: any[],
  embed: EmbedSpec
): Promise<void> {
  const resolved = resolveEmbed(fks, baseTable, embed.table, embed.fkHint)
  if (!resolved) {
    console.warn(`[PgEmbed] No FK found: ${baseTable} → ${embed.table} — setting ${embed.alias} to null`)
    for (const row of rows) row[embed.alias] = null
    return
  }

  const subParsed = parseSelectWithEmbeds(embed.selectStr)
  const needCols = subParsed.baseColumns
  const colSQL = needCols.includes('*') ? '*' : needCols.map(quoteIdent).join(', ')

  // Junction table (many-to-many through junction)
  if (resolved.junctionTable && resolved.junctionTargetTable) {
    const pkValues = [...new Set(rows.map(r => r[resolved.pkColumn]).filter(v => v != null))]
    if (pkValues.length === 0) {
      for (const row of rows) row[embed.alias] = []
      return
    }

    const jt = quoteIdent(resolved.junctionTable)
    const et = quoteIdent(resolved.junctionTargetTable)
    const jfkBase = quoteIdent(resolved.junctionFkToBase!)
    const jfkEmbed = quoteIdent(resolved.junctionFkToEmbed!)

    // Find the PK column of the embed target table (usually 'id')
    const embedPkFk = fks.find(f =>
      f.source_table === resolved.junctionTable && f.target_table === resolved.junctionTargetTable
    )
    const embedPkCol = embedPkFk ? quoteIdent(embedPkFk.target_column) : '"id"'

    const sql = `SELECT _e.*, _j.${jfkBase} AS _junction_fk
      FROM ${jt} _j
      JOIN ${et} _e ON _e.${embedPkCol} = _j.${jfkEmbed}
      WHERE _j.${jfkBase} = ANY($1)`
    const result = await pgPool.query(sql, [pkValues])

    // Recursively resolve nested embeds
    if (subParsed.embeds.length > 0 && result.rows.length > 0) {
      for (const nestedEmbed of subParsed.embeds) {
        await resolveAndStitchEmbed(pgPool, fks, resolved.junctionTargetTable, result.rows, nestedEmbed)
      }
    }

    // Group by junction FK
    const groups = new Map<any, any[]>()
    for (const subRow of result.rows) {
      const key = subRow._junction_fk
      delete subRow._junction_fk
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(subRow)
    }

    for (const row of rows) {
      row[embed.alias] = groups.get(row[resolved.pkColumn]) ?? []
    }
    return
  }

  if (resolved.direction === 'forward') {
    // Many-to-one: base table has FK → embed table (returns single object)
    const fkValues = [...new Set(rows.map(r => r[resolved.fkColumn]).filter(v => v != null))]
    if (fkValues.length === 0) {
      for (const row of rows) row[embed.alias] = null
      return
    }

    // Ensure we fetch the PK column for lookup
    let selectSQL = colSQL
    if (colSQL !== '*' && !needCols.includes(resolved.pkColumn)) {
      selectSQL += `, ${quoteIdent(resolved.pkColumn)}`
    }

    const sql = `SELECT ${selectSQL} FROM ${quoteIdent(resolved.pkTable)} WHERE ${quoteIdent(resolved.pkColumn)} = ANY($1)`
    const result = await pgPool.query(sql, [fkValues])

    // Recursively resolve nested embeds
    if (subParsed.embeds.length > 0 && result.rows.length > 0) {
      for (const nestedEmbed of subParsed.embeds) {
        await resolveAndStitchEmbed(pgPool, fks, resolved.pkTable, result.rows, nestedEmbed)
      }
    }

    // Build lookup: pkValue → row
    const map = new Map<any, any>()
    for (const subRow of result.rows) {
      map.set(subRow[resolved.pkColumn], subRow)
    }

    for (const row of rows) {
      row[embed.alias] = map.get(row[resolved.fkColumn]) ?? null
    }

  } else {
    // One-to-many: embed table has FK → base table (returns array)
    const pkValues = [...new Set(rows.map(r => r[resolved.pkColumn]).filter(v => v != null))]
    if (pkValues.length === 0) {
      for (const row of rows) row[embed.alias] = []
      return
    }

    // Ensure we fetch the FK column for grouping
    let selectSQL = colSQL
    if (colSQL !== '*' && !needCols.includes(resolved.fkColumn)) {
      selectSQL += `, ${quoteIdent(resolved.fkColumn)}`
    }

    const sql = `SELECT ${selectSQL} FROM ${quoteIdent(resolved.fkTable)} WHERE ${quoteIdent(resolved.fkColumn)} = ANY($1)`
    const result = await pgPool.query(sql, [pkValues])

    // Recursively resolve nested embeds
    if (subParsed.embeds.length > 0 && result.rows.length > 0) {
      for (const nestedEmbed of subParsed.embeds) {
        await resolveAndStitchEmbed(pgPool, fks, resolved.fkTable, result.rows, nestedEmbed)
      }
    }

    // Group by FK value
    const groups = new Map<any, any[]>()
    for (const subRow of result.rows) {
      const key = subRow[resolved.fkColumn]
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(subRow)
    }

    for (const row of rows) {
      row[embed.alias] = groups.get(row[resolved.pkColumn]) ?? []
    }
  }
}

// ── Query Builder ────────────────────────────────────────────────────────

export class PgQueryBuilder<T = any> {
  private _table: string
  private _pool: Pool
  private _operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private _select: string = '*'
  private _selectOptions: SelectOptions = {}
  private _filters: (FilterOp | OrFilter)[] = []
  private _orders: OrderSpec[] = []
  private _limit: number | null = null
  private _offset: number | null = null
  private _rangeFrom: number | null = null
  private _rangeTo: number | null = null
  private _single: boolean = false
  private _maybeSingle: boolean = false
  private _data: any = null
  private _onConflict: string | null = null

  constructor(table: string, pgPool: Pool) {
    this._table = table
    this._pool = pgPool
  }

  // ── SELECT ─────────────────────────────────────────────────────────

  select(columns: string = '*', options?: SelectOptions): this {
    // Only set operation to 'select' when no prior operation exists.
    // This preserves insert/update/upsert operations that chain .select()
    // to specify RETURNING columns (e.g. .insert({...}).select('id')).
    if (!this._operation || this._operation === 'select') {
      this._operation = 'select'
    }
    this._select = columns
    if (options) this._selectOptions = options
    return this
  }

  // ── INSERT ─────────────────────────────────────────────────────────

  insert(data: any | any[]): this {
    this._operation = 'insert'
    this._data = Array.isArray(data) ? data : [data]
    return this
  }

  // ── UPDATE ─────────────────────────────────────────────────────────

  update(data: any): this {
    this._operation = 'update'
    this._data = data
    return this
  }

  // ── DELETE ─────────────────────────────────────────────────────────

  delete(): this {
    this._operation = 'delete'
    return this
  }

  // ── UPSERT ─────────────────────────────────────────────────────────

  upsert(data: any | any[], options?: { onConflict?: string }): this {
    this._operation = 'upsert'
    this._data = Array.isArray(data) ? data : [data]
    this._onConflict = options?.onConflict || 'id'
    return this
  }

  // ── FILTERS ────────────────────────────────────────────────────────

  eq(column: string, value: any): this {
    this._filters.push({ column, op: '=', value })
    return this
  }

  neq(column: string, value: any): this {
    this._filters.push({ column, op: '!=', value })
    return this
  }

  gt(column: string, value: any): this {
    this._filters.push({ column, op: '>', value })
    return this
  }

  gte(column: string, value: any): this {
    this._filters.push({ column, op: '>=', value })
    return this
  }

  lt(column: string, value: any): this {
    this._filters.push({ column, op: '<', value })
    return this
  }

  lte(column: string, value: any): this {
    this._filters.push({ column, op: '<=', value })
    return this
  }

  like(column: string, value: string): this {
    this._filters.push({ column, op: 'LIKE', value })
    return this
  }

  ilike(column: string, value: string): this {
    this._filters.push({ column, op: 'ILIKE', value })
    return this
  }

  is(column: string, value: null | boolean): this {
    if (value === null) {
      this._filters.push({ column, op: 'IS NULL', value: null })
    } else {
      this._filters.push({ column, op: value ? 'IS TRUE' : 'IS FALSE', value: null })
    }
    return this
  }

  in(column: string, values: any[]): this {
    this._filters.push({ column, op: 'IN', value: values })
    return this
  }

  not(column: string, op: string, value: any): this {
    // Supabase .not('status', 'eq', 'deleted') → status != 'deleted'
    const sqlOp = mapOp(op)
    this._filters.push({ column, op: `NOT_${sqlOp}`, value })
    return this
  }

  contains(column: string, value: any): this {
    // JSONB @> operator
    this._filters.push({ column, op: '@>', value })
    return this
  }

  containedBy(column: string, value: any): this {
    this._filters.push({ column, op: '<@', value })
    return this
  }

  overlaps(column: string, value: any[]): this {
    this._filters.push({ column, op: '&&', value })
    return this
  }

  or(expression: string): this {
    this._filters.push({ type: 'or', expression } as OrFilter)
    return this
  }

  match(query: Record<string, any>): this {
    for (const [key, val] of Object.entries(query)) {
      this._filters.push({ column: key, op: '=', value: val })
    }
    return this
  }

  filter(column: string, op: string, value: any): this {
    this._filters.push({ column, op: mapOp(op), value })
    return this
  }

  textSearch(column: string, query: string, options?: { type?: string; config?: string }): this {
    const config = options?.config || 'english'
    this._filters.push({ column, op: `@@_${config}`, value: query })
    return this
  }

  // ── MODIFIERS ──────────────────────────────────────────────────────

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this._orders.push({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst,
    })
    return this
  }

  limit(count: number): this {
    this._limit = count
    return this
  }

  range(from: number, to: number): this {
    this._rangeFrom = from
    this._rangeTo = to
    return this
  }

  single(): this {
    this._single = true
    this._limit = 1
    return this
  }

  maybeSingle(): this {
    this._maybeSingle = true
    this._limit = 1
    return this
  }

  // ── EXECUTION (thenable) ───────────────────────────────────────────

  /** Make the builder thenable so `await supabase.from('t').select()` works */
  then<TResult1 = PgResult<T>, TResult2 = never>(
    onfulfilled?: ((value: PgResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  async execute(): Promise<PgResult<T>> {
    try {
      switch (this._operation) {
        case 'select':
          return await this._execSelect()
        case 'insert':
          return await this._execInsert()
        case 'update':
          return await this._execUpdate()
        case 'delete':
          return await this._execDelete()
        case 'upsert':
          return await this._execUpsert()
        default:
          return this._error(`Unknown operation: ${this._operation}`)
      }
    } catch (err: any) {
      return this._error(err.message, err.code)
    }
  }

  // ── SELECT execution ───────────────────────────────────────────────

  private async _execSelect(): Promise<PgResult<T>> {
    // Delegate to embed-aware execution when relational selects are detected
    if (selectHasNestedJoins(this._select)) {
      return this._execSelectWithEmbeds()
    }

    const params: any[] = []
    const columns = parseSelectColumns(this._select)
    const colSQL = columns.includes('*') ? '*' : columns.map(quoteIdent).join(', ')

    let sql = `SELECT ${colSQL} FROM ${quoteIdent(this._table)}`

    // WHERE clause
    const where = this._buildWhere(params)
    if (where) sql += ` WHERE ${where}`

    // ORDER BY
    if (this._orders.length > 0) {
      const orderParts = this._orders.map((o) => {
        const dir = o.ascending ? 'ASC' : 'DESC'
        const nulls = o.nullsFirst !== undefined
          ? (o.nullsFirst ? 'NULLS FIRST' : 'NULLS LAST')
          : ''
        return `${quoteIdent(o.column)} ${dir} ${nulls}`.trim()
      })
      sql += ` ORDER BY ${orderParts.join(', ')}`
    }

    // LIMIT / OFFSET
    if (this._rangeFrom !== null && this._rangeTo !== null) {
      const limit = this._rangeTo - this._rangeFrom + 1
      sql += ` LIMIT ${limit} OFFSET ${this._rangeFrom}`
    } else if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`
      if (this._offset !== null) {
        sql += ` OFFSET ${this._offset}`
      }
    }

    // Count query (for { count: 'exact' })
    let totalCount: number | null = null
    if (this._selectOptions.count === 'exact') {
      const countSQL = `SELECT COUNT(*) AS cnt FROM ${quoteIdent(this._table)}`
        + (where ? ` WHERE ${where}` : '')
      const countResult = await this._pool.query(countSQL, params)
      totalCount = parseInt(countResult.rows[0]?.cnt || '0', 10)
    }

    // Head-only: don't fetch rows
    if (this._selectOptions.head) {
      return {
        data: null,
        error: null,
        count: totalCount,
        status: 200,
        statusText: 'OK',
      }
    }

    const result = await this._pool.query(sql, params)
    let data: any = result.rows

    // .single() — return one row or error
    if (this._single) {
      if (result.rows.length === 0) {
        return {
          data: null,
          error: { message: 'No rows returned', code: 'PGRST116' },
          count: totalCount,
          status: 406,
          statusText: 'Not Acceptable',
        }
      }
      data = result.rows[0]
    }

    // .maybeSingle() — return one row or null
    if (this._maybeSingle) {
      data = result.rows[0] || null
    }

    return {
      data,
      error: null,
      count: totalCount ?? result.rowCount,
      status: 200,
      statusText: 'OK',
    }
  }

  // ── SELECT with Embedded Relations ─────────────────────────────────

  private async _execSelectWithEmbeds(): Promise<PgResult<T>> {
    const parsed = parseSelectWithEmbeds(this._select)

    // Build base column SQL (embeds are handled separately)
    const baseCols = parsed.baseColumns.length > 0 ? parsed.baseColumns : ['*']
    const colSQL = baseCols.includes('*') ? '*' : baseCols.map(quoteIdent).join(', ')

    const params: any[] = []
    let sql = `SELECT ${colSQL} FROM ${quoteIdent(this._table)}`

    const where = this._buildWhere(params)
    if (where) sql += ` WHERE ${where}`

    if (this._orders.length > 0) {
      const orderParts = this._orders.map((o) => {
        const dir = o.ascending ? 'ASC' : 'DESC'
        const nulls = o.nullsFirst !== undefined
          ? (o.nullsFirst ? 'NULLS FIRST' : 'NULLS LAST')
          : ''
        return `${quoteIdent(o.column)} ${dir} ${nulls}`.trim()
      })
      sql += ` ORDER BY ${orderParts.join(', ')}`
    }

    if (this._rangeFrom !== null && this._rangeTo !== null) {
      const limit = this._rangeTo - this._rangeFrom + 1
      sql += ` LIMIT ${limit} OFFSET ${this._rangeFrom}`
    } else if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`
      if (this._offset !== null) sql += ` OFFSET ${this._offset}`
    }

    // Count query
    let totalCount: number | null = null
    if (this._selectOptions.count === 'exact') {
      const countSQL = `SELECT COUNT(*) AS cnt FROM ${quoteIdent(this._table)}`
        + (where ? ` WHERE ${where}` : '')
      const countResult = await this._pool.query(countSQL, params)
      totalCount = parseInt(countResult.rows[0]?.cnt || '0', 10)
    }

    if (this._selectOptions.head) {
      return { data: null, error: null, count: totalCount, status: 200, statusText: 'OK' }
    }

    const result = await this._pool.query(sql, params)
    let rows = result.rows

    // Resolve embedded relations
    if (rows.length > 0 && parsed.embeds.length > 0) {
      try {
        const fks = await getFkRelations(this._pool)
        for (const embed of parsed.embeds) {
          await resolveAndStitchEmbed(this._pool, fks, this._table, rows, embed)
        }
      } catch (embedErr: any) {
        console.error(`[PgEmbed] Error resolving embeds for ${this._table}:`, embedErr.message)
        // Continue with base data — embeds will be null/empty
      }
    }

    let data: any = rows

    if (this._single) {
      if (rows.length === 0) {
        return {
          data: null,
          error: { message: 'No rows returned', code: 'PGRST116' },
          count: totalCount,
          status: 406,
          statusText: 'Not Acceptable',
        }
      }
      data = rows[0]
    }

    if (this._maybeSingle) {
      data = rows[0] || null
    }

    return {
      data,
      error: null,
      count: totalCount ?? result.rowCount,
      status: 200,
      statusText: 'OK',
    }
  }

  // ── INSERT execution ───────────────────────────────────────────────

  private async _execInsert(): Promise<PgResult<T>> {
    const rows = this._data as any[]
    if (!rows || rows.length === 0) {
      return { data: null, error: null, count: 0, status: 201, statusText: 'Created' }
    }

    // Gather all unique column names from all rows
    const colSet = new Set<string>()
    for (const row of rows) {
      for (const key of Object.keys(row)) colSet.add(key)
    }
    const cols = Array.from(colSet)
    const params: any[] = []

    const valueSets = rows.map((row) => {
      const placeholders = cols.map((col) => {
        params.push(row[col] !== undefined ? row[col] : null)
        return `$${params.length}`
      })
      return `(${placeholders.join(', ')})`
    })

    const sql = `INSERT INTO ${quoteIdent(this._table)} (${cols.map(quoteIdent).join(', ')}) VALUES ${valueSets.join(', ')} RETURNING *`

    const result = await this._pool.query(sql, params)

    // Apply select columns if specified
    const selected = this._applySelectToRows(result.rows)

    return {
      data: rows.length === 1 ? selected[0] ?? null : selected,
      error: null,
      count: result.rowCount,
      status: 201,
      statusText: 'Created',
    }
  }

  // ── UPDATE execution ───────────────────────────────────────────────

  private async _execUpdate(): Promise<PgResult<T>> {
    const data = this._data
    if (!data || Object.keys(data).length === 0) {
      return { data: null, error: null, count: 0, status: 200, statusText: 'OK' }
    }

    const params: any[] = []
    const setParts = Object.keys(data).map((key) => {
      params.push(data[key])
      return `${quoteIdent(key)} = $${params.length}`
    })

    let sql = `UPDATE ${quoteIdent(this._table)} SET ${setParts.join(', ')}`

    const where = this._buildWhere(params)
    if (where) sql += ` WHERE ${where}`

    sql += ' RETURNING *'

    const result = await this._pool.query(sql, params)

    const selected = this._applySelectToRows(result.rows)

    if (this._single) {
      return {
        data: selected[0] ?? null,
        error: selected.length === 0
          ? { message: 'No rows returned', code: 'PGRST116' }
          : null,
        count: result.rowCount,
        status: 200,
        statusText: 'OK',
      }
    }

    return {
      data: selected as T,
      error: null,
      count: result.rowCount,
      status: 200,
      statusText: 'OK',
    }
  }

  // ── DELETE execution ───────────────────────────────────────────────

  private async _execDelete(): Promise<PgResult<T>> {
    const params: any[] = []
    let sql = `DELETE FROM ${quoteIdent(this._table)}`

    const where = this._buildWhere(params)
    if (where) sql += ` WHERE ${where}`

    sql += ' RETURNING *'

    const result = await this._pool.query(sql, params)

    return {
      data: result.rows as T,
      error: null,
      count: result.rowCount,
      status: 200,
      statusText: 'OK',
    }
  }

  // ── UPSERT execution ──────────────────────────────────────────────

  private async _execUpsert(): Promise<PgResult<T>> {
    const rows = this._data as any[]
    if (!rows || rows.length === 0) {
      return { data: null, error: null, count: 0, status: 201, statusText: 'Created' }
    }

    const colSet = new Set<string>()
    for (const row of rows) {
      for (const key of Object.keys(row)) colSet.add(key)
    }
    const cols = Array.from(colSet)
    const params: any[] = []

    const valueSets = rows.map((row) => {
      const placeholders = cols.map((col) => {
        params.push(row[col] !== undefined ? row[col] : null)
        return `$${params.length}`
      })
      return `(${placeholders.join(', ')})`
    })

    const conflictCol = this._onConflict || 'id'
    const updateParts = cols
      .filter((c) => c !== conflictCol)
      .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)

    const sql = `INSERT INTO ${quoteIdent(this._table)} (${cols.map(quoteIdent).join(', ')}) `
      + `VALUES ${valueSets.join(', ')} `
      + `ON CONFLICT (${quoteIdent(conflictCol)}) `
      + (updateParts.length > 0
        ? `DO UPDATE SET ${updateParts.join(', ')} `
        : 'DO NOTHING ')
      + 'RETURNING *'

    const result = await this._pool.query(sql, params)

    return {
      data: rows.length === 1 ? result.rows[0] ?? null : result.rows,
      error: null,
      count: result.rowCount,
      status: 201,
      statusText: 'Created',
    }
  }

  // ── WHERE builder ──────────────────────────────────────────────────

  private _buildWhere(params: any[]): string {
    const parts: string[] = []

    for (const f of this._filters) {
      if ('type' in f && f.type === 'or') {
        // Parse .or() expression
        const orResult = parseOrExpression(f.expression, params, 0)
        parts.push(orResult.sql)
        params.push(...orResult.newParams)
        continue
      }

      const filter = f as FilterOp
      const col = quoteIdent(filter.column)

      // NULL checks (no parameter)
      if (filter.op === 'IS NULL') {
        parts.push(`${col} IS NULL`)
        continue
      }
      if (filter.op === 'IS TRUE') {
        parts.push(`${col} IS TRUE`)
        continue
      }
      if (filter.op === 'IS FALSE') {
        parts.push(`${col} IS FALSE`)
        continue
      }

      // IN (...) with array
      if (filter.op === 'IN') {
        const arr = filter.value as any[]
        if (arr.length === 0) {
          parts.push('FALSE') // IN () = always false
        } else {
          const placeholders = arr.map((v) => {
            params.push(v)
            return `$${params.length}`
          })
          parts.push(`${col} IN (${placeholders.join(', ')})`)
        }
        continue
      }

      // NOT_ prefixed operations
      if (filter.op.startsWith('NOT_')) {
        const realOp = filter.op.slice(4)
        params.push(filter.value)
        parts.push(`NOT (${col} ${realOp} $${params.length})`)
        continue
      }

      // JSONB contains
      if (filter.op === '@>') {
        params.push(JSON.stringify(filter.value))
        parts.push(`${col} @> $${params.length}::jsonb`)
        continue
      }
      if (filter.op === '<@') {
        params.push(JSON.stringify(filter.value))
        parts.push(`${col} <@ $${params.length}::jsonb`)
        continue
      }
      if (filter.op === '&&') {
        params.push(filter.value)
        parts.push(`${col} && $${params.length}`)
        continue
      }

      // Full text search
      if (filter.op.startsWith('@@_')) {
        const config = filter.op.slice(3)
        params.push(filter.value)
        parts.push(`${col} @@ plainto_tsquery('${config}', $${params.length})`)
        continue
      }

      // Standard comparison
      params.push(filter.value)
      parts.push(`${col} ${filter.op} $${params.length}`)
    }

    return parts.join(' AND ')
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private _applySelectToRows(rows: any[]): any[] {
    if (this._select === '*' || !this._select) return rows
    const columns = parseSelectColumns(this._select)
    if (columns.includes('*')) return rows
    return rows.map((row) => {
      const out: any = {}
      for (const col of columns) {
        if (col in row) out[col] = row[col]
      }
      return out
    })
  }

  private _error(message: string, code?: string): PgResult<T> {
    return {
      data: null,
      error: { message, code },
      count: null,
      status: 500,
      statusText: 'Internal Server Error',
    }
  }
}

// ── RPC Caller ───────────────────────────────────────────────────────────

async function callRpc(
  pgPool: Pool,
  functionName: string,
  params: Record<string, any> = {}
): Promise<PgResult> {
  try {
    const paramNames = Object.keys(params)
    const paramValues = Object.values(params)
    const placeholders = paramNames.map((_, i) => `$${i + 1}`)

    // Build: SELECT * FROM function_name(p1 := $1, p2 := $2)
    const argList = paramNames.length > 0
      ? paramNames.map((name, i) => `${name} := ${placeholders[i]}`).join(', ')
      : ''

    const sql = `SELECT * FROM ${quoteIdent(functionName)}(${argList})`
    const result = await pgPool.query(sql, paramValues)

    // Single-value functions return one row with one column
    if (result.rows.length === 1 && Object.keys(result.rows[0]).length === 1) {
      const singleVal = Object.values(result.rows[0])[0]
      return { data: singleVal, error: null, count: 1, status: 200, statusText: 'OK' }
    }

    return {
      data: result.rows.length === 1 ? result.rows[0] : result.rows,
      error: null,
      count: result.rowCount,
      status: 200,
      statusText: 'OK',
    }
  } catch (err: any) {
    return {
      data: null,
      error: { message: err.message, code: err.code },
      count: null,
      status: 500,
      statusText: 'Internal Server Error',
    }
  }
}

// ── Storage Stub ─────────────────────────────────────────────────────────

/**
 * Minimal storage adapter stub for PostgreSQL mode.
 * In Phase 1, storage operations will warn and fall through.
 * Real file storage should be added (S3, local FS) when needed.
 */
function createStorageStub() {
  return {
    from(bucket: string) {
      return {
        upload: async (path: string, data: any, options?: any) => {
          console.warn(`[PgAdapter] Storage.upload('${bucket}/${path}') not implemented — use Supabase storage in hybrid mode`)
          return { data: { path }, error: null }
        },
        getPublicUrl: (path: string) => {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
          return { data: { publicUrl: `${appUrl}/storage/${bucket}/${path}` } }
        },
        download: async (path: string) => {
          console.warn(`[PgAdapter] Storage.download('${bucket}/${path}') not implemented`)
          return { data: null, error: { message: 'Not implemented in PG mode' } }
        },
        remove: async (paths: string[]) => {
          console.warn(`[PgAdapter] Storage.remove('${bucket}') not implemented`)
          return { data: null, error: null }
        },
        list: async (prefix?: string) => {
          console.warn(`[PgAdapter] Storage.list('${bucket}/${prefix}') not implemented`)
          return { data: [], error: null }
        },
      }
    },
  }
}

// ── Auth Stub ────────────────────────────────────────────────────────────

/**
 * Auth stub for PostgreSQL mode.
 * In Phase 1, auth operations delegate to the Supabase auth layer
 * which is retained in hybrid mode. This stub provides the interface
 * for the few code paths that call auth methods on the data client.
 *
 * If you need real auth on PG mode, integrate a separate auth provider.
 */
function createAuthStub() {
  return {
    getUser: async () => {
      console.warn('[PgAdapter] auth.getUser() called on PG client — use Supabase auth client for auth operations')
      return { data: { user: null }, error: { message: 'Auth not available on PG data client' } }
    },
    getSession: async () => {
      return { data: { session: null }, error: { message: 'Auth not available on PG data client' } }
    },
    signInWithPassword: async () => {
      return { data: { user: null, session: null }, error: { message: 'Auth not available on PG data client' } }
    },
    signInWithOAuth: async () => {
      return { data: { url: null, provider: null }, error: { message: 'Auth not available on PG data client' } }
    },
    signUp: async () => {
      return { data: { user: null, session: null }, error: { message: 'Auth not available on PG data client' } }
    },
    signOut: async () => {
      return { error: null }
    },
    updateUser: async () => {
      return { data: { user: null }, error: { message: 'Auth not available on PG data client' } }
    },
    exchangeCodeForSession: async () => {
      return { data: null, error: { message: 'Auth not available on PG data client' } }
    },
    admin: {
      getUserById: async () => {
        return { data: { user: null }, error: { message: 'Auth not available on PG data client' } }
      },
    },
  }
}

// ── Realtime Stub ────────────────────────────────────────────────────────

function createRealtimeStub() {
  const noopChannel = {
    on: () => noopChannel,
    subscribe: () => noopChannel,
    unsubscribe: () => {},
  }
  return {
    channel: (_name: string) => noopChannel,
    removeChannel: (_channel: any) => {},
  }
}

// ── Main Client Factory ──────────────────────────────────────────────────

export interface PgClient {
  from: (table: string) => PgQueryBuilder
  rpc: (functionName: string, params?: Record<string, any>) => Promise<PgResult>
  auth: ReturnType<typeof createAuthStub>
  storage: ReturnType<typeof createStorageStub>
  channel: (name: string) => any
  removeChannel: (channel: any) => void
}

export function createPgClient(): PgClient {
  const pgPool = getPool()
  const authStub = createAuthStub()
  const storageStub = createStorageStub()
  const realtimeStub = createRealtimeStub()

  return {
    from: (table: string) => new PgQueryBuilder(table, pgPool),
    rpc: (fn: string, params?: Record<string, any>) => callRpc(pgPool, fn, params),
    auth: authStub,
    storage: storageStub,
    channel: realtimeStub.channel,
    removeChannel: realtimeStub.removeChannel,
  }
}
