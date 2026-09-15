import { describe, expect, it, vi } from 'vitest'
import {
  QR_GENERATION_WORKER_PATH,
  QRWorkerRequestError,
  interpretQRWorkerResponse,
  triggerQRGenerationWorker,
} from './qrGenerationWorkerClient'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('interpretQRWorkerResponse', () => {
  it('throws on 401 instead of reporting a completed run', async () => {
    const promise = interpretQRWorkerResponse(json({ error: 'Unauthorized' }, 401))

    await expect(promise).rejects.toBeInstanceOf(QRWorkerRequestError)
    await expect(interpretQRWorkerResponse(json({ error: 'Unauthorized' }, 401))).rejects.toThrow(
      'QR worker request failed (HTTP 401): Unauthorized'
    )
  })

  it('surfaces the worker failure details on 500', async () => {
    const res = json({ error: 'Worker failed', details: 'Failed to upload Excel: bucket not found' }, 500)

    await expect(interpretQRWorkerResponse(res)).rejects.toMatchObject({
      status: 500,
      message: 'QR worker request failed (HTTP 500): Worker failed: Failed to upload Excel: bucket not found',
    })
  })

  it('throws on 403 and 503 lease-unavailable responses', async () => {
    await expect(interpretQRWorkerResponse(json({ error: 'Forbidden' }, 403))).rejects.toMatchObject({ status: 403 })
    await expect(
      interpretQRWorkerResponse(json({ status: 'LEASE_UNAVAILABLE', message: 'Worker lease unavailable; run skipped' }, 503))
    ).rejects.toThrow('HTTP 503')
  })

  it('throws on a non-JSON error page even when hasMore-like text is absent', async () => {
    const res = new Response('<html>Bad Gateway</html>', { status: 502 })

    await expect(interpretQRWorkerResponse(res)).rejects.toThrow('QR worker request failed (HTTP 502): No response details')
  })

  it('does not treat an unrecognised 2xx body as completion', async () => {
    await expect(interpretQRWorkerResponse(json({ ok: true }))).rejects.toThrow('unexpected response')
  })

  it('maps successful worker responses to outcomes', async () => {
    await expect(interpretQRWorkerResponse(json({ message: 'No batches to process' }))).resolves.toBe('idle')
    await expect(
      interpretQRWorkerResponse(json({ status: 'SKIPPED_ALREADY_RUNNING', worker: 'qr-generation-worker', processed: 0 }))
    ).resolves.toBe('busy')
    await expect(interpretQRWorkerResponse(json({ message: 'Batch claimed by another worker' }))).resolves.toBe('busy')
    await expect(
      interpretQRWorkerResponse(json({ success: true, message: 'Worker run completed (more work remaining)', hasMore: true }))
    ).resolves.toBe('progress')
    await expect(
      interpretQRWorkerResponse(json({ success: true, message: 'Batch processing COMPLETED!', hasMore: false }))
    ).resolves.toBe('complete')
  })
})

describe('triggerQRGenerationWorker', () => {
  it('calls the worker same-origin with cookies only and no Authorization header', async () => {
    const fetchImpl = vi.fn(async () => json({ message: 'No batches to process' }))

    await expect(triggerQRGenerationWorker(fetchImpl as unknown as typeof fetch)).resolves.toBe('idle')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(QR_GENERATION_WORKER_PATH)
    expect(init.credentials).toBe('same-origin')
    expect(new Headers(init.headers).has('authorization')).toBe(false)
  })

  it('rejects when the worker responds non-2xx', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'Unauthorized' }, 401))

    await expect(triggerQRGenerationWorker(fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ status: 401 })
  })
})
