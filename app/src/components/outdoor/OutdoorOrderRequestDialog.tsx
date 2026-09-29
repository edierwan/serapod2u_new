'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { compressImage } from '@/lib/utils/imageCompression'
import {
  ORDER_REQUEST_MAX_MESSAGE,
  ORDER_REQUEST_MAX_PHOTOS,
  ORDER_REQUEST_PHOTO_REQUIRED,
  ORDER_REQUEST_TYPES,
  ORDER_REQUEST_TYPE_LABELS,
  validateOrderRequestInput,
  type OrderRequestType,
  type OrderRequestView,
} from '@/lib/storefront/order-requests'

type Photo = { file: File; preview: string }

export default function OutdoorOrderRequestDialog({
  orderRef,
  onClose,
  onSent,
}: {
  orderRef: string
  onClose: () => void
  onSent: (request: OrderRequestView) => void
}) {
  const [type, setType] = useState<OrderRequestType | ''>('')
  const [message, setMessage] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const photosRef = useRef<Photo[]>([])
  photosRef.current = photos

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [busy, onClose])

  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.preview)), [])

  const addPhotos = async (list: FileList | null) => {
    if (!list) return
    setError('')
    const room = ORDER_REQUEST_MAX_PHOTOS - photos.length
    const picked = Array.from(list).filter((file) => file.type.startsWith('image/')).slice(0, Math.max(room, 0))
    const ready: Photo[] = []
    for (const file of picked) {
      let upload = file
      try {
        upload = (await compressImage(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.82, targetType: 'image/jpeg' })).file
      } catch {
        upload = file
      }
      ready.push({ file: upload, preview: URL.createObjectURL(upload) })
    }
    setPhotos((current) => [...current, ...ready].slice(0, ORDER_REQUEST_MAX_PHOTOS))
    if (fileInput.current) fileInput.current.value = ''
  }

  const removePhoto = (index: number) => {
    setPhotos((current) => {
      const next = [...current]
      const [removed] = next.splice(index, 1)
      if (removed) URL.revokeObjectURL(removed.preview)
      return next
    })
  }

  const submit = async () => {
    const invalid = validateOrderRequestInput({ type, message, photoCount: photos.length })
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.set('orderRef', orderRef)
      form.set('type', type)
      form.set('message', message.trim())
      photos.forEach((photo) => form.append('photos', photo.file))
      const res = await fetch('/api/storefront/requests', { method: 'POST', body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not send your request.')
      onSent(data.request)
    } catch (err: any) {
      setError(err.message || 'Could not send your request.')
    } finally {
      setBusy(false)
    }
  }

  const photoRequired = type !== '' && ORDER_REQUEST_PHOTO_REQUIRED.includes(type)

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="outdoor-request-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--out-line)] px-5 py-4">
          <div>
            <h2 id="outdoor-request-title" className="font-display text-2xl tracking-tight">Report a problem</h2>
            <p className="mt-1 text-xs text-[var(--out-muted)]">
              Order <span className="font-mono font-semibold text-[var(--out-ink)]">{orderRef}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full p-2 text-[var(--out-muted)] hover:bg-[var(--out-line)]/40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div>
            <p className="text-sm font-semibold">What happened?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ORDER_REQUEST_TYPES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  aria-pressed={type === value}
                  className={`h-9 rounded-full border px-4 text-xs font-semibold transition-colors ${
                    type === value
                      ? 'border-[var(--out-moss)] bg-[var(--out-moss)] text-white'
                      : 'border-[var(--out-line)] text-[var(--out-ink)] hover:border-[var(--out-moss)]'
                  }`}
                >
                  {ORDER_REQUEST_TYPE_LABELS[value]}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-sm">
            <span className="font-semibold">Tell us more</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, ORDER_REQUEST_MAX_MESSAGE))}
              rows={4}
              placeholder="Which item, what is wrong, and what you would like us to do."
              className="mt-1.5 w-full rounded-md border border-[var(--out-line)] px-3 py-2"
            />
          </label>

          <div>
            <p className="text-sm font-semibold">
              Photos{' '}
              <span className="font-normal text-[var(--out-muted)]">
                {photoRequired ? '(at least one)' : '(optional)'} · up to {ORDER_REQUEST_MAX_PHOTOS}
              </span>
            </p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {photos.map((photo, index) => (
                <div key={photo.preview} className="relative aspect-square overflow-hidden rounded-lg border border-[var(--out-line)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(index)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                    aria-label="Remove photo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {photos.length < ORDER_REQUEST_MAX_PHOTOS ? (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--out-line)] text-[var(--out-muted)] hover:border-[var(--out-moss)] hover:text-[var(--out-moss)]"
                >
                  <Camera className="h-5 w-5" />
                  <span className="text-[11px] font-semibold">Add</span>
                </button>
              ) : null}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              multiple
              className="hidden"
              onChange={(event) => void addPhotos(event.target.files)}
            />
          </div>

          <p className="text-xs text-[var(--out-muted)]">
            We reply by email and you can follow the status here in My account. Approved refunds go back to your original payment method.
          </p>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex gap-3 border-t border-[var(--out-line)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-11 flex-1 rounded-md border border-[var(--out-line)] text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="h-11 flex-1 rounded-md bg-[var(--out-moss)] text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  )
}
