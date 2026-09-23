'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type ProductDraft = {
  id: string
  name: string
  price: string
  color: string
  description: string
}

const inputClass = 'mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] px-3'
const textClass = 'mt-1.5 w-full rounded-md border border-[var(--out-line)] px-3 py-2'

export default function OutdoorAdminClient() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [subscribers, setSubscribers] = useState(0)
  const [products, setProducts] = useState<ProductDraft[]>([])
  const [productName, setProductName] = useState('')
  const [productPrice, setProductPrice] = useState('')
  const [productColor, setProductColor] = useState('')
  const [productDescription, setProductDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    const access = await fetch('/api/outdoor/fulfilment/access')
    const accessData = await access.json().catch(() => null)
    if (!accessData?.allowed) {
      setAllowed(false)
      return
    }
    setAllowed(true)
    const res = await fetch('/api/outdoor/products')
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error || 'Could not load products')
      return
    }
    setSubscribers(data.subscribers || 0)
    setProducts((data.products || []).map((item: any) => ({
      id: item.id,
      name: item.name || '',
      price: item.price ? String(item.price) : '',
      color: item.color || '',
      description: item.description || '',
    })))
  }

  useEffect(() => {
    void load()
  }, [])

  const emailedNote = (count: number) => `Emailed ${count} subscriber${count === 1 ? '' : 's'}.`

  const addProduct = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const res = await fetch('/api/outdoor/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: productName,
          price: Number(productPrice),
          color: productColor,
          description: productDescription,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not add the product')
      setProductName('')
      setProductPrice('')
      setProductColor('')
      setProductDescription('')
      setMessage(`Product added. ${emailedNote(data.emailed || 0)}`)
      await load()
    } catch (err: any) {
      setError(err.message || 'Could not add the product')
    } finally {
      setSaving(false)
    }
  }

  const saveProduct = async (event: React.FormEvent, product: ProductDraft) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const res = await fetch('/api/outdoor/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: product.id,
          name: product.name,
          price: Number(product.price),
          color: product.color,
          description: product.description,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not save the product')
      setMessage(`Saved ${product.name}. ${emailedNote(data.emailed || 0)}`)
      await load()
    } catch (err: any) {
      setError(err.message || 'Could not save the product')
    } finally {
      setSaving(false)
    }
  }

  const updateDraft = (id: string, patch: Partial<ProductDraft>) => {
    setProducts((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  if (allowed === false) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 text-center">
        <h1 className="font-display text-3xl">Staff only</h1>
        <Link href="/outdoor/shop" className="mt-6 inline-block font-semibold text-[var(--out-moss)]">Back to shop</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--out-muted)]">Admin</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Outdoor desk</h1>
      <p className="mt-2 text-sm text-[var(--out-muted)]">
        {subscribers} newsletter subscriber{subscribers === 1 ? '' : 's'}. Adding or changing a product emails them automatically.
      </p>
      <div className="mt-4 flex gap-4 text-sm font-semibold">
        <Link href="/outdoor/fulfilment" className="text-[var(--out-moss)]">Follow orders</Link>
        <Link href="/outdoor/fulfilment?tab=inbox" className="text-[var(--out-moss)]">Messages</Link>
      </div>

      {error ? <p className="mt-6 text-sm text-red-600">{error}</p> : null}
      {message ? <p className="mt-6 text-sm font-medium text-emerald-700">{message}</p> : null}

      <form onSubmit={addProduct} className="mt-8 space-y-4 rounded-2xl border border-[var(--out-line)] bg-white p-5">
        <p className="font-semibold">Add a new product</p>
        <label className="block text-sm">
          Name
          <input value={productName} onChange={(e) => setProductName(e.target.value)} required className={inputClass} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            Price (RM)
            <input value={productPrice} onChange={(e) => setProductPrice(e.target.value)} required type="number" min="0.01" step="0.01" className={inputClass} />
          </label>
          <label className="block text-sm">
            Color
            <input value={productColor} onChange={(e) => setProductColor(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="block text-sm">
          Description
          <textarea value={productDescription} onChange={(e) => setProductDescription(e.target.value)} rows={3} className={textClass} />
        </label>
        <button type="submit" disabled={saving} className="h-11 rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? 'Adding…' : 'Add product'}
        </button>
      </form>

      <div className="mt-8 space-y-4">
        <p className="font-semibold">Current products</p>
        {products.length === 0 ? <p className="text-sm text-[var(--out-muted)]">No outdoor products yet.</p> : null}
        {products.map((product) => (
          <form key={product.id} onSubmit={(event) => saveProduct(event, product)} className="space-y-4 rounded-2xl border border-[var(--out-line)] bg-white p-5">
            <label className="block text-sm">
              Name
              <input value={product.name} onChange={(e) => updateDraft(product.id, { name: e.target.value })} required className={inputClass} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                Price (RM)
                <input value={product.price} onChange={(e) => updateDraft(product.id, { price: e.target.value })} required type="number" min="0.01" step="0.01" className={inputClass} />
              </label>
              <label className="block text-sm">
                Color
                <input value={product.color} onChange={(e) => updateDraft(product.id, { color: e.target.value })} className={inputClass} />
              </label>
            </div>
            <label className="block text-sm">
              Description
              <textarea value={product.description} onChange={(e) => updateDraft(product.id, { description: e.target.value })} rows={3} className={textClass} />
            </label>
            <button type="submit" disabled={saving} className="h-11 rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>
        ))}
      </div>
    </div>
  )
}
