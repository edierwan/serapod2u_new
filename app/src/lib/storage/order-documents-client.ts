export async function downloadOrderDocument(orderId: string, path: string, fallbackName: string) {
  const response = await fetch(
    `/api/documents/order/${encodeURIComponent(orderId)}/file?path=${encodeURIComponent(path)}`
  )
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || 'Failed to download document')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = path.split('/').pop() || fallbackName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
