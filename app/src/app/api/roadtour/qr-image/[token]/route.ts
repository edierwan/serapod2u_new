/**
 * Public QR Image endpoint for RoadTour
 * GET /api/roadtour/qr-image/[token]
 * Returns a PNG image of the QR code for the given token.
 * No auth required — the token itself is opaque and short-lived.
 */

import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'

const TOKEN_PATTERN = /^[a-f0-9-]{8,64}$/

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ token: string }> },
) {
    const { token } = await params

    if (!token || !TOKEN_PATTERN.test(token)) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stg.serapod2u.com'
    const scanUrl = `${appBaseUrl}/scan?rt=${token}`

    const qrBuffer = await QRCode.toBuffer(scanUrl, {
        type: 'png',
        width: 400,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
    })

    return new NextResponse(qrBuffer, {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400',
        },
    })
}
