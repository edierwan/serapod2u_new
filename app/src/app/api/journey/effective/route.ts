/**
 * GET /api/journey/effective?orderId=xxx
 * Get the effective journey configuration for an order
 */

import { NextRequest, NextResponse } from 'next/server'
import { getEffectiveJourney } from '@/lib/journey'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('orderId')

    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      )
    }

    const journey = await getEffectiveJourney(orderId)

    if (!journey) {
      return NextResponse.json(
        { error: 'No active journey found for this order' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      journey
    })
  } catch (error) {
    console.error('Error fetching effective journey:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
