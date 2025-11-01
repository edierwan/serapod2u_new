import { NextRequest, NextResponse } from 'next/server'

/**
 * API Route to get client IP address
 * This route extracts the client's IP from request headers
 */
export async function GET(request: NextRequest) {
  // Try to get IP from various headers (in order of reliability)
  const forwarded = request.headers.get('x-forwarded-for')
  const real = request.headers.get('x-real-ip')
  const cfConnecting = request.headers.get('cf-connecting-ip') // Cloudflare
  
  let ip: string | null = null
  
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    ip = forwarded.split(',')[0].trim()
  } else if (real) {
    ip = real
  } else if (cfConnecting) {
    ip = cfConnecting
  } else {
    // Fallback to remote address (may be proxy IP)
    ip = request.headers.get('x-vercel-forwarded-for') || 
         request.headers.get('x-real-ip') ||
         'Unknown'
  }
  
  return NextResponse.json({ ip })
}

export const dynamic = 'force-dynamic'
