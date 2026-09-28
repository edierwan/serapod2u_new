'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'

// ── Types ────────────────────────────────────────────────────────

export interface CartItem {
  productId: string
  variantId: string
  productName: string
  variantName: string
  price: number | null
  imageUrl: string | null
  quantity: number
}

interface CartContextType {
  items: CartItem[]
  addItem: (item: Omit<CartItem, 'quantity'>, qty?: number) => void
  removeItem: (variantId: string) => void
  updateQuantity: (variantId: string, qty: number) => void
  clearCart: () => void
  totalItems: number
  subtotal: number
  hasItemsWithoutPrice: boolean
}

const CART_STORAGE_KEY = 'serapod2u_cart'

export function accountCartKey(storageKey: string, userId: string | null) {
  return userId ? `${storageKey}:user:${userId}` : storageKey
}

/** Guest items are added on top of the account bag; the same variant keeps the larger quantity. */
export function mergeCartItems(account: CartItem[], guest: CartItem[]) {
  const merged = account.map((item) => ({ ...item }))
  for (const item of guest) {
    const existing = merged.find((i) => i.variantId === item.variantId)
    if (existing) existing.quantity = Math.max(existing.quantity, item.quantity)
    else merged.push({ ...item })
  }
  return merged
}

function readStoredCart(key: string): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ── Context ──────────────────────────────────────────────────────

const CartContext = createContext<CartContextType | undefined>(undefined)

export function CartProvider({
  children,
  storageKey = CART_STORAGE_KEY,
  accountScoped = false,
}: {
  children: ReactNode
  /** Override for isolated storefronts (e.g. Outdoor). Default keeps Serapod2U Store behaviour. */
  storageKey?: string
  /** Keep a separate bag per signed-in account; the guest bag moves into the account on sign-in. */
  accountScoped?: boolean
}) {
  const [items, setItems] = useState<CartItem[]>([])
  const [mounted, setMounted] = useState(false)
  const [scopedKey, setScopedKey] = useState<string | null>(null)
  const scopedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!accountScoped) return
    const supabase = createClient()
    let cancelled = false

    const switchTo = (userId: string | null) => {
      if (cancelled) return
      const key = accountCartKey(storageKey, userId)
      if (scopedKeyRef.current === key) return
      let next = readStoredCart(key)
      if (userId) {
        const guest = readStoredCart(storageKey)
        if (guest.length > 0) {
          next = mergeCartItems(next, guest)
          try {
            localStorage.setItem(key, JSON.stringify(next))
            localStorage.removeItem(storageKey)
          } catch {
            // Storage full / private mode
          }
        }
      }
      const firstLoad = scopedKeyRef.current === null
      scopedKeyRef.current = key
      setItems((current) => (firstLoad && current.length > 0 ? mergeCartItems(next, current) : next))
      setScopedKey(key)
    }

    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => switchTo(session?.user?.id ?? null))
      .catch(() => switchTo(null))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => switchTo(session?.user?.id ?? null))

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [accountScoped, storageKey])

  useEffect(() => {
    if (!accountScoped || !scopedKey) return
    try {
      localStorage.setItem(scopedKey, JSON.stringify(items))
    } catch {
      // Storage full / private mode
    }
  }, [accountScoped, items, scopedKey])

  // Load cart from localStorage on mount
  useEffect(() => {
    if (accountScoped) return
    setMounted(true)
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          setItems(parsed)
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, [accountScoped, storageKey])

  // Persist cart to localStorage on change
  useEffect(() => {
    if (accountScoped || !mounted) return
    localStorage.setItem(storageKey, JSON.stringify(items))
  }, [accountScoped, items, mounted, storageKey])

  const addItem = useCallback((item: Omit<CartItem, 'quantity'>, qty = 1) => {
    setItems(prev => {
      const existing = prev.find(i => i.variantId === item.variantId)
      if (existing) {
        return prev.map(i =>
          i.variantId === item.variantId
            ? { ...i, quantity: i.quantity + qty }
            : i
        )
      }
      return [...prev, { ...item, quantity: qty }]
    })
  }, [])

  const removeItem = useCallback((variantId: string) => {
    setItems(prev => prev.filter(i => i.variantId !== variantId))
  }, [])

  const updateQuantity = useCallback((variantId: string, qty: number) => {
    if (qty <= 0) {
      setItems(prev => prev.filter(i => i.variantId !== variantId))
      return
    }
    setItems(prev =>
      prev.map(i => (i.variantId === variantId ? { ...i, quantity: qty } : i))
    )
  }, [])

  const clearCart = useCallback(() => {
    setItems([])
  }, [])

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0)

  const subtotal = items.reduce((sum, i) => {
    if (i.price == null) return sum
    return sum + i.price * i.quantity
  }, 0)

  const hasItemsWithoutPrice = items.some(i => i.price == null || i.price <= 0)

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        totalItems,
        subtotal,
        hasItemsWithoutPrice,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
