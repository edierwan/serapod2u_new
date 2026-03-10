/**
 * PostgreSQL Storage Adapter — Supabase Storage-Compatible
 *
 * Uses VPS filesystem at /data/storage/{bucket}/{path} for file storage.
 * Provides the same API surface as Supabase Storage.
 *
 * For existing files (migrated from production), URLs stored in the database
 * still point to the original Supabase CDN and remain accessible.
 * New uploads go to the local filesystem and are served via the
 * /api/storage/[...path] API route.
 *
 * Server-side only.
 */

import { getPool } from './pg-adapter'

// Lazy-load Node.js modules to prevent bundler from pulling them into client bundles
let _fs: typeof import('fs') | null = null
let _path: typeof import('path') | null = null

function loadFs(): typeof import('fs') {
  if (!_fs) {
    const dynamicRequire = eval('require') as NodeRequire
    _fs = dynamicRequire('fs')
  }
  return _fs!
}

function loadPath(): typeof import('path') {
  if (!_path) {
    const dynamicRequire = eval('require') as NodeRequire
    _path = dynamicRequire('path')
  }
  return _path!
}

const STORAGE_ROOT = process.env.PG_STORAGE_PATH || '/data/storage'
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

function ensureDir(dir: string): void {
  const fs = loadFs()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function sanitizePath(p: string): string {
  // Prevent path traversal
  return p.replace(/\.\./g, '').replace(/^\/+/, '')
}

export function createPgStorage() {
  return {
    from(bucket: string) {
      const pathMod = loadPath()
      const bucketDir = pathMod.join(STORAGE_ROOT, sanitizePath(bucket))

      return {
        async upload(
          filePath: string,
          data: Buffer | Blob | ArrayBuffer | Uint8Array | ReadableStream | string,
          options?: { contentType?: string; cacheControl?: string; upsert?: boolean }
        ) {
          try {
            const fs = loadFs()
            const pathMod = loadPath()
            const safePath = sanitizePath(filePath)
            const fullPath = pathMod.join(bucketDir, safePath)
            ensureDir(pathMod.dirname(fullPath))

            let buffer: Buffer
            if (Buffer.isBuffer(data)) {
              buffer = data
            } else if (data instanceof ArrayBuffer) {
              buffer = Buffer.from(new Uint8Array(data))
            } else if (data instanceof Uint8Array) {
              buffer = Buffer.from(data)
            } else if (typeof data === 'string') {
              buffer = Buffer.from(data, 'base64')
            } else if (data instanceof Blob) {
              const ab = await data.arrayBuffer()
              buffer = Buffer.from(ab)
            } else {
              // ReadableStream - collect chunks
              const reader = (data as ReadableStream).getReader()
              const chunks: Uint8Array[] = []
              let done = false
              while (!done) {
                const result = await reader.read()
                done = result.done
                if (result.value) chunks.push(result.value)
              }
              buffer = Buffer.concat(chunks)
            }

            fs.writeFileSync(fullPath, buffer)

            return {
              data: { path: safePath, id: safePath, fullPath: safePath },
              error: null,
            }
          } catch (err: any) {
            return {
              data: null,
              error: { message: err.message, statusCode: '500' },
            }
          }
        },

        getPublicUrl(filePath: string) {
          const safePath = sanitizePath(filePath)
          return {
            data: {
              publicUrl: `${APP_URL}/api/storage/${encodeURIComponent(bucket)}/${safePath}`,
            },
          }
        },

        async download(filePath: string) {
          try {
            const fs = loadFs()
            const pathMod = loadPath()
            const safePath = sanitizePath(filePath)
            const fullPath = pathMod.join(bucketDir, safePath)

            if (!fs.existsSync(fullPath)) {
              return { data: null, error: { message: 'File not found', statusCode: '404' } }
            }

            const buffer = fs.readFileSync(fullPath)
            const blob = new Blob([buffer])
            return { data: blob, error: null }
          } catch (err: any) {
            return { data: null, error: { message: err.message, statusCode: '500' } }
          }
        },

        async remove(paths: string[]) {
          try {
            const fs = loadFs()
            const pathMod = loadPath()
            for (const p of paths) {
              const safePath = sanitizePath(p)
              const fullPath = pathMod.join(bucketDir, safePath)
              if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath)
              }
            }
            return { data: paths.map(p => ({ name: p })), error: null }
          } catch (err: any) {
            return { data: null, error: { message: err.message, statusCode: '500' } }
          }
        },

        async list(prefix?: string, options?: { limit?: number; offset?: number }) {
          try {
            const fs = loadFs()
            const pathMod = loadPath()
            const searchDir = prefix
              ? pathMod.join(bucketDir, sanitizePath(prefix))
              : bucketDir

            if (!fs.existsSync(searchDir)) {
              return { data: [], error: null }
            }

            const entries = fs.readdirSync(searchDir, { withFileTypes: true })
            const items = entries.map((e) => ({
              name: e.name,
              id: e.name,
              created_at: '',
              updated_at: '',
              last_accessed_at: '',
              metadata: {},
            }))

            return { data: items.slice(options?.offset || 0, options?.limit || 100), error: null }
          } catch (err: any) {
            return { data: [], error: { message: err.message } }
          }
        },

        async createSignedUrl(filePath: string, expiresIn: number) {
          // For dev, just return the public URL
          const safePath = sanitizePath(filePath)
          return {
            data: {
              signedUrl: `${APP_URL}/api/storage/${encodeURIComponent(bucket)}/${safePath}`,
            },
            error: null,
          }
        },
      }
    },
  }
}
