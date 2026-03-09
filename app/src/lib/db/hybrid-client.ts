/**
 * Hybrid Client — Automatic Supabase Fallback for PG Mode
 *
 * Wraps a PgClient and a Supabase client. For queries that use
 * unsupported Supabase relational select syntax (nested FK joins),
 * the query is transparently routed to the Supabase client instead
 * of the PG adapter.
 *
 * This prevents silent partial data — every query either fully runs
 * on PostgreSQL or fully runs on Supabase.
 *
 * Observability:
 *   - Logs every fallback with table name and select string
 *   - Can be monitored via [PgFallback] log prefix
 */

import { selectHasNestedJoins, type PgClient } from './pg-adapter'

// Track which table+select combos have been logged (avoid log spam)
const _loggedFallbacks = new Set<string>()

/**
 * Create a hybrid client that wraps PG for simple queries and
 * falls back to Supabase for queries with nested FK join syntax.
 *
 * @param pgClient   The PgClient instance for direct PostgreSQL queries
 * @param sbClient   The Supabase client instance (server or admin)
 * @param label      Label for logging ('server' | 'admin')
 */
export function createHybridClient(
  pgClient: PgClient,
  sbClient: any,
  label: string = 'server'
): any {
  return {
    ...pgClient,
    from(table: string) {
      const pgBuilder = pgClient.from(table)
      const sbBuilder = sbClient.from(table)
      return createHybridBuilder(table, pgBuilder, sbBuilder, label)
    },
    // rpc goes to PG — it's fully supported
    rpc: pgClient.rpc,
    // Auth/storage already proxied on the pgClient
    auth: (pgClient as any).auth,
    storage: (pgClient as any).storage,
    channel: pgClient.channel,
    removeChannel: pgClient.removeChannel,
  }
}

/**
 * Creates a builder proxy that defers the PG-vs-Supabase decision.
 *
 * The proxy records all method calls. When `.select()` is called,
 * it checks for nested join syntax:
 *   - If detected: replays all recorded calls on the Supabase builder
 *   - If not: continues with the PG builder
 *
 * For non-select operations (insert/update/delete/upsert), the PG
 * builder is always used.
 */
function createHybridBuilder(
  table: string,
  pgBuilder: any,
  sbBuilder: any,
  label: string
): any {
  // Track whether we've decided which backend to use
  let resolved: 'pg' | 'supabase' | null = null
  let activeBuilder: any = pgBuilder

  // Record of method calls to replay if we need to switch to Supabase
  const callLog: Array<{ method: string; args: any[] }> = []

  const proxy: any = new Proxy({} as any, {
    get(_target, prop: string) {
      // thenable: delegate to the active builder
      if (prop === 'then') {
        return (
          onfulfilled?: (value: any) => any,
          onrejected?: (reason: any) => any
        ) => {
          // If still unresolved at execution time, use PG (simple query)
          if (!resolved) {
            resolved = 'pg'
            activeBuilder = pgBuilder
          }
          return activeBuilder.then(onfulfilled, onrejected)
        }
      }

      // Return a function that intercepts the call
      return (...args: any[]) => {
        // .select() is the decision point for fallback
        if (prop === 'select') {
          const selectStr = args[0] || '*'
          if (selectHasNestedJoins(selectStr)) {
            // Fallback to Supabase
            resolved = 'supabase'
            activeBuilder = sbBuilder

            // Log the fallback (once per unique table+select combo)
            const key = `${table}::${selectStr.substring(0, 80)}`
            if (!_loggedFallbacks.has(key)) {
              _loggedFallbacks.add(key)
              console.log(
                `[PgFallback][${label}] Nested join detected → Supabase fallback ` +
                `| table="${table}" | select="${selectStr.substring(0, 120)}${selectStr.length > 120 ? '...' : ''}"`
              )
            }

            // Replay any prior calls (e.g. .insert() before .select()) on Supabase builder
            for (const call of callLog) {
              sbBuilder = sbBuilder[call.method](...call.args)
            }
            activeBuilder = sbBuilder.select(...args)
            return proxy
          }
        }

        // For write operations, always resolve to PG immediately
        if (['insert', 'update', 'delete', 'upsert'].includes(prop)) {
          // But DON'T resolve yet — a .select() might follow (e.g., .insert().select())
          callLog.push({ method: prop, args })
          pgBuilder[prop](...args)
          return proxy
        }

        // If already resolved, apply to the active builder
        if (resolved) {
          activeBuilder = activeBuilder[prop](...args)
          return proxy
        }

        // Not yet resolved — record and apply to PG builder
        callLog.push({ method: prop, args })
        pgBuilder[prop](...args)
        return proxy
      }
    },
  })

  return proxy
}
