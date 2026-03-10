/**
 * Storage File Serving API Route
 *
 * Serves files from the PG storage filesystem at /data/storage/{bucket}/{path}.
 * This replaces Supabase Storage CDN URLs for the dev path.
 */

import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

const STORAGE_ROOT = process.env.PG_STORAGE_PATH || '/data/storage'

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv', '.txt': 'text/plain', '.html': 'text/html',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path
  if (!segments || segments.length < 2) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const bucket = segments[0]
  const filePath = segments.slice(1).join('/')

  // Prevent path traversal
  const safePath = filePath.replace(/\.\./g, '').replace(/^\/+/, '')
  const fullPath = path.join(STORAGE_ROOT, bucket, safePath)

  // Ensure path stays within STORAGE_ROOT
  if (!fullPath.startsWith(STORAGE_ROOT)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!fs.existsSync(fullPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const buffer = fs.readFileSync(fullPath)
  const ext = path.extname(fullPath).toLowerCase()
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': String(buffer.length),
    },
  })
}
