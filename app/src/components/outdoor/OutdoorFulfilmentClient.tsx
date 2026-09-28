'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Ban,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  CreditCard,
  Hourglass,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  PackageCheck,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShoppingBag,
  Truck,
  User,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import OutdoorRequestsDesk from '@/components/outdoor/OutdoorRequestsDesk'
import { hasShipmentDetails, isOwnDelivery } from '@/lib/storefront/delivery'
import { UNPAID_ORDER_TTL_HOURS, unpaidOrderDeadline } from '@/lib/storefront/unpaid-order-deadline'

type OrderItem = {
  id: string
  product_name: string
  variant_name: string
  quantity: number
  unit_price: number
  subtotal: number
}

type Order = {
  id: string
  order_ref: string
  status: string
  customer_name: string
  customer_email: string
  customer_phone: string
  shipping_address: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postcode?: string
  }
  total_amount: number
  shipping_amount?: number
  shipping_courier_name?: string | null
  shipping_service_id?: string | null
  shipping_tracking_no?: string | null
  easyparcel_order_no?: string | null
  paid_at?: string | null
  created_at: string
  storefront_order_items?: OrderItem[]
}

type ContactMessage = {
  id: string
  name: string
  email: string
  message: string
  status: string
  created_at: string
}

function money(n: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n)
}

const COURIER_SUGGESTIONS = [
  'J&T Express',
  'Pos Laju',
  'DHL eCommerce',
  'Ninja Van',
  'City-Link Express',
  'GDEX',
  'SPX Express',
  'Flash Express',
  'Skynet',
  'Aramex',
]

const EMPTY_STATE: Record<string, { title: string; hint: string }> = {
  fulfilment: { title: 'Nothing to send out', hint: 'New paid orders appear here the moment the payment clears.' },
  pending_payment: {
    title: 'No unpaid orders',
    hint: `Orders not paid within ${UNPAID_ORDER_TTL_HOURS} hours cancel themselves and close the payment page.`,
  },
  all: { title: 'No Outdoor orders yet', hint: 'The first order from the Outdoor shop will show up here.' },
}

type Tone = 'amber' | 'green' | 'blue' | 'violet' | 'grey' | 'red'

const ORDER_FILTERS: Array<{ value: string; label: string; icon: LucideIcon }> = [
  { value: 'fulfilment', label: 'To send out', icon: Send },
  { value: 'pending_payment', label: 'Awaiting payment', icon: Hourglass },
  { value: 'all', label: 'All orders', icon: ClipboardList },
]

const CONTACT_CHIP =
  'inline-flex items-center gap-1 rounded-full border border-[var(--out-line)] px-2.5 py-1 text-[var(--out-burgundy)] hover:bg-[var(--out-ivory)]'

const TONE_CLASS: Record<Tone, string> = {
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  grey: 'bg-slate-100 text-slate-600 ring-slate-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
}

function statusBadge(status: string, missingDetails: boolean): { label: string; tone: Tone; icon: LucideIcon } {
  if (status === 'shipped' && missingDetails) return { label: 'Shipped · details missing', tone: 'amber', icon: AlertTriangle }
  switch (status) {
    case 'pending_payment':
      return { label: 'Awaiting payment', tone: 'amber', icon: Hourglass }
    case 'paid':
      return { label: 'Paid · ready to pack', tone: 'green', icon: CheckCircle2 }
    case 'processing':
      return { label: 'Packing', tone: 'blue', icon: Package }
    case 'shipped':
      return { label: 'Out for delivery', tone: 'violet', icon: Truck }
    case 'delivered':
      return { label: 'Delivered', tone: 'green', icon: PackageCheck }
    case 'payment_failed':
      return { label: 'Payment failed', tone: 'red', icon: XCircle }
    case 'refunded':
      return { label: 'Refunded', tone: 'grey', icon: RotateCcw }
    case 'cancelled':
      return { label: 'Cancelled', tone: 'grey', icon: Ban }
    default:
      return { label: status.replace(/_/g, ' '), tone: 'grey', icon: Clock }
  }
}

function FooterNote({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-[var(--out-ink-soft)]">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--out-muted)]" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function when(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d)
}

function OrderCard({
  order: o,
  busy,
  easyParcelBooking,
  easyParcelConfigured,
  courier,
  tracking,
  onCourierChange,
  onTrackingChange,
  onAction,
}: {
  order: Order
  busy: boolean
  easyParcelBooking: boolean
  easyParcelConfigured: boolean
  courier: string
  tracking: string
  onCourierChange: (value: string) => void
  onTrackingChange: (value: string) => void
  onAction: (action: string, extra?: Record<string, string>) => void
}) {
  const [confirmOwn, setConfirmOwn] = useState(false)
  const addr = o.shipping_address || {}
  const notSent = o.status === 'shipped' && !hasShipmentDetails(o)
  const canShip = ['paid', 'processing'].includes(o.status) || notSent
  const ownDelivery = isOwnDelivery(o.shipping_courier_name)
  const badge = statusBadge(o.status, notSent)
  const address = [addr.line1, addr.line2, addr.city, addr.state, addr.postcode].filter(Boolean).join(', ')
  const phoneDigits = String(o.customer_phone || '').replace(/\D/g, '')
  const shippingFee = Number(o.shipping_amount) || 0
  const items = o.storefront_order_items || []
  const deadline = o.status === 'pending_payment' ? unpaidOrderDeadline(o.created_at) : null
  const courierReady = tracking.trim() && (easyParcelBooking || courier.trim())

  return (
    <li className="overflow-hidden rounded-2xl border border-[var(--out-line)] bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold tracking-tight">{o.order_ref}</p>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${TONE_CLASS[badge.tone]}`}>
              <badge.icon className="h-3 w-3" aria-hidden />
              {badge.label}
            </span>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--out-muted)]">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Placed {when(o.created_at)}
            </span>
            {o.paid_at ? (
              <span className="inline-flex items-center gap-1">
                <CreditCard className="h-3.5 w-3.5" aria-hidden />
                Paid {when(o.paid_at)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">{money(Number(o.total_amount) || 0)}</p>
          <p className="text-xs text-[var(--out-muted)]">
            {shippingFee > 0 ? `incl. ${money(shippingFee)} delivery` : 'Free delivery'}
          </p>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-4 sm:grid-cols-2">
        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--out-muted)]">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            Deliver to
          </h3>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium">
            <User className="h-3.5 w-3.5 shrink-0 text-[var(--out-muted)]" aria-hidden />
            {o.customer_name}
          </p>
          {address ? <p className="mt-0.5 pl-5 text-sm text-[var(--out-ink-soft)]">{address}</p> : null}
          <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs font-medium">
            {o.customer_phone ? (
              <a href={`tel:${o.customer_phone}`} className={CONTACT_CHIP}>
                <Phone className="h-3.5 w-3.5" aria-hidden />
                {o.customer_phone}
              </a>
            ) : null}
            {phoneDigits ? (
              <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className={CONTACT_CHIP}>
                <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                WhatsApp
              </a>
            ) : null}
            {address ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                target="_blank"
                rel="noreferrer"
                className={CONTACT_CHIP}
              >
                <Navigation className="h-3.5 w-3.5" aria-hidden />
                Open in Maps
              </a>
            ) : null}
            {o.customer_email ? (
              <a href={`mailto:${o.customer_email}`} className={CONTACT_CHIP}>
                <Mail className="h-3.5 w-3.5" aria-hidden />
                {o.customer_email}
              </a>
            ) : null}
          </div>
        </section>

        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--out-muted)]">
            <ShoppingBag className="h-3.5 w-3.5" aria-hidden />
            {items.length === 1 ? '1 item' : `${items.length} items`}
          </h3>
          <ul className="mt-1.5 space-y-1.5">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 text-sm">
                <span>
                  <span className="font-medium">{i.quantity} ×</span> {i.product_name}
                  {i.variant_name ? <span className="text-[var(--out-muted)]"> · {i.variant_name}</span> : null}
                </span>
                <span className="shrink-0 text-[var(--out-muted)]">{money(Number(i.subtotal) || 0)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="border-t border-[var(--out-line)] bg-[var(--out-ivory)] px-5 py-4">
        {o.status === 'pending_payment' ? (
          <FooterNote icon={Hourglass}>
            Waiting for the customer to pay.
            {deadline ? ` If it isn’t paid by ${when(deadline.toISOString())}, it cancels itself.` : ''}
          </FooterNote>
        ) : null}

        {o.status === 'payment_failed' ? (
          <FooterNote icon={XCircle}>The payment didn’t go through. Nothing to send.</FooterNote>
        ) : null}
        {o.status === 'cancelled' ? <FooterNote icon={Ban}>Cancelled. Nothing to send.</FooterNote> : null}
        {o.status === 'refunded' ? (
          <FooterNote icon={RotateCcw}>Refunded to the customer. Nothing to send.</FooterNote>
        ) : null}
        {o.status === 'delivered' ? (
          <FooterNote icon={PackageCheck}>
            Delivered{ownDelivery ? ' by our team' : o.shipping_courier_name ? ` by ${o.shipping_courier_name}` : ''}. All done.
          </FooterNote>
        ) : null}

        {o.status === 'shipped' && !notSent ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FooterNote icon={Truck}>
              {ownDelivery ? (
                'On the way with our delivery team.'
              ) : (
                <>
                  With <span className="font-medium">{o.shipping_courier_name || 'the courier'}</span>
                  {o.shipping_tracking_no ? (
                    <>
                      {' '}· tracking <span className="font-mono font-medium">{o.shipping_tracking_no}</span>
                    </>
                  ) : null}
                  {o.easyparcel_order_no ? ` · EasyParcel ${o.easyparcel_order_no}` : ''}
                </>
              )}
            </FooterNote>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction('mark_delivered')}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--out-olive)] px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <PackageCheck className="h-4 w-4" aria-hidden />
              {busy ? 'Saving…' : 'Mark as delivered'}
            </button>
          </div>
        ) : null}

        {canShip ? (
          <div>
            {notSent ? (
              <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  This order is marked as shipped, but nobody saved how it went out, so the customer can’t follow it.
                  Choose one option below to fix that.
                </span>
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Send className="h-4 w-4 text-[var(--out-muted)]" aria-hidden />
                How is it going out?
              </p>
              {o.status === 'paid' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAction('mark_processing')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--out-burgundy)] hover:underline disabled:opacity-50"
                >
                  <Package className="h-3.5 w-3.5" aria-hidden />
                  Packing it first? Mark as packing
                </button>
              ) : null}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col rounded-xl border border-[var(--out-line)] bg-white p-4">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--out-ivory)]">
                    <Truck className="h-4 w-4 text-[var(--out-bark)]" aria-hidden />
                  </span>
                  Our delivery team
                </p>
                <p className="mt-1 text-xs text-[var(--out-muted)]">
                  We take it to the customer ourselves. They’ll see that our team is on the way.
                </p>
                <div className="mt-auto pt-3">
                  {confirmOwn ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setConfirmOwn(false)
                          onAction('ship_own')
                        }}
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--out-bark)] px-4 text-sm font-semibold text-[var(--out-cream)] disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        Yes, it’s on the way
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmOwn(false)}
                        className="h-10 px-2 text-sm text-[var(--out-muted)] hover:underline"
                      >
                        Not yet
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmOwn(true)}
                      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--out-bark)] px-4 text-sm font-semibold text-[var(--out-cream)] disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" aria-hidden />
                      {busy ? 'Saving…' : 'Send out with our team'}
                    </button>
                  )}
                </div>
              </div>

              <form
                className="flex flex-col rounded-xl border border-[var(--out-line)] bg-white p-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (courierReady) onAction('set_tracking', { trackingNo: tracking, courierName: courier })
                }}
              >
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--out-ivory)]">
                    <Building2 className="h-4 w-4 text-[var(--out-bark)]" aria-hidden />
                  </span>
                  A courier company
                </p>
                <p className="mt-1 text-xs text-[var(--out-muted)]">Add the tracking number so the customer can follow it live.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input
                    value={courier}
                    onChange={(e) => onCourierChange(e.target.value)}
                    list="outdoor-courier-suggestions"
                    maxLength={120}
                    placeholder="Courier, e.g. J&T"
                    aria-label="Courier"
                    className="h-10 min-w-0 rounded-md border border-[var(--out-line)] px-3 text-sm"
                  />
                  <input
                    value={tracking}
                    onChange={(e) => onTrackingChange(e.target.value)}
                    maxLength={60}
                    placeholder="Tracking number"
                    aria-label="Tracking number"
                    className="h-10 min-w-0 rounded-md border border-[var(--out-line)] px-3 font-mono text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy || !courierReady}
                  className="mt-2 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--out-bark)] px-4 text-sm font-semibold text-[var(--out-bark)] hover:bg-[var(--out-ivory)] disabled:border-[var(--out-line)] disabled:text-[var(--out-muted)] disabled:hover:bg-transparent"
                >
                  <Truck className="h-4 w-4" aria-hidden />
                  {busy ? 'Saving…' : 'Save and mark as shipped'}
                </button>
                {o.shipping_service_id && easyParcelConfigured && easyParcelBooking ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAction('ship_easyparcel')}
                    className="mt-2 text-xs font-semibold text-[var(--out-burgundy)] hover:underline disabled:opacity-50"
                  >
                    Or book it with EasyParcel
                  </button>
                ) : null}
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  )
}

export default function OutdoorFulfilmentClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab = tabParam === 'inbox' ? 'inbox' : tabParam === 'requests' ? 'requests' : 'orders'
  const [requestsRefresh, setRequestsRefresh] = useState(0)
  const [orderStatus, setOrderStatus] = useState('fulfilment')
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [messages, setMessages] = useState<ContactMessage[]>([])
  const [easyParcelConfigured, setEasyParcelConfigured] = useState(false)
  const [easyParcelNeedsConnect, setEasyParcelNeedsConnect] = useState(false)
  const [easyParcelCredit, setEasyParcelCredit] = useState<number | null>(null)
  const [easyParcelBooking, setEasyParcelBooking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [trackingDraft, setTrackingDraft] = useState<Record<string, string>>({})
  const [courierDraft, setCourierDraft] = useState<Record<string, string>>({})

  const loadOrders = useCallback(async () => {
    const params = new URLSearchParams({ status: orderStatus })
    if (search.trim()) params.set('search', search.trim())
    const res = await fetch(`/api/outdoor/fulfilment?${params}`)
    const data = await res.json().catch(() => null)
    if (res.status === 401) {
      setAllowed(false)
      return
    }
    if (!res.ok) throw new Error(data?.error || 'Failed to load orders')
    setOrders(data.orders || [])
    setEasyParcelConfigured(Boolean(data.easyParcelConfigured))
    setEasyParcelNeedsConnect(Boolean(data.easyParcelNeedsConnect))
    setEasyParcelCredit(typeof data.easyParcelCredit === 'number' ? data.easyParcelCredit : null)
    setEasyParcelBooking(Boolean(data.easyParcelBooking))
  }, [search, orderStatus])

  const loadInbox = useCallback(async () => {
    const res = await fetch('/api/outdoor/contact?limit=40')
    const data = await res.json().catch(() => null)
    if (res.status === 401) {
      setAllowed(false)
      return
    }
    if (!res.ok) throw new Error(data?.error || 'Failed to load inbox')
    setMessages(data.messages || [])
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const access = await fetch('/api/outdoor/fulfilment/access')
      const accessData = await access.json().catch(() => null)
      if (!accessData?.allowed) {
        setAllowed(false)
        return
      }
      setAllowed(true)
      if (tab === 'orders') await loadOrders()
      else if (tab === 'inbox') await loadInbox()
      else setRequestsRefresh((n) => n + 1)
    } catch (err: any) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [tab, loadOrders, loadInbox])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    document.getElementById(`outdoor-${tab === 'inbox' ? 'messages' : tab}`)?.scrollIntoView({ block: 'start' })
  }, [tab])

  useEffect(() => {
    const status = searchParams.get('easyparcel')
    if (status === 'connected') setNotice('EasyParcel connected.')
    if (status === 'error' || status === 'invalid') setError('EasyParcel connection failed. Try Connect again.')
    if (status === 'unauthorized') setError('Log in as HQ staff, then Connect EasyParcel.')
  }, [searchParams])

  const runAction = async (id: string, action: string, extra?: Record<string, string>) => {
    setBusyId(id)
    setError('')
    try {
      const res = await fetch('/api/outdoor/fulfilment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, ...extra }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Update failed')
      await loadOrders()
    } catch (err: any) {
      setError(err.message || 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  if (allowed === false) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 text-center">
        <h1 className="font-display text-3xl">Staff only</h1>
        <p className="mt-3 text-sm text-[var(--out-muted)]">
          This page is for warehouse and HQ staff — not for shoppers.
        </p>
        <Link href="/outdoor/shop" className="mt-6 inline-block text-[var(--out-moss)] font-semibold">
          Back to shop
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-5 sm:px-8 py-12 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Staff desk</h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--out-muted)]">
            Pack, send out and follow every Outdoor order. Each order, with its full history, is also in the
            dashboard under Store Orders.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/ecommerce/store-orders?channel=outdoor"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--out-line)] px-4 text-sm font-medium hover:bg-white"
          >
            <LayoutDashboard className="h-4 w-4" aria-hidden />
            Open in dashboard
          </a>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 px-4 rounded-md border border-[var(--out-line)] text-sm font-medium hover:bg-white disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div id={`outdoor-${tab === 'inbox' ? 'messages' : tab}`} className="mt-6 flex gap-2 border-b border-[var(--out-line)] scroll-mt-28">
        <button
          type="button"
          onClick={() => router.push('/outdoor/fulfilment')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
            tab === 'orders' ? 'border-[var(--out-moss)]' : 'border-transparent text-[var(--out-muted)]'
          }`}
        >
          <ClipboardList className="h-4 w-4" aria-hidden />
          Follow orders
        </button>
        <button
          type="button"
          onClick={() => router.push('/outdoor/fulfilment?tab=inbox')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
            tab === 'inbox' ? 'border-[var(--out-moss)]' : 'border-transparent text-[var(--out-muted)]'
          }`}
        >
          <Inbox className="h-4 w-4" aria-hidden />
          Messages
        </button>
        <button
          type="button"
          onClick={() => router.push('/outdoor/fulfilment?tab=requests')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
            tab === 'requests' ? 'border-[var(--out-moss)]' : 'border-transparent text-[var(--out-muted)]'
          }`}
        >
          <LifeBuoy className="h-4 w-4" aria-hidden />
          Requests
        </button>
      </div>

      {tab === 'orders' ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {ORDER_FILTERS.map(({ value, label, icon: FilterIcon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setOrderStatus(value)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${
                orderStatus === value ? 'bg-[var(--out-bark)] text-[var(--out-cream)]' : 'border border-[var(--out-line)]'
              }`}
            >
              <FilterIcon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'orders' ? (
        <div className="mt-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--out-muted)]" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Order number, customer name, phone, email or tracking…"
              className="h-11 w-full rounded-md border border-[var(--out-line)] bg-white pl-9 pr-3 text-sm"
            />
          </div>
          <p className="flex items-center gap-2 text-xs text-[var(--out-muted)]">
            <span
              className={`h-2 w-2 rounded-full ${easyParcelConfigured ? 'bg-emerald-500' : 'bg-[var(--out-line)]'}`}
              aria-hidden
            />
            {easyParcelConfigured
              ? !easyParcelBooking
                ? 'Courier tracking is on (EasyParcel)'
                : easyParcelCredit == null
                  ? 'EasyParcel booking is on'
                  : <>EasyParcel booking is on · credit <span className={easyParcelCredit <= 0 ? 'font-semibold text-red-600' : ''}>{money(easyParcelCredit)}</span></>
              : easyParcelNeedsConnect
                ? 'Courier tracking is not connected yet'
                : 'Courier tracking is off. Tracking numbers still save.'}
          </p>
          {easyParcelNeedsConnect ? (
            <a
              href="/api/shipping/easyparcel/oauth/connect"
              className="inline-flex h-11 items-center rounded-md bg-[var(--out-moss)] px-4 text-sm font-semibold text-white"
            >
              Connect EasyParcel
            </a>
          ) : null}
        </div>
      ) : null}

      {notice ? <p className="mt-4 text-sm text-[var(--out-moss)]">{notice}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-10 text-sm text-[var(--out-muted)]">Loading…</p>
      ) : tab === 'requests' ? (
        <OutdoorRequestsDesk refreshKey={requestsRefresh} />
      ) : tab === 'inbox' ? (
        messages.length === 0 ? (
          <p className="mt-10 text-sm text-[var(--out-muted)]">No messages yet. Anything sent from the Contact page lands here.</p>
        ) : (
          <ul className="mt-8 space-y-4">
            {messages.map((m) => (
              <li key={m.id} className="rounded-xl border border-[var(--out-line)] bg-white p-5">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <User className="h-4 w-4 text-[var(--out-muted)]" aria-hidden />
                    {m.name}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-[var(--out-muted)]">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {new Date(m.created_at).toLocaleString()}
                  </p>
                </div>
                <a href={`mailto:${m.email}`} className="mt-1 inline-flex items-center gap-1.5 text-sm text-[var(--out-moss)] hover:underline">
                  <Mail className="h-3.5 w-3.5" aria-hidden />
                  {m.email}
                </a>
                <p className="mt-3 text-sm text-[var(--out-ink-soft)] whitespace-pre-wrap">{m.message}</p>
              </li>
            ))}
          </ul>
        )
      ) : orders.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-[var(--out-line)] bg-white/60 px-6 py-12 text-center">
          <p className="font-semibold">
            {search.trim() ? `No orders match “${search.trim()}”` : EMPTY_STATE[orderStatus]?.title || 'No orders yet'}
          </p>
          <p className="mt-1 text-sm text-[var(--out-muted)]">
            {search.trim() ? 'Try the order number, the customer’s name, phone or email.' : EMPTY_STATE[orderStatus]?.hint}
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-5">
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              busy={busyId === o.id}
              easyParcelBooking={easyParcelBooking}
              easyParcelConfigured={easyParcelConfigured}
              courier={courierDraft[o.id] || ''}
              tracking={trackingDraft[o.id] || ''}
              onCourierChange={(v) => setCourierDraft((d) => ({ ...d, [o.id]: v }))}
              onTrackingChange={(v) => setTrackingDraft((d) => ({ ...d, [o.id]: v }))}
              onAction={(action, extra) => void runAction(o.id, action, extra)}
            />
          ))}
        </ul>
      )}

      <datalist id="outdoor-courier-suggestions">
        {COURIER_SUGGESTIONS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <p className="mt-10 text-xs text-[var(--out-muted)]">
        <button type="button" className="underline" onClick={() => router.push('/outdoor')}>
          Back to Outdoor
        </button>
      </p>
    </div>
  )
}
