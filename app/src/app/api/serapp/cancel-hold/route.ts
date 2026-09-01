import { NextResponse } from 'next/server'
import { runSerappCancelHold } from '@/lib/serapp/assistant-actions'

/**
 * Distributor cancels an active Serapp hold before warehouse acceptance.
 * Releases allocation via cancel + release path.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
    const result = await runSerappCancelHold({ orderId, request })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      ok: true,
      hold: result.hold,
      note: result.note,
    })
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number'
      ? (error as { status: number }).status
      : 500
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Cancel failed.',
    }, { status })
  }
}

export const dynamic = 'force-dynamic'
