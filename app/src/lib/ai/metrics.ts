/**
 * AI Request Metrics — in-memory ring buffer for observability.
 *
 * Stores the last N request stats (provider, model, latency, tokens, errors).
 * Exposed via GET /api/ai/metrics (admin-only).
 */

export interface AiRequestMetric {
  /** ISO timestamp */
  ts: string
  provider: string
  model: string
  /** Time to first token (ms). -1 if non-streaming or error. */
  time_to_first_token_ms: number
  /** Total request duration (ms) */
  total_ms: number
  /** Estimated output token count */
  tokens_out_estimate: number
  /** null = success */
  error: string | null
  /** 'stream' | 'batch' | 'fast-path' */
  mode: string
  /** user id (first 8 chars) */
  user: string
}

const MAX_ENTRIES = 100
const ring: AiRequestMetric[] = []

/** Push a metric entry. Thread-safe in single-threaded Node. */
export function recordMetric(entry: AiRequestMetric): void {
  if (ring.length >= MAX_ENTRIES) {
    ring.shift()
  }
  ring.push(entry)
}

/** Return a shallow copy of the last N metrics (newest last). */
export function getMetrics(): AiRequestMetric[] {
  return [...ring]
}

/** Rough token estimate: ~4 chars per token for English/Malay mixed text. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}
