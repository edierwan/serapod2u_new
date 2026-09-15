/**
 * Browser-side trigger for /api/cron/qr-generation-worker.
 *
 * The request carries only the user's session cookies - never CRON_SECRET.
 * Any non-2xx response is thrown as an Error carrying the worker's own
 * message, so a 401/403/500/503 can never be mistaken for a completed run.
 */

export const QR_GENERATION_WORKER_PATH = '/api/cron/qr-generation-worker'

/** Same marker as LEASE_SKIPPED in '@/lib/cron/lease' (kept local: that module is server-only). */
const LEASE_SKIPPED = 'SKIPPED_ALREADY_RUNNING'

export type QRWorkerRunOutcome =
  /** Queue is empty. */
  | 'idle'
  /** Another run (usually the scheduled cron) is processing; poll again. */
  | 'busy'
  /** This run yielded with work remaining; call again. */
  | 'progress'
  /** The batch reached generated. */
  | 'complete'

export class QRWorkerRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'QRWorkerRequestError'
    this.status = status
  }
}

type WorkerBody = {
  message?: unknown
  error?: unknown
  details?: unknown
  status?: unknown
  hasMore?: unknown
}

function describeFailure(status: number, body: WorkerBody | null): string {
  const parts = [body?.error, body?.details, body?.message]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
  const detail = parts.length > 0 ? parts.join(': ') : 'No response details'
  return `QR worker request failed (HTTP ${status}): ${detail}`
}

/** Maps a worker response to an outcome, throwing on any failure. */
export async function interpretQRWorkerResponse(response: Response): Promise<QRWorkerRunOutcome> {
  let body: WorkerBody | null = null
  try {
    body = (await response.json()) as WorkerBody
  } catch {
    body = null
  }

  if (!response.ok) {
    throw new QRWorkerRequestError(response.status, describeFailure(response.status, body))
  }

  if (!body) {
    throw new QRWorkerRequestError(response.status, 'QR worker returned an unreadable response')
  }

  if (body.message === 'No batches to process') return 'idle'
  if (body.status === LEASE_SKIPPED || body.message === 'Batch claimed by another worker') return 'busy'
  if (body.hasMore === true) return 'progress'
  if (body.hasMore === false) return 'complete'

  // A 2xx the UI does not recognise is not proof the batch finished.
  throw new QRWorkerRequestError(response.status, `QR worker returned an unexpected response: ${JSON.stringify(body)}`)
}

export async function triggerQRGenerationWorker(fetchImpl: typeof fetch = fetch): Promise<QRWorkerRunOutcome> {
  const response = await fetchImpl(QR_GENERATION_WORKER_PATH, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  })
  return interpretQRWorkerResponse(response)
}
