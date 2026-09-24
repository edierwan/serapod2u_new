'use client'

import { useEffect, useMemo, useState } from 'react'
import type { StorefrontCategory, StorefrontProduct } from '@/lib/storefront/products'
import OutdoorProductGrid from '@/components/outdoor/OutdoorProductGrid'
import {
  outdoorProductMatchesSearch,
  sortOutdoorProducts,
  type OutdoorShopSort,
} from '@/lib/outdoor/shop-search'

const SORTS: OutdoorShopSort[] = ['newest', 'price_asc', 'price_desc', 'name_asc']

export default function OutdoorShopBrowser({
  products,
  categories,
  initialSearch = '',
  initialCategory = '',
  initialCollection = '',
  initialSort = 'newest',
  catalogueLinked = true,
}: {
  products: StorefrontProduct[]
  categories: StorefrontCategory[]
  initialSearch?: string
  initialCategory?: string
  initialCollection?: string
  initialSort?: string
  catalogueLinked?: boolean
}) {
  const [search, setSearch] = useState(initialSearch)
  const [category, setCategory] = useState(initialCategory)
  const [collection, setCollection] = useState(initialCollection)

  useEffect(() => {
    setCollection(initialCollection)
  }, [initialCollection])
  const [sort, setSort] = useState<OutdoorShopSort>(
    SORTS.includes(initialSort as OutdoorShopSort) ? (initialSort as OutdoorShopSort) : 'newest',
  )

  const newestRank = useMemo(() => {
    const rank = new Map<string, number>()
    products.forEach((product, index) => rank.set(product.id, index))
    return rank
  }, [products])

  const visible = useMemo(() => {
    const matched = products.filter((product) => {
      if (category && product.category_id !== category) return false
      if (collection && product.outdoorNav !== collection) return false
      return outdoorProductMatchesSearch(product, search)
    })
    return sortOutdoorProducts(matched, sort, newestRank)
  }, [products, category, collection, search, sort, newestRank])

  useEffect(() => {
    const url = new URL(window.location.href)
    const trimmed = search.trim()
    if (trimmed) url.searchParams.set('search', trimmed)
    else url.searchParams.delete('search')
    if (category) url.searchParams.set('category', category)
    else url.searchParams.delete('category')
    if (collection) url.searchParams.set('collection', collection)
    else url.searchParams.delete('collection')
    if (sort !== 'newest') url.searchParams.set('sort', sort)
    else url.searchParams.delete('sort')
    const next = `${url.pathname}${url.search}`
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(null, '', next)
    }
  }, [search, category, collection, sort])

  const showCategoryFilter = categories.length > 1

  return (
    <>
      <p className="mt-2 text-sm text-[var(--out-muted)]">
        {visible.length} products
        {catalogueLinked ? '' : ' · catalogue not linked yet'}
      </p>

      <div
        className={`mt-8 grid gap-3 ${
          showCategoryFilter
            ? 'sm:grid-cols-[1fr_180px_160px]'
            : 'sm:grid-cols-[1fr_160px]'
        }`}
      >
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search products"
          aria-label="Search products"
          className="h-11 rounded-md border border-[var(--out-line)] bg-white px-3 text-sm"
        />
        {showCategoryFilter ? (
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Category"
            className="h-11 rounded-md border border-[var(--out-line)] bg-white px-3 text-sm"
          >
            <option value="">All</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        ) : null}
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as OutdoorShopSort)}
          aria-label="Sort"
          className="h-11 rounded-md border border-[var(--out-line)] bg-white px-3 text-sm"
        >
          <option value="newest">Newest</option>
          <option value="name_asc">Name A–Z</option>
          <option value="price_asc">Price low–high</option>
          <option value="price_desc">Price high–low</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-[var(--out-line)] p-10 text-center">
          <p className="font-display text-2xl text-[var(--out-moss)]">No products found</p>
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setCategory('')
              setCollection('')
              setSort('newest')
            }}
            className="mt-4 text-sm font-semibold text-[var(--out-moss)] hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <OutdoorProductGrid products={visible} />
      )}
    </>
  )
}
