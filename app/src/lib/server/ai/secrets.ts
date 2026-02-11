/**
 * Server-side AES-256-GCM encryption for AI provider tokens.
 *
 * Requires env `AI_SECRETS_KEY` — a 32-byte key encoded as base64.
 * Generate one:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Format of ciphertext: `iv_hex:authTag_hex:ciphertext_hex`
 * This is NOT a substitute for Supabase Vault / KMS — it's a practical
 * server-side encryption layer so tokens are never stored in plaintext.
 */
import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

function getKey(): Buffer {
  const raw = process.env.AI_SECRETS_KEY
  if (!raw) {
    throw new Error(
      '[AI Secrets] AI_SECRETS_KEY env var is required. ' +
      'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    )
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(`[AI Secrets] AI_SECRETS_KEY must be 32 bytes (got ${buf.length}). Use base64-encoded 32-byte value.`)
  }
  return buf
}

/**
 * Encrypt a plaintext string.
 * Returns `iv_hex:authTag_hex:ciphertext_hex`.
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * Decrypt a ciphertext string produced by `encryptSecret`.
 */
export function decryptSecret(ciphertext: string): string {
  const key = getKey()
  const parts = ciphertext.split(':')
  if (parts.length !== 3) {
    throw new Error('[AI Secrets] Invalid ciphertext format')
  }

  const [ivHex, authTagHex, encryptedHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Build a masked hint from the last 4 characters of a token.
 * e.g. "my-secret-token-UjOK" → "****UjOK"
 */
export function buildTokenHint(token: string): string {
  if (!token || token.length < 4) return '****'
  return '****' + token.slice(-4)
}
