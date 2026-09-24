'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { OUTDOOR_COLOURWAYS, outdoorColorFromText } from '@/lib/outdoor/merch'
import { getStorageUrl } from '@/lib/utils'

type ColorDraft = {
  key: string
  id: string
  name: string
  price: string
  removed?: boolean
}

type CategoryOption = { id: string; name: string }

type ProductDraft = {
  id: string
  name: string
  price: string
  color: string
  description: string
  imageUrl: string
  categoryId: string
  colors: ColorDraft[]
}

const fieldClass = 'mt-1.5 w-full rounded-md border border-[var(--out-line)] bg-white px-3 text-[var(--out-bark)] outline-none focus:border-[var(--out-moss)]'

function websiteColor(name: string) {
  const found = outdoorColorFromText(name)
  if (!found) return null
  return OUTDOOR_COLOURWAYS.find((way) => way.hex.toLowerCase() === found.hex.toLowerCase()) || null
}

function withWebsiteColors(saved: ColorDraft[], fallbackPrice: string): ColorDraft[] {
  const recognized = saved.filter((item) => outdoorColorFromText(item.name))
  if (recognized.length > 0) {
    return recognized.map((item) => {
      const official = websiteColor(item.name)
      return official ? { ...item, name: official.label } : item
    })
  }
  const unnamed = saved.filter((item) => item.id)
  return OUTDOOR_COLOURWAYS.map((way, index) => {
    const donor = unnamed[index]
    return {
      key: donor?.id || way.hex,
      id: donor?.id || '',
      name: way.label,
      price: donor?.price || fallbackPrice,
    }
  })
}

function nextColor(colors: ColorDraft[], price: string): ColorDraft {
  const visible = colors.filter((item) => !item.removed)
  const missing = OUTDOOR_COLOURWAYS.find((way) => !visible.some((item) => websiteColor(item.name)?.label === way.label))
  if (missing) {
    return { key: `add-${missing.hex}-${Date.now()}`, id: '', name: missing.label, price, removed: false }
  }
  return { key: `new-${Date.now()}`, id: '', name: '#D7C4A3', price, removed: false }
}

function ProductSheet({
  name,
  price,
  color,
  description,
  imageUrl,
  colors,
  categoryId,
  categories,
  saving,
  submitLabel,
  onName,
  onPrice,
  onColor,
  onDescription,
  onImage,
  onCategory,
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
  categoryId?: string
  categories?: CategoryOption[]
  saving: boolean
  submitLabel: string
  onName: (value: string) => void
  onPrice: (value: string) => void
  onColor: (value: string) => void
  onDescription: (value: string) => void
  onImage: (file: File) => void
  onCategory?: (value: string) => void
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
          <img src={getStorageUrl(imageUrl) || imageUrl} alt="" className={`mx-auto h-auto w-full object-contain ${compact ? 'max-h-56' : 'max-h-[58vh]'}`} />
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
        {categories && categories.length > 0 && onCategory ? (
          <label className="block text-sm font-medium text-[var(--out-bark)]">
            Category
            <select value={categoryId || categories[0]?.id || ''} onChange={(event) => onCategory(event.target.value)} className={`${fieldClass} h-11`}>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block text-sm font-medium text-[var(--out-bark)]">
          Price (RM)
          <input value={price} onChange={(event) => onPrice(event.target.value)} required type="number" min="0.01" step="0.01" placeholder="0.00" className={`${fieldClass} h-11`} />
        </label>
        {colors && onColors ? (
          <div>
            <p className="text-sm font-medium text-[var(--out-bark)]">Colors</p>
            <p className="mt-1 text-sm text-[var(--out-muted)]">The 3 shop colors are already here. Change a price, remove one, or add another.</p>
            <div className="mt-3 space-y-2">
              {colors.filter((item) => !item.removed).map((item) => {
                const official = websiteColor(item.name)
                const swatch = official || outdoorColorFromText(item.name)
                return (
                  <div key={item.key} className="flex items-center gap-2 rounded-2xl border border-[var(--out-line)] px-3 py-2">
                    <span aria-hidden className="h-9 w-9 shrink-0 rounded-full border border-black/10" style={{ background: swatch?.hex || '#D7C4A3' }} />
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--out-bark)]">{official?.label || 'Custom'}</p>
                    {official ? null : (
                      <input
                        type="color"
                        aria-label="Custom color"
                        value={swatch?.hex || '#D7C4A3'}
                        onChange={(event) => onColors(colors.map((row) => row.key === item.key ? { ...row, name: event.target.value.toUpperCase() } : row))}
                        className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-[var(--out-line)] bg-white p-1"
                      />
                    )}
                    <label className="flex items-center gap-1 text-xs font-medium text-[var(--out-muted)]">
                      RM
                      <input
                        aria-label={`Price for ${official?.label || 'custom color'}`}
                        value={item.price}
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder={price || '0.00'}
                        onChange={(event) => onColors(colors.map((row) => row.key === item.key ? { ...row, price: event.target.value } : row))}
                        className="h-10 w-[4.5rem] rounded-md border border-[var(--out-line)] bg-white px-2 text-sm text-[var(--out-bark)] outline-none focus:border-[var(--out-moss)]"
                      />
                    </label>
                    <button
                      type="button"
                      aria-label={`Remove ${official?.label || 'custom color'}`}
                      title="Remove"
                      onClick={() => {
                        const next = colors.map((row) => row.key === item.key ? { ...row, removed: true } : row)
                        onColors(next)
                        const first = next.find((row) => !row.removed)
                        onColor(first?.name || '')
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg leading-none text-red-700 hover:bg-red-50"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
              <button
                type="button"
                onClick={() => onColors([...colors, nextColor(colors, price)])}
                className="inline-flex h-11 w-full items-center justify-center rounded-full border border-[var(--out-line)] bg-white text-sm font-semibold text-[var(--out-bark)]"
              >
                Add a color
              </button>
            </div>
          </div>
        ) : null}
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
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [productName, setProductName] = useState('')
  const [productPrice, setProductPrice] = useState('')
  const [productColor, setProductColor] = useState(OUTDOOR_COLOURWAYS[0].label)
  const [productDescription, setProductDescription] = useState('')
  const [productImage, setProductImage] = useState('')
  const [productCategory, setProductCategory] = useState('')
  const [newColors, setNewColors] = useState<ColorDraft[]>(() => withWebsiteColors([], ''))
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
    const nextCategories = (data.categories || []).map((item: any) => ({ id: String(item.id), name: item.name || 'Category' }))
    setCategories(nextCategories)
    setProductCategory((current) => current || nextCategories[0]?.id || '')
    setProducts((data.products || []).map((item: any) => {
      const price = item.price ? String(item.price) : ''
      const colors = withWebsiteColors((item.colors || []).map((color: any, index: number) => ({
        key: color.id || `color-${index}`,
        id: color.id || '',
        name: color.name || '',
        price: color.price ? String(color.price) : '',
      })), price)
      return {
        id: item.id,
        name: item.name || '',
        price,
        color: colors[0]?.name || item.color || '',
        description: item.description || '',
        imageUrl: item.imageUrl || '',
        categoryId: item.categoryId || nextCategories[0]?.id || '',
        colors,
      }
    }))
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
          imageUrl: productImage.startsWith('blob:') ? '' : productImage,
          categoryId: productCategory,
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
      setProductCategory(categories[0]?.id || '')
      setNewColors(withWebsiteColors([], ''))
      setProductColor(OUTDOOR_COLOURWAYS[0].label)
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
          color: product.colors.find((item) => !item.removed && item.name.trim())?.name || product.color,
          description: product.description,
          imageUrl: product.imageUrl.startsWith('blob:') ? '' : product.imageUrl,
          categoryId: product.categoryId,
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
            categoryId={productCategory}
            categories={categories}
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
            onCategory={setProductCategory}
            onImage={(file) => {
              const preview = URL.createObjectURL(file)
              setProductImage(preview)
              void uploadPhoto(file).then((url) => {
                URL.revokeObjectURL(preview)
                setProductImage(url)
              }).catch((err: any) => {
                URL.revokeObjectURL(preview)
                setProductImage('')
                setError(err.message || 'Could not upload the photo')
              })
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
            categoryId={product.categoryId}
            categories={categories}
            saving={savingId === product.id || uploading}
            submitLabel="Save"
            compact
            onName={(value) => updateDraft(product.id, { name: value })}
            onPrice={(value) => updateDraft(product.id, { price: value }, true)}
            onColor={(value) => updateDraft(product.id, { color: value })}
            onDescription={(value) => updateDraft(product.id, { description: value })}
            onColors={(colors) => updateDraft(product.id, { colors })}
            onCategory={(value) => updateDraft(product.id, { categoryId: value })}
            onDelete={() => void deleteProduct(product)}
            onImage={(file) => {
              const preview = URL.createObjectURL(file)
              updateDraft(product.id, { imageUrl: preview })
              void uploadPhoto(file)
                .then((url) => {
                  URL.revokeObjectURL(preview)
                  updateDraft(product.id, { imageUrl: url })
                })
                .catch((err: any) => {
                  URL.revokeObjectURL(preview)
                  updateDraft(product.id, { imageUrl: '' })
                  setError(err.message || 'Could not upload the photo')
                })
            }}
            onSubmit={(event) => saveProduct(event, product)}
          />
        ))}
      </div>
    </div>
  )
}
