'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { OUTDOOR_COLOURWAYS, outdoorColorFromText } from '@/lib/outdoor/merch'

type ColorDraft = {
  key: string
  id: string
  name: string
  price: string
  removed?: boolean
}

type ProductDraft = {
  id: string
  name: string
  price: string
  color: string
  description: string
  imageUrl: string
  colors: ColorDraft[]
}

const fieldClass = 'mt-1.5 w-full rounded-md border border-[var(--out-line)] bg-white px-3 text-[var(--out-bark)] outline-none focus:border-[var(--out-moss)]'

function ColorChoice({ value, onPick }: { value: string; onPick: (label: string) => void }) {
  const current = outdoorColorFromText(value)
  const known = current ? OUTDOOR_COLOURWAYS.find((way) => way.hex.toLowerCase() === current.hex.toLowerCase()) : undefined
  const custom = Boolean(current && !known)
  return (
    <div className="mt-2 flex items-center gap-3">
      <span
        aria-hidden
        className={`h-10 w-10 shrink-0 rounded-full border ${current ? 'border-black/10' : 'border-dashed border-[var(--out-line)] bg-white'}`}
        style={current ? { background: current.hex } : undefined}
      />
      <select
        value={known?.label || (custom ? 'custom' : '')}
        onChange={(event) => {
          const next = event.target.value
          if (!next) onPick('')
          else if (next === 'custom') onPick(custom && current ? current.hex : '#D7C4A3')
          else onPick(next)
        }}
        className={`${fieldClass} mt-0 h-11`}
      >
        <option value="">Pick a color</option>
        {OUTDOOR_COLOURWAYS.map((way) => (
          <option key={way.hex} value={way.label}>{way.label}</option>
        ))}
        <option value="custom">Custom color</option>
      </select>
      {custom ? (
        <input
          type="color"
          aria-label="Custom color"
          value={current?.hex || '#D7C4A3'}
          onChange={(event) => onPick(event.target.value.toUpperCase())}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-[var(--out-line)] bg-white p-1"
        />
      ) : null}
    </div>
  )
}

function ProductSheet({
  name,
  price,
  color,
  description,
  imageUrl,
  colors,
  saving,
  submitLabel,
  onName,
  onPrice,
  onColor,
  onDescription,
  onImage,
  onColors,
  onDelete,
  onSubmit,
  compact,
}: {
  name: string
  price: string
  color: string
  description: string
  imageUrl: string
  colors?: ColorDraft[]
  saving: boolean
  submitLabel: string
  onName: (value: string) => void
  onPrice: (value: string) => void
  onColor: (value: string) => void
  onDescription: (value: string) => void
  onImage: (file: File) => void
  onColors?: (colors: ColorDraft[]) => void
  onDelete?: () => void
  onSubmit: (event: React.FormEvent) => void
  compact?: boolean
}) {
  return (
    <form onSubmit={onSubmit} className="w-full">
      <div className="relative overflow-hidden rounded-[1.6rem] bg-white p-4 sm:p-6">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className={`mx-auto h-auto w-full object-contain ${compact ? 'max-h-56' : 'max-h-[58vh]'}`} />
        ) : (
          <div className="flex aspect-square items-center justify-center text-sm text-[var(--out-muted)]">Add a photo</div>
        )}
        <label className="absolute bottom-4 right-4 cursor-pointer rounded-full bg-[var(--out-bark)] px-4 py-2 text-xs font-semibold text-[var(--out-cream)]">
          Change photo
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onImage(file)
              event.target.value = ''
            }}
          />
        </label>
      </div>

      <div className="mt-4 space-y-3 rounded-[1.6rem] bg-white p-4 sm:p-5">
        <label className="block text-sm font-medium text-[var(--out-bark)]">
          Name
          <input value={name} onChange={(event) => onName(event.target.value)} required placeholder="Product name" className={`${fieldClass} h-11 text-base`} />
        </label>
        <label className="block text-sm font-medium text-[var(--out-bark)]">
          Price (RM)
          <input value={price} onChange={(event) => onPrice(event.target.value)} required type="number" min="0.01" step="0.01" placeholder="0.00" className={`${fieldClass} h-11`} />
        </label>
        {colors && onColors ? (
          <div>
            <p className="text-sm font-medium text-[var(--out-bark)]">Colors</p>
            <p className="mt-1 text-sm text-[var(--out-muted)]">Each box is one color. Add another box if the product has more colors.</p>
            <div className="mt-3 space-y-3">
              {colors.filter((item) => !item.removed).map((item, index, visible) => (
                <div key={item.key} className="rounded-xl border border-[var(--out-line)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--out-bark)]">Color {index + 1}</p>
                    {visible.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => onColors(colors.map((row) => row.key === item.key ? { ...row, removed: true } : row))}
                        className="text-sm font-semibold text-red-700"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <ColorChoice
                    value={item.name}
                    onPick={(label) => {
                      const next = colors.map((row) => row.key === item.key ? { ...row, name: label } : row)
                      onColors(next)
                      if (index === 0) onColor(label)
                    }}
                  />
                  <label className="mt-3 block max-w-[10rem] text-sm font-medium text-[var(--out-bark)]">
                    Price for this color (RM)
                    <input
                      value={item.price}
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder={price || '0.00'}
                      onChange={(event) => onColors(colors.map((row) => row.key === item.key ? { ...row, price: event.target.value } : row))}
                      className={`${fieldClass} h-11`}
                    />
                  </label>
                </div>
              ))}
              <button
                type="button"
                onClick={() => onColors([...colors, { key: `new-${Date.now()}`, id: '', name: '', price, removed: false }])}
                className="inline-flex h-11 w-full items-center justify-center rounded-full border border-[var(--out-line)] bg-white text-sm font-semibold text-[var(--out-bark)]"
              >
                Add another color
              </button>
            </div>
          </div>
        ) : (
          <div className="block text-sm font-medium text-[var(--out-bark)]">
            Color
            <ColorChoice value={color} onPick={onColor} />
          </div>
        )}
        <label className="block text-sm font-medium text-[var(--out-bark)]">
          Description
          <textarea value={description} onChange={(event) => onDescription(event.target.value)} rows={4} placeholder="Description" className={`${fieldClass} resize-y py-2 leading-relaxed`} />
        </label>
      </div>
      <button type="submit" disabled={saving} className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-full bg-[var(--out-moss)] text-sm font-semibold text-white hover:bg-[var(--out-moss-deep)] disabled:opacity-40">
        {saving ? 'Saving…' : submitLabel}
      </button>
      {onDelete ? (
        <button type="button" disabled={saving} onClick={onDelete} className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-full border-2 border-red-700 bg-white text-sm font-semibold text-red-700 disabled:opacity-40">
          Delete this product
        </button>
      ) : null}
    </form>
  )
}

export default function OutdoorAdminClient() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [subscribers, setSubscribers] = useState(0)
  const [products, setProducts] = useState<ProductDraft[]>([])
  const [productName, setProductName] = useState('')
  const [productPrice, setProductPrice] = useState('')
  const [productColor, setProductColor] = useState('')
  const [productDescription, setProductDescription] = useState('')
  const [productImage, setProductImage] = useState('')
  const [newColors, setNewColors] = useState<ColorDraft[]>([{ key: 'new-1', id: '', name: '', price: '' }])
  const [adding, setAdding] = useState(false)
  const [savingId, setSavingId] = useState('')
  const [uploading, setUploading] = useState(false)
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
      imageUrl: item.imageUrl || '',
      colors: (item.colors || []).map((color: any, index: number) => ({
        key: color.id || `color-${index}`,
        id: color.id || '',
        name: color.name || '',
        price: color.price ? String(color.price) : '',
      })),
    })))
  }

  useEffect(() => {
    void load()
  }, [])

  const emailedNote = (count: number) => `Emailed ${count} subscriber${count === 1 ? '' : 's'}.`

  const uploadPhoto = async (file: File) => {
    setUploading(true)
    setError('')
    try {
      const body = new FormData()
      body.set('file', file)
      const res = await fetch('/api/outdoor/products/image', { method: 'POST', body })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) throw new Error(data?.error || 'Could not upload the photo')
      return String(data.url)
    } finally {
      setUploading(false)
    }
  }

  const addProduct = async (event: React.FormEvent) => {
    event.preventDefault()
    setSavingId('new')
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
          imageUrl: productImage,
          colors: newColors.filter((item) => item.name.trim()).map((item) => ({
            id: '',
            name: item.name,
            price: Number(item.price || productPrice),
            removed: false,
          })),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not add the product')
      setProductName('')
      setProductPrice('')
      setProductColor('')
      setProductDescription('')
      setProductImage('')
      setNewColors([{ key: 'new-1', id: '', name: '', price: '' }])
      setAdding(false)
      setMessage(`Product added. ${emailedNote(data.emailed || 0)}`)
      await load()
    } catch (err: any) {
      setError(err.message || 'Could not add the product')
    } finally {
      setSavingId('')
    }
  }

  const saveProduct = async (event: React.FormEvent, product: ProductDraft) => {
    event.preventDefault()
    setSavingId(product.id)
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
          imageUrl: product.imageUrl,
          colors: product.colors.filter((item) => item.name.trim() || item.id).map((item) => ({
            id: item.id,
            name: item.name,
            price: Number(item.price || product.price),
            removed: Boolean(item.removed),
          })),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not save the product')
      setMessage(`Saved ${product.name}. ${emailedNote(data.emailed || 0)}`)
      await load()
    } catch (err: any) {
      setError(err.message || 'Could not save the product')
    } finally {
      setSavingId('')
    }
  }

  const updateDraft = (id: string, patch: Partial<ProductDraft>, syncColorPrices = false) => {
    setProducts((current) => current.map((item) => {
      if (item.id !== id) return item
      const next = { ...item, ...patch }
      if (syncColorPrices && patch.price != null) {
        next.colors = item.colors.map((color) => color.price === item.price ? { ...color, price: patch.price || '' } : color)
      }
      return next
    }))
  }

  const deleteProduct = async (product: ProductDraft) => {
    if (!window.confirm(`Delete ${product.name} from the Outdoor shop?`)) return
    setSavingId(product.id)
    setMessage('')
    setError('')
    try {
      const res = await fetch('/api/outdoor/products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not delete the product')
      setMessage(`${product.name} was removed. ${emailedNote(data.emailed || 0)}`)
      await load()
    } catch (err: any) {
      setError(err.message || 'Could not delete the product')
    } finally {
      setSavingId('')
    }
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
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--out-muted)]">Admin</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Outdoor desk</h1>
      <p className="mt-2 text-sm text-[var(--out-muted)]">
        {subscribers} newsletter subscriber{subscribers === 1 ? '' : 's'}. Adding or changing a product emails them automatically.
      </p>
      <div className="mt-4">
        <button type="button" onClick={() => setAdding((open) => !open)} className="inline-flex h-10 items-center rounded-full border border-[var(--out-line)] bg-white px-4 text-sm font-semibold text-[var(--out-bark)]">
          {adding ? 'Close' : 'New product'}
        </button>
      </div>

      {error ? <p className="mt-6 text-sm text-red-600">{error}</p> : null}
      {message ? <p className="mt-6 text-sm font-medium text-emerald-700">{message}</p> : null}
      {uploading ? <p className="mt-4 text-sm text-[var(--out-muted)]">Uploading photo…</p> : null}

      {adding ? (
        <div className="mt-8 max-w-xl">
          <ProductSheet
            name={productName}
            price={productPrice}
            color={productColor}
            description={productDescription}
            imageUrl={productImage}
            colors={newColors}
            saving={savingId === 'new' || uploading}
            submitLabel="Add product"
            onName={setProductName}
            onPrice={setProductPrice}
            onColor={setProductColor}
            onDescription={setProductDescription}
            onColors={(colors) => {
              setNewColors(colors)
              const first = colors.find((item) => !item.removed)
              setProductColor(first?.name || '')
            }}
            onImage={(file) => {
              void uploadPhoto(file).then(setProductImage).catch((err: any) => setError(err.message || 'Could not upload the photo'))
            }}
            onSubmit={addProduct}
          />
        </div>
      ) : null}

      <div className="mt-10 grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
        {products.length === 0 ? <p className="text-sm text-[var(--out-muted)]">No outdoor products yet.</p> : null}
        {products.map((product) => (
          <ProductSheet
            key={product.id}
            name={product.name}
            price={product.price}
            color={product.color}
            description={product.description}
            imageUrl={product.imageUrl}
            colors={product.colors}
            saving={savingId === product.id || uploading}
            submitLabel="Save"
            compact
            onName={(value) => updateDraft(product.id, { name: value })}
            onPrice={(value) => updateDraft(product.id, { price: value }, true)}
            onColor={(value) => updateDraft(product.id, { color: value })}
            onDescription={(value) => updateDraft(product.id, { description: value })}
            onColors={(colors) => updateDraft(product.id, { colors })}
            onDelete={() => void deleteProduct(product)}
            onImage={(file) => {
              void uploadPhoto(file)
                .then((url) => updateDraft(product.id, { imageUrl: url }))
                .catch((err: any) => setError(err.message || 'Could not upload the photo'))
            }}
            onSubmit={(event) => saveProduct(event, product)}
          />
        ))}
      </div>
    </div>
  )
}
