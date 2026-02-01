import { NextRequest, NextResponse } from 'next/server'

const MOLTBOT_URL = process.env.MOLTBOT_URL || 'http://localhost:4000'

export async function POST(
    request: NextRequest,
    { params }: { params: { phone: string } }
) {
    try {
        const phone = params.phone

        if (!phone) {
            return NextResponse.json({ ok: false, error: 'Phone number required' }, { status: 400 })
        }

        const res = await fetch(`${MOLTBOT_URL}/api/draft/${encodeURIComponent(phone)}/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        })

        const data = await res.json()
        return NextResponse.json(data, { status: res.status })
    } catch (error) {
        console.error('Failed to send draft:', error)
        return NextResponse.json({
            ok: false,
            error: 'Failed to connect to Moltbot service'
        }, { status: 500 })
    }
}
