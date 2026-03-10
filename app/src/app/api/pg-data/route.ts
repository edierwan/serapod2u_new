/**
 * PG Data Proxy API Route
 * POST /api/pg-data
 *
 * Proxies browser-side data operations to PG.
 * Accepts serialized query builders and RPC calls.
 * Authentication is validated via pg-auth-token cookie.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken, AUTH_COOKIE_NAME } from '@/lib/db/pg-auth'
import { createPgClient } from '@/lib/db/pg-adapter'

// Allowed query builder methods (whitelist to prevent injection)
const ALLOWED_METHODS = new Set([
  'select', 'insert', 'update', 'delete', 'upsert',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'like', 'ilike', 'is', 'in', 'not',
  'contains', 'containedBy', 'overlaps',
  'or', 'match', 'filter', 'textSearch',
  'order', 'limit', 'range', 'single', 'maybeSingle',
])

export async function POST(request: NextRequest) {
  // Validate authentication
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json(
      { data: null, error: { message: 'Unauthorized' }, count: null, status: 401, statusText: 'Unauthorized' },
      { status: 401 }
    )
  }

  const payload = await verifyAccessToken(token)
  if (!payload) {
    return NextResponse.json(
      { data: null, error: { message: 'Invalid token' }, count: null, status: 401, statusText: 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()

    // Handle RPC calls
    if (body.type === 'rpc') {
      const { functionName, params } = body
      if (!functionName || typeof functionName !== 'string' || !/^[\w]+$/.test(functionName)) {
        return NextResponse.json(
          { data: null, error: { message: 'Invalid function name' }, count: null, status: 400, statusText: 'Bad Request' },
          { status: 400 }
        )
      }
      const client = createPgClient()
      const result = await client.rpc(functionName, params || {})
      return NextResponse.json(result)
    }

    // Handle table queries
    const { table, operations } = body
    if (!table || typeof table !== 'string' || !/^[\w]+$/.test(table)) {
      return NextResponse.json(
        { data: null, error: { message: 'Invalid table name' }, count: null, status: 400, statusText: 'Bad Request' },
        { status: 400 }
      )
    }

    if (!Array.isArray(operations)) {
      return NextResponse.json(
        { data: null, error: { message: 'Invalid operations' }, count: null, status: 400, statusText: 'Bad Request' },
        { status: 400 }
      )
    }

    // Validate all operations before executing
    for (const op of operations) {
      if (!ALLOWED_METHODS.has(op.method)) {
        return NextResponse.json(
          { data: null, error: { message: `Method not allowed: ${op.method}` }, count: null, status: 400, statusText: 'Bad Request' },
          { status: 400 }
        )
      }
    }

    const client = createPgClient()
    let builder: any = client.from(table)

    for (const op of operations) {
      builder = builder[op.method](...(op.args || []))
    }

    // Execute the query
    const result = await builder
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json(
      { data: null, error: { message: err.message }, count: null, status: 500, statusText: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
