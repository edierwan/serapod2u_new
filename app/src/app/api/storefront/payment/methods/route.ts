import { NextResponse } from 'next/server'
import { listCheckoutPaymentMethods } from '@/lib/payments'

export const dynamic = 'force-dynamic'

export async function GET() {
  const methods = await listCheckoutPaymentMethods()
  return NextResponse.json({ methods })
}
