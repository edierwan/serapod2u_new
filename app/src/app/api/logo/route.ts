import { readFileSync } from 'fs'
import { join } from 'path'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Read logo file from the app/docs directory
    const logoPath = join(process.cwd(), 'docs', 'serapodlogo.png')
    const logoBuffer = readFileSync(logoPath)
    
    return new NextResponse(logoBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('Error loading logo:', error)
    return new NextResponse('Logo not found', { status: 404 })
  }
}
