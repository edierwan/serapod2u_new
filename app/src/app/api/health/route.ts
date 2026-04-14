import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'serapod2u-app',
    ts: new Date().toISOString(),
  })
}

export async function HEAD() {
  return new Response(null, { status: 200 })
}