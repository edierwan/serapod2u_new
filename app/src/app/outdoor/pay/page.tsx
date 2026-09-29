'use client'

import { useEffect } from 'react'

export default function OutdoorPayHandoffPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref') || ''
    const next = sessionStorage.getItem('outdoor-pay-next') || ''
    const leftKey = `outdoor-pay-left:${ref}`
    const accountUrl = `/outdoor/account?tab=orders${ref ? `&pending=${encodeURIComponent(ref)}` : ''}`

    const goToOrders = () => {
      sessionStorage.removeItem(leftKey)
      sessionStorage.removeItem('outdoor-pay-next')
      window.location.replace(accountUrl)
    }

    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) goToOrders()
    }
    window.addEventListener('pageshow', onShow)

    if (sessionStorage.getItem(leftKey) === '1' || !next) {
      goToOrders()
      return () => window.removeEventListener('pageshow', onShow)
    }

    sessionStorage.setItem(leftKey, '1')
    window.location.assign(next)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  return (
    <div className="mx-auto max-w-md px-5 py-16 text-center">
      <p className="text-sm text-[var(--out-muted)]">Opening secure payment…</p>
    </div>
  )
}
