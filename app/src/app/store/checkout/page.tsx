'use client'

import { useState } from 'react'
import { useCart } from '@/lib/storefront/cart-context'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  ShoppingBag,
  Lock,
  User,
  Phone,
  Mail,
  MapPin,
} from 'lucide-react'

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(price)
}

interface CheckoutForm {
  name: string
  email: string
  phone: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postcode: string
}

const INITIAL_FORM: CheckoutForm = {
  name: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postcode: '',
}

const MY_STATES = [
  'Johor',
  'Kedah',
  'Kelantan',
  'Kuala Lumpur',
  'Labuan',
  'Melaka',
  'Negeri Sembilan',
  'Pahang',
  'Penang',
  'Perak',
  'Perlis',
  'Putrajaya',
  'Sabah',
  'Sarawak',
  'Selangor',
  'Terengganu',
]

export default function CheckoutPage() {
  const { items, subtotal, clearCart } = useCart()
  const router = useRouter()
  const [form, setForm] = useState<CheckoutForm>(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const isValid =
    form.name.trim() &&
    form.email.trim() &&
    form.phone.trim() &&
    form.addressLine1.trim() &&
    form.city.trim() &&
    form.state &&
    form.postcode.trim()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid || submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/storefront/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: form,
          items: items.map((i) => ({
            variantId: i.variantId,
            quantity: i.quantity,
          })),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        setSubmitting(false)
        return
      }

      // If the API returns a payment redirect URL, navigate there
      if (data.paymentUrl) {
        clearCart()
        window.location.href = data.paymentUrl
        return
      }

      // Otherwise, go to success page
      clearCart()
      router.push(`/store/orders/success?ref=${data.orderRef}`)
    } catch {
      setError('Network error. Please try again.')
      setSubmitting(false)
    }
  }

  if (items.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <ShoppingBag className="h-20 w-20 text-gray-200 mx-auto mb-6" />
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Nothing to checkout</h1>
        <p className="text-gray-500 mb-8">Add some products to your cart first.</p>
        <Link
          href="/store/products"
          className="inline-flex items-center gap-2 h-11 px-6 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition"
        >
          Browse Products
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back */}
      <Link
        href="/store/cart"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to cart
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-8">Checkout</h1>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* ── Left: Form ── */}
          <div className="lg:col-span-3 space-y-6">
            {/* Contact */}
            <fieldset className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <legend className="text-sm font-semibold text-gray-900 px-1">Contact Information</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <InputField
                  icon={<User className="h-4 w-4" />}
                  name="name"
                  label="Full Name"
                  value={form.name}
                  onChange={handleChange}
                  required
                />
                <InputField
                  icon={<Mail className="h-4 w-4" />}
                  name="email"
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                />
                <InputField
                  icon={<Phone className="h-4 w-4" />}
                  name="phone"
                  label="Phone Number"
                  type="tel"
                  value={form.phone}
                  onChange={handleChange}
                  required
                  className="sm:col-span-2"
                />
              </div>
            </fieldset>

            {/* Shipping */}
            <fieldset className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <legend className="text-sm font-semibold text-gray-900 px-1">Shipping Address</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <InputField
                  icon={<MapPin className="h-4 w-4" />}
                  name="addressLine1"
                  label="Address Line 1"
                  value={form.addressLine1}
                  onChange={handleChange}
                  required
                  className="sm:col-span-2"
                />
                <InputField
                  name="addressLine2"
                  label="Address Line 2 (optional)"
                  value={form.addressLine2}
                  onChange={handleChange}
                  className="sm:col-span-2"
                />
                <InputField
                  name="city"
                  label="City"
                  value={form.city}
                  onChange={handleChange}
                  required
                />
                <div className="flex flex-col">
                  <label className="text-xs font-medium text-gray-500 mb-1">State *</label>
                  <select
                    name="state"
                    value={form.state}
                    onChange={handleChange}
                    required
                    className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                  >
                    <option value="">Select state</option>
                    {MY_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <InputField
                  name="postcode"
                  label="Postcode"
                  value={form.postcode}
                  onChange={handleChange}
                  required
                  inputMode="numeric"
                  maxLength={5}
                />
              </div>
            </fieldset>
          </div>

          {/* ── Right: Order Summary ── */}
          <div className="lg:col-span-2">
            <div className="sticky top-24 bg-gray-50 rounded-xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Order Summary</h3>
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {items.map((item) => (
                  <div key={item.variantId} className="flex items-start gap-3">
                    <div className="flex-none w-10 h-10 rounded-lg bg-white border border-gray-100 overflow-hidden flex items-center justify-center">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ShoppingBag className="h-4 w-4 text-gray-200" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 line-clamp-1">
                        {item.productName}
                      </p>
                      <p className="text-xs text-gray-400">
                        {item.variantName} × {item.quantity}
                      </p>
                    </div>
                    <p className="text-xs font-semibold text-gray-900 flex-none">
                      {item.price ? formatPrice(item.price * item.quantity) : '-'}
                    </p>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-200 mt-4 pt-4 space-y-2">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Subtotal</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Shipping</span>
                  <span className="text-gray-400">Free</span>
                </div>
                <div className="border-t border-gray-200 pt-3 flex justify-between text-base font-bold text-gray-900">
                  <span>Total</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="mt-4 rounded-lg bg-red-50 border border-red-100 p-3 text-xs text-red-600">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={!isValid || submitting}
                className="mt-6 w-full h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition bg-gray-900 text-white hover:bg-gray-800 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    Place Order & Pay
                  </>
                )}
              </button>

              <p className="mt-3 text-[10px] text-gray-400 flex items-center justify-center gap-1">
                <Lock className="h-3 w-3" />
                Secured payment via payment gateway
              </p>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

// ── Reusable Input ────────────────────────────────────────────────

function InputField({
  icon,
  name,
  label,
  type = 'text',
  value,
  onChange,
  required,
  className,
  inputMode,
  maxLength,
}: {
  icon?: React.ReactNode
  name: string
  label: string
  type?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  required?: boolean
  className?: string
  inputMode?: 'numeric' | 'text'
  maxLength?: number
}) {
  return (
    <div className={`flex flex-col ${className || ''}`}>
      <label htmlFor={name} className="text-xs font-medium text-gray-500 mb-1">
        {label}
        {required && ' *'}
      </label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>
        )}
        <input
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          required={required}
          inputMode={inputMode}
          maxLength={maxLength}
          className={`w-full h-10 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 transition-shadow ${
            icon ? 'pl-10' : 'pl-3'
          } pr-3`}
        />
      </div>
    </div>
  )
}
