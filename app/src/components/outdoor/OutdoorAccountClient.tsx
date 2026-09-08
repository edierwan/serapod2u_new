'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Profile = {
  email: string
  fullName: string
  phone: string
  address: string
  location: string
}

type OrderRow = {
  orderRef: string
  status: string
  totalAmount: number
  currency: string
  createdAt: string
  itemCount: number
  preview: string[]
  shippingTrackingNo?: string | null
}

function money(amount: number, currency = 'MYR') {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency }).format(amount)
}

export default function OutdoorAccountClient() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [tab, setTab] = useState<'profile' | 'orders'>('profile')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [ordersError, setOrdersError] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push(`/outdoor/login?next=${encodeURIComponent('/outdoor/account')}`)
        return
      }
      setUserId(user.id)

      const { data } = await supabase
        .from('users')
        .select('email, full_name, phone, address, location' as any)
        .eq('id', user.id)
        .single()

      const row = data as any
      setProfile({
        email: row?.email || user.email || '',
        fullName: row?.full_name || '',
        phone: row?.phone || '',
        address: row?.address || '',
        location: row?.location || '',
      })
      setLoading(false)
    }
    void load()
  }, [router])

  useEffect(() => {
    if (tab !== 'orders') return
    const loadOrders = async () => {
      setOrdersError('')
      const res = await fetch('/api/storefront/orders/mine?channel=outdoor')
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setOrdersError(data?.error || 'Could not load orders')
        return
      }
      setOrders(data.orders || [])
    }
    void loadOrders()
  }, [tab])

  const save = async () => {
    if (!profile || !userId) return
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/user/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          full_name: profile.fullName.trim(),
          phone: profile.phone.trim(),
          address: profile.address.trim(),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || data?.success === false) throw new Error(data?.error || 'Save failed')
      setMessage('Profile saved.')
    } catch (err: any) {
      setMessage(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !profile) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-[var(--out-muted)]">
        Loading account…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-8 py-12 sm:py-16">
      <h1 className="font-display text-4xl tracking-tight">My account</h1>
      <p className="mt-2 text-sm text-[var(--out-muted)]">{profile.email}</p>

      <div className="mt-8 flex gap-2 border-b border-[var(--out-line)]">
        <button
          type="button"
          onClick={() => setTab('profile')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
            tab === 'profile' ? 'border-[var(--out-moss)] text-[var(--out-ink)]' : 'border-transparent text-[var(--out-muted)]'
          }`}
        >
          Profile
        </button>
        <button
          type="button"
          onClick={() => setTab('orders')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
            tab === 'orders' ? 'border-[var(--out-moss)] text-[var(--out-ink)]' : 'border-transparent text-[var(--out-muted)]'
          }`}
        >
          Orders
        </button>
      </div>

      {tab === 'profile' ? (
        <div className="mt-8 space-y-4">
          <label className="block text-sm">
            Full name
            <input
              value={profile.fullName}
              onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
              className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] px-3"
            />
          </label>
          <label className="block text-sm">
            Phone
            <input
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] px-3"
            />
          </label>
          <label className="block text-sm">
            Delivery address
            <textarea
              value={profile.address}
              onChange={(e) => setProfile({ ...profile, address: e.target.value })}
              rows={3}
              className="mt-1.5 w-full rounded-md border border-[var(--out-line)] px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            City / location
            <input
              value={profile.location}
              onChange={(e) => setProfile({ ...profile, location: e.target.value })}
              className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] px-3"
            />
          </label>
          {message ? <p className="text-sm text-[var(--out-moss-deep)]">{message}</p> : null}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="h-11 rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
            <button
              type="button"
              onClick={async () => {
                const supabase = createClient()
                await supabase.auth.signOut()
                router.push('/outdoor')
              }}
              className="h-11 rounded-md border border-[var(--out-line)] px-5 text-sm font-semibold"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {ordersError ? <p className="text-sm text-red-600">{ordersError}</p> : null}
          {orders.length === 0 && !ordersError ? (
            <p className="text-sm text-[var(--out-muted)]">No Outdoor orders found for this email yet.</p>
          ) : null}
          {orders.map((order) => (
            <div key={order.orderRef} className="rounded-xl border border-[var(--out-line)] bg-white p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-semibold">{order.orderRef}</p>
                <p className="text-xs text-[var(--out-muted)] mt-1">
                  {new Date(order.createdAt).toLocaleString()} · {order.itemCount} items
                  {order.preview.length ? ` · ${order.preview.join(', ')}` : ''}
                </p>
                <p className="text-xs uppercase tracking-wide text-[var(--out-moss-deep)] mt-1">{order.status.replace(/_/g, ' ')}</p>
                {order.shippingTrackingNo ? (
                  <p className="text-xs mt-1">Tracking: <span className="font-mono">{order.shippingTrackingNo}</span></p>
                ) : null}
              </div>
              <div className="text-right">
                <p className="font-semibold">{money(order.totalAmount, order.currency)}</p>
                <Link
                  href={`/outdoor/track`}
                  className="text-xs font-semibold text-[var(--out-moss)] hover:underline"
                >
                  Track
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
