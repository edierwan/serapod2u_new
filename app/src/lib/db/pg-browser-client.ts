/**
 * PG Browser Client — Supabase Browser Client Replacement
 *
 * Provides the same API surface as createBrowserClient from @supabase/ssr.
 * Routes auth operations through /api/pg-auth/* API routes.
 * Routes data operations through /api/pg-data API route.
 * Storage and realtime are handled with appropriate adapters.
 *
 * Client-side only ('use client').
 */

// ── Types ────────────────────────────────────────────────────────────────

type AuthChangeEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED'
type AuthCallback = (event: AuthChangeEvent, session: any) => void

interface QueryResult<T = any> {
  data: T | null
  error: { message: string; code?: string } | null
  count: number | null
  status: number
  statusText: string
}

// ── Auth State ───────────────────────────────────────────────────────────

const _authListeners = new Set<AuthCallback>()
let _currentUser: any = null
let _initialized = false

function notifyListeners(event: AuthChangeEvent, session: any) {
  for (const cb of _authListeners) {
    try { cb(event, session) } catch {}
  }
}

// ── Data Query Builder (Browser → Server Proxy) ──────────────────────────

interface SerializedQuery {
  table: string
  operations: Array<{ method: string; args: any[] }>
}

class BrowserQueryBuilder<T = any> {
  private _query: SerializedQuery

  constructor(table: string) {
    this._query = { table, operations: [] }
  }

  select(columns?: string, options?: any): this {
    this._query.operations.push({ method: 'select', args: [columns || '*', options] })
    return this
  }

  insert(data: any): this {
    this._query.operations.push({ method: 'insert', args: [data] })
    return this
  }

  update(data: any): this {
    this._query.operations.push({ method: 'update', args: [data] })
    return this
  }

  delete(): this {
    this._query.operations.push({ method: 'delete', args: [] })
    return this
  }

  upsert(data: any, options?: any): this {
    this._query.operations.push({ method: 'upsert', args: [data, options] })
    return this
  }

  eq(column: string, value: any): this {
    this._query.operations.push({ method: 'eq', args: [column, value] })
    return this
  }

  neq(column: string, value: any): this {
    this._query.operations.push({ method: 'neq', args: [column, value] })
    return this
  }

  gt(column: string, value: any): this {
    this._query.operations.push({ method: 'gt', args: [column, value] })
    return this
  }

  gte(column: string, value: any): this {
    this._query.operations.push({ method: 'gte', args: [column, value] })
    return this
  }

  lt(column: string, value: any): this {
    this._query.operations.push({ method: 'lt', args: [column, value] })
    return this
  }

  lte(column: string, value: any): this {
    this._query.operations.push({ method: 'lte', args: [column, value] })
    return this
  }

  like(column: string, value: string): this {
    this._query.operations.push({ method: 'like', args: [column, value] })
    return this
  }

  ilike(column: string, value: string): this {
    this._query.operations.push({ method: 'ilike', args: [column, value] })
    return this
  }

  is(column: string, value: any): this {
    this._query.operations.push({ method: 'is', args: [column, value] })
    return this
  }

  in(column: string, values: any[]): this {
    this._query.operations.push({ method: 'in', args: [column, values] })
    return this
  }

  not(column: string, op: string, value: any): this {
    this._query.operations.push({ method: 'not', args: [column, op, value] })
    return this
  }

  contains(column: string, value: any): this {
    this._query.operations.push({ method: 'contains', args: [column, value] })
    return this
  }

  containedBy(column: string, value: any): this {
    this._query.operations.push({ method: 'containedBy', args: [column, value] })
    return this
  }

  overlaps(column: string, value: any[]): this {
    this._query.operations.push({ method: 'overlaps', args: [column, value] })
    return this
  }

  or(expression: string): this {
    this._query.operations.push({ method: 'or', args: [expression] })
    return this
  }

  match(query: Record<string, any>): this {
    this._query.operations.push({ method: 'match', args: [query] })
    return this
  }

  filter(column: string, op: string, value: any): this {
    this._query.operations.push({ method: 'filter', args: [column, op, value] })
    return this
  }

  textSearch(column: string, query: string, options?: any): this {
    this._query.operations.push({ method: 'textSearch', args: [column, query, options] })
    return this
  }

  order(column: string, options?: any): this {
    this._query.operations.push({ method: 'order', args: [column, options] })
    return this
  }

  limit(count: number): this {
    this._query.operations.push({ method: 'limit', args: [count] })
    return this
  }

  range(from: number, to: number): this {
    this._query.operations.push({ method: 'range', args: [from, to] })
    return this
  }

  single(): this {
    this._query.operations.push({ method: 'single', args: [] })
    return this
  }

  maybeSingle(): this {
    this._query.operations.push({ method: 'maybeSingle', args: [] })
    return this
  }

  /** Execute the query by sending to the server */
  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._execute().then(onfulfilled, onrejected)
  }

  private async _execute(): Promise<QueryResult<T>> {
    try {
      const res = await fetch('/api/pg-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this._query),
        credentials: 'same-origin',
      })
      return await res.json()
    } catch (err: any) {
      return {
        data: null,
        error: { message: err.message || 'Network error' },
        count: null,
        status: 500,
        statusText: 'Internal Server Error',
      }
    }
  }
}

// ── Auth API Client ──────────────────────────────────────────────────────

const pgBrowserAuth = {
  async getUser() {
    try {
      const res = await fetch('/api/pg-auth/user', { credentials: 'same-origin' })
      const result = await res.json()
      _currentUser = result.data?.user || null
      if (!_initialized) {
        _initialized = true
        notifyListeners('INITIAL_SESSION', result.data?.user ? { user: result.data.user } : null)
      }
      return result
    } catch {
      return { data: { user: null }, error: { message: 'Network error' } }
    }
  },

  async getSession() {
    try {
      const res = await fetch('/api/pg-auth/session', { credentials: 'same-origin' })
      return await res.json()
    } catch {
      return { data: { session: null }, error: { message: 'Network error' } }
    }
  },

  async signInWithPassword(credentials: { email?: string; phone?: string; password: string }) {
    try {
      const res = await fetch('/api/pg-auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
        credentials: 'same-origin',
      })
      const result = await res.json()
      if (result.data?.user) {
        _currentUser = result.data.user
        notifyListeners('SIGNED_IN', result.data.session ? { user: result.data.user } : null)
      }
      return result
    } catch (err: any) {
      return { data: { user: null, session: null }, error: { message: err.message } }
    }
  },

  async signUp(params: { email: string; password: string; phone?: string; options?: any }) {
    try {
      const res = await fetch('/api/pg-auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        credentials: 'same-origin',
      })
      const result = await res.json()
      if (result.data?.user) {
        _currentUser = result.data.user
        notifyListeners('SIGNED_IN', result.data.session ? { user: result.data.user } : null)
      }
      return result
    } catch (err: any) {
      return { data: { user: null, session: null }, error: { message: err.message } }
    }
  },

  async signOut(options?: { scope?: string }) {
    try {
      await fetch('/api/pg-auth/signout', {
        method: 'POST',
        credentials: 'same-origin',
      })
      _currentUser = null
      notifyListeners('SIGNED_OUT', null)
      return { error: null }
    } catch {
      return { error: null }
    }
  },

  async signInWithOAuth(_options: { provider: string; options?: any }) {
    console.warn('[PgBrowserClient] OAuth not available in PG-only dev mode')
    return { data: { url: null, provider: null }, error: { message: 'OAuth not available in PG-only dev mode' } }
  },

  async signInWithOtp(_options: { phone?: string; email?: string }) {
    console.warn('[PgBrowserClient] OTP not available in PG-only dev mode')
    return { data: { user: null, session: null }, error: { message: 'OTP not available in PG-only dev mode' } }
  },

  async refreshSession() {
    try {
      const res = await fetch('/api/pg-auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const result = await res.json()
      if (result.data?.user) {
        _currentUser = result.data.user
        notifyListeners('TOKEN_REFRESHED', result.data.session)
      }
      return result
    } catch {
      return { data: { session: null }, error: { message: 'Network error' } }
    }
  },

  async updateUser(data: any) {
    try {
      const res = await fetch('/api/pg-auth/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'same-origin',
      })
      const result = await res.json()
      if (result.data?.user) {
        _currentUser = result.data.user
        notifyListeners('USER_UPDATED', null)
      }
      return result
    } catch (err: any) {
      return { data: { user: null }, error: { message: err.message } }
    }
  },

  async resetPasswordForEmail(_email: string, _options?: any) {
    return { data: {}, error: null }
  },

  async exchangeCodeForSession(_code: string) {
    return { data: null, error: { message: 'Not available in PG-only dev mode' } }
  },

  onAuthStateChange(callback: AuthCallback) {
    _authListeners.add(callback)

    // Fire initial session check
    if (!_initialized) {
      pgBrowserAuth.getUser().catch(() => {})
    } else {
      // Already initialized, fire immediately
      setTimeout(() => {
        callback('INITIAL_SESSION', _currentUser ? { user: _currentUser } : null)
      }, 0)
    }

    return {
      data: {
        subscription: {
          id: String(Math.random()),
          callback,
          unsubscribe: () => {
            _authListeners.delete(callback)
          },
        },
      },
    }
  },
}

// ── Storage Browser Client ───────────────────────────────────────────────

function createBrowserStorage() {
  return {
    from(bucket: string) {
      return {
        async upload(filePath: string, file: File | Blob | ArrayBuffer, options?: any) {
          try {
            const formData = new FormData()
            const fileBlob = file instanceof Blob ? file : new Blob([file])
            formData.append('file', fileBlob)
            formData.append('path', filePath)
            if (options?.contentType) formData.append('contentType', options.contentType)
            if (options?.upsert) formData.append('upsert', 'true')

            const res = await fetch(`/api/storage/${encodeURIComponent(bucket)}/upload`, {
              method: 'POST',
              body: formData,
              credentials: 'same-origin',
            })
            return await res.json()
          } catch (err: any) {
            return { data: null, error: { message: err.message } }
          }
        },

        getPublicUrl(filePath: string) {
          return {
            data: {
              publicUrl: `/api/storage/${encodeURIComponent(bucket)}/${filePath}`,
            },
          }
        },

        async download(filePath: string) {
          try {
            const res = await fetch(`/api/storage/${encodeURIComponent(bucket)}/${filePath}`, {
              credentials: 'same-origin',
            })
            if (!res.ok) return { data: null, error: { message: `HTTP ${res.status}` } }
            const blob = await res.blob()
            return { data: blob, error: null }
          } catch (err: any) {
            return { data: null, error: { message: err.message } }
          }
        },

        async remove(paths: string[]) {
          try {
            const res = await fetch(`/api/storage/${encodeURIComponent(bucket)}/remove`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ paths }),
              credentials: 'same-origin',
            })
            return await res.json()
          } catch (err: any) {
            return { data: null, error: { message: err.message } }
          }
        },

        async list(prefix?: string) {
          return { data: [], error: null }
        },

        async createSignedUrl(filePath: string, _expiresIn: number) {
          return {
            data: { signedUrl: `/api/storage/${encodeURIComponent(bucket)}/${filePath}` },
            error: null,
          }
        },
      }
    },
  }
}

// ── Realtime Stub (Polling-based) ────────────────────────────────────────

function createBrowserRealtime() {
  const channels = new Map<string, any>()

  return {
    channel(name: string) {
      const listeners: Array<{ event: string; filter: any; callback: (...args: any[]) => void }> = []
      let pollInterval: ReturnType<typeof setInterval> | null = null

      const channel = {
        on(event: string, filter: any, callback: (...args: any[]) => void) {
          listeners.push({ event, filter, callback })
          return channel
        },
        subscribe(statusCallback?: (status: string) => void) {
          // In PG mode, realtime is degraded — no live updates
          // Notify subscription is "active" for component lifecycle
          statusCallback?.('SUBSCRIBED')

          // Optional: poll for changes (if table specified in filter)
          // This is intentionally disabled by default to avoid performance issues
          // Uncomment if specific channels need polling:
          // pollInterval = setInterval(() => { /* poll logic */ }, 10000)

          return channel
        },
        unsubscribe() {
          if (pollInterval) clearInterval(pollInterval)
          channels.delete(name)
        },
      }

      channels.set(name, channel)
      return channel
    },
    removeChannel(channel: any) {
      channel?.unsubscribe?.()
    },
  }
}

// ── RPC Browser Proxy ────────────────────────────────────────────────────

async function browserRpc(functionName: string, params?: Record<string, any>): Promise<QueryResult> {
  try {
    const res = await fetch('/api/pg-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'rpc',
        functionName,
        params: params || {},
      }),
      credentials: 'same-origin',
    })
    return await res.json()
  } catch (err: any) {
    return { data: null, error: { message: err.message }, count: null, status: 500, statusText: 'Error' }
  }
}

// ── Main Browser Client Factory ──────────────────────────────────────────

let _browserClient: ReturnType<typeof _createPgBrowserClient> | null = null

function _createPgBrowserClient() {
  const storage = createBrowserStorage()
  const realtime = createBrowserRealtime()

  return {
    from: (table: string) => new BrowserQueryBuilder(table),
    rpc: browserRpc,
    auth: pgBrowserAuth,
    storage,
    channel: realtime.channel,
    removeChannel: realtime.removeChannel,
  }
}

export function createPgBrowserClient() {
  if (!_browserClient) {
    _browserClient = _createPgBrowserClient()
  }
  return _browserClient
}

export function resetPgBrowserClient() {
  _browserClient = null
  _currentUser = null
  _initialized = false
  _authListeners.clear()
}

export function forceCleanPgStorage() {
  if (typeof window === 'undefined') return
  // Clear any PG auth related storage
  try {
    const keys = Object.keys(localStorage)
    keys.forEach(key => {
      if (key.includes('pg-auth') || key.includes('pg_auth')) {
        localStorage.removeItem(key)
      }
    })
  } catch {}
}
