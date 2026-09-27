export const ORDER_DOCUMENTS_BUCKET = 'order-documents'
export const ORDER_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

export function orderDocumentPath(reference: string, orderId: string): string | null {
  if (!reference || !orderId) return null

  let path = reference.trim()
  try {
    const url = new URL(path)
    const marker = `/storage/v1/object/`
    const markerIndex = url.pathname.indexOf(marker)
    if (markerIndex < 0) return null
    const storagePath = decodeURIComponent(url.pathname.slice(markerIndex + marker.length))
    path = storagePath.replace(/^(?:public|sign|authenticated)\//, '')
    if (!path.startsWith(`${ORDER_DOCUMENTS_BUCKET}/`)) return null
    path = path.slice(ORDER_DOCUMENTS_BUCKET.length + 1)
  } catch {
    path = path.replace(/^\/+/, '')
    if (path.startsWith(`${ORDER_DOCUMENTS_BUCKET}/`)) {
      path = path.slice(ORDER_DOCUMENTS_BUCKET.length + 1)
    }
  }

  if (!path || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    return null
  }
  return path.startsWith(`${orderId}/`) ? path : null
}

export function safeOrderDocumentFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
  return cleaned || 'document'
}
