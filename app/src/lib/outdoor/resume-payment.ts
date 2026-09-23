export async function resumeOutdoorPayment(orderRef: string) {
  const res = await fetch('/api/storefront/orders/resume-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderRef }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || 'Could not continue payment')
  if (data?.paymentUrl) {
    sessionStorage.removeItem(`outdoor-pay-left:${orderRef}`)
    sessionStorage.setItem('outdoor-pay-next', data.paymentUrl)
    window.location.assign(`/outdoor/pay?ref=${encodeURIComponent(orderRef)}`)
    return
  }
  window.location.assign(`/outdoor/orders/success?ref=${encodeURIComponent(orderRef)}`)
}
