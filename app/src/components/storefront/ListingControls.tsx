'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useTransition } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'

type Category = { id: string; name: string }

const SORT_OPTIONS = [
  { label: 'Newest', value: '' },
  { label: 'Price: Low → High', value: 'price_asc' },
  { label: 'Price: High → Low', value: 'price_desc' },
  { label: 'Name A → Z', value: 'name_asc' },
]

interface Props {
  categories: Category[]
  currentCategory?: string
  currentSort?: string
  currentSearch?: string
}

export default function ProductListingControls({
  categories,
  currentCategory,
  currentSort,
  currentSearch,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  function buildUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    const merged = {
      search: currentSearch,
      sort: currentSort,
      category: currentCategory,
      ...overrides,
    }
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, v)
    })
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  function navigate(overrides: Record<string, string | undefined>) {
    startTransition(() => {
      router.push(buildUrl(overrides))
    })
  }

  /* search form */
  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const q = (fd.get('search') as string).trim()
    navigate({ search: q || undefined })
  }

  return (
    <div className="space-y-4">
      {/* Search + Sort row */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <form onSubmit={handleSearch} className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--sera-muted)]/70" />
          <input
            name="search"
            type="text"
            defaultValue={currentSearch ?? ''}
            placeholder="Search products..."
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-[var(--sera-line)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--sera-orange)]/25 focus:border-[var(--sera-orange)]/40"
          />
          {currentSearch && (
            <button
              type="button"
              onClick={() => navigate({ search: undefined })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--sera-muted)]/70 hover:text-[var(--sera-muted)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--sera-muted)]/70 hidden sm:block" />
          <select
            value={currentSort ?? ''}
            onChange={(e) =>
              navigate({ sort: e.target.value || undefined })
            }
            className="text-sm bg-white border border-[var(--sera-line)] rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[var(--sera-orange)]/25 focus:border-[var(--sera-orange)]/40"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Category pills */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate({ category: undefined })}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              !currentCategory
                ? 'bg-[var(--sera-ink)] text-white'
                : 'bg-[var(--sera-mist)] text-[var(--sera-muted)] hover:bg-[var(--sera-line)]'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() =>
                navigate({
                  category: cat.id === currentCategory ? undefined : cat.id,
                })
              }
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                cat.id === currentCategory
                  ? 'bg-[var(--sera-ink)] text-white'
                  : 'bg-[var(--sera-mist)] text-[var(--sera-muted)] hover:bg-[var(--sera-line)]'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Pending indicator */}
      {isPending && (
        <div className="h-0.5 bg-[var(--sera-orange)]/15 rounded-full overflow-hidden">
          <div className="h-full w-1/3 bg-[var(--sera-orange)] rounded-full animate-pulse" />
        </div>
      )}
    </div>
  )
}
