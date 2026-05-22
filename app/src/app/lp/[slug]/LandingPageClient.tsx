'use client'

import { useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle2, Lock, MessageCircle, Package, ShieldCheck, ShoppingBag, ShoppingCart, Truck } from 'lucide-react'

import type { LandingPageResolveResult, LandingPageResolvedProduct } from '@/lib/landing-pages/types'
import { useCart } from '@/lib/storefront/cart-context'
import {
  buildLandingPageAttribution,
  getLandingPageSessionId,
  saveLandingPageAttribution,
  trackLandingPageEvent,
} from '@/lib/storefront/landing-attribution'

function formatPrice(price: number | null) {
  if (price == null || price <= 0) return 'Contact for price'
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(price)
}

function productImage(product: LandingPageResolvedProduct) {
  return product.image_url || product.animation_url || null
}

function truncate(value: string | null, fallback: string) {
  const text = value?.trim() || fallback
  return text.length > 150 ? `${text.slice(0, 147)}...` : text
}

export default function LandingPageClient({ result, preview }: { result: LandingPageResolveResult; preview: boolean }) {
  const page = result.page!
  const router = useRouter()
  const { addItem } = useCart()
  const tracked = useRef(false)
  const heroImage = page.hero.hero_image_url || productImage(result.products[0])

  const attribution = useMemo(() => {
    if (typeof window === 'undefined') return null
    const sessionId = getLandingPageSessionId(page.slug)
    const searchParams = new URLSearchParams(window.location.search)
    const base = buildLandingPageAttribution({
      landingPageId: page.id,
      landingPageSlug: page.slug,
      landingPageSessionId: sessionId,
      sourceCode: page.tracking_defaults.source_code,
      searchParams,
      referrer: document.referrer,
    })

    return {
      ...base,
      landingPageTitle: page.public_title,
      sourceCode: base.sourceCode || page.tracking_defaults.source_code,
      utmSource: base.utmSource || page.tracking_defaults.utm_source,
      utmMedium: base.utmMedium || page.tracking_defaults.utm_medium,
      utmCampaign: base.utmCampaign || page.tracking_defaults.utm_campaign,
      utmContent: base.utmContent || page.tracking_defaults.utm_content,
      utmTerm: base.utmTerm || page.tracking_defaults.utm_term,
    }
  }, [page])

  useEffect(() => {
    if (!attribution || tracked.current || preview) return
    tracked.current = true
    saveLandingPageAttribution(attribution)
    trackLandingPageEvent('page_view', { landingPageId: page.id, landingPageSlug: page.slug, landingPageSessionId: attribution.landingPageSessionId, attribution })
    for (const product of result.products) {
      trackLandingPageEvent('product_impression', {
        landingPageId: page.id,
        landingPageSlug: page.slug,
        landingPageSessionId: attribution.landingPageSessionId,
        productId: product.id,
        variantId: product.primary_variant?.id,
        attribution,
      })
    }
  }, [attribution, page.id, page.slug, preview, result.products])

  const addProduct = (product: LandingPageResolvedProduct, goToCheckout = false) => {
    if (!product.primary_variant || !product.can_purchase) return
    if (attribution) saveLandingPageAttribution(attribution)

    addItem({
      productId: product.id,
      variantId: product.primary_variant.id,
      productName: product.product_name,
      variantName: product.primary_variant.variant_name,
      price: product.primary_variant.price,
      imageUrl: product.primary_variant.image_url || product.image_url,
    })

    trackLandingPageEvent(goToCheckout ? 'buy_now_click' : 'add_to_cart', {
      landingPageId: page.id,
      landingPageSlug: page.slug,
      landingPageSessionId: attribution?.landingPageSessionId,
      productId: product.id,
      variantId: product.primary_variant.id,
      attribution,
    })

    if (goToCheckout) router.push('/store/checkout')
  }

  const trackProductClick = (product: LandingPageResolvedProduct) => {
    trackLandingPageEvent('product_click', {
      landingPageId: page.id,
      landingPageSlug: page.slug,
      landingPageSessionId: attribution?.landingPageSessionId,
      productId: product.id,
      variantId: product.primary_variant?.id,
      attribution,
    })
  }

  const whatsappHref = (product?: LandingPageResolvedProduct) => {
    const phone = page.display_settings.whatsapp_phone.replace(/[^0-9]/g, '')
    if (!phone) return '#'
    const text = product
      ? `Hi Serapod2U, I am interested in ${product.product_name} from ${page.public_title}.`
      : `Hi Serapod2U, I am interested in ${page.public_title}.`
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
  }

  return (
    <main className="bg-white">
      {preview && (
        <div className="sticky top-0 z-40 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-800">
          Admin preview
        </div>
      )}

      <header className="border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/store" className="flex items-center gap-2 text-sm font-bold tracking-tight text-slate-950">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-600 text-white">S</span>
            <span>Serapod2U</span>
          </Link>
          <Link href="/store/cart" className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-emerald-500 hover:text-emerald-700">
            <ShoppingCart className="h-4 w-4" />
            Cart
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-emerald-100 bg-gradient-to-br from-white via-emerald-50/70 to-orange-50/60">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-20">
          <div>
            {page.hero.badge_text && (
              <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
                {page.hero.badge_text}
              </span>
            )}
            <h1 className="mt-5 max-w-2xl text-4xl font-black leading-tight tracking-normal text-slate-950 sm:text-5xl lg:text-6xl">
              {page.hero.headline || page.public_title}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
              {page.hero.subtitle || page.description}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#products" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 text-sm font-bold text-white shadow-lg shadow-emerald-900/10 hover:bg-emerald-800">
                {page.hero.primary_cta_label || 'Shop Now'}
                <ArrowRight className="h-4 w-4" />
              </a>
              {page.hero.secondary_cta_label && (
                page.hero.secondary_cta_url ? (
                  <Link href={page.hero.secondary_cta_url} className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-sm font-bold text-slate-800 hover:border-orange-500 hover:text-orange-700">
                    {page.hero.secondary_cta_label}
                  </Link>
                ) : (
                  <a href="#products" className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-sm font-bold text-slate-800 hover:border-orange-500 hover:text-orange-700">
                    {page.hero.secondary_cta_label}
                  </a>
                )
              )}
            </div>
          </div>

          <div className="relative">
            <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-2xl shadow-emerald-900/10">
              {heroImage ? (
                <img src={heroImage} alt="" className="h-full w-full object-contain p-4" />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-300">
                  <Package className="h-20 w-20" />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-100 bg-white">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
          {[
            { icon: ShieldCheck, label: '100% Authentic', text: 'Genuine products' },
            { icon: Lock, label: 'Secure Payment', text: 'Encrypted checkout' },
            { icon: Truck, label: 'Fast Delivery', text: 'Nationwide shipping' },
            { icon: CheckCircle2, label: 'Curated Selection', text: 'No all-products fallback' },
          ].map((item) => {
            const Icon = item.icon
            return (
              <div key={item.label} className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Icon className="h-5 w-5" /></span>
                <span><span className="block text-sm font-bold text-slate-900">{item.label}</span><span className="block text-xs text-slate-500">{item.text}</span></span>
              </div>
            )
          })}
        </div>
      </section>

      <section id="products" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Curated Products</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">Shop This Campaign</h2>
          </div>
          {page.category_name && <span className="text-sm font-medium text-slate-500">{page.category_name}</span>}
        </div>

        {result.products.length === 0 ? (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-8 text-center">
            <Package className="mx-auto h-12 w-12 text-orange-500" />
            <h3 className="mt-4 text-lg font-bold text-slate-950">Campaign Unavailable</h3>
            <p className="mt-2 text-sm text-slate-600">{result.reason || 'No valid products are available for this campaign.'}</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {result.products.map((product) => {
              const imageUrl = productImage(product)
              return (
                <article key={product.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-900/5">
                  <Link href={`/store/products/${product.id}`} onClick={() => trackProductClick(product)} className="block aspect-[4/3] bg-slate-50">
                    {imageUrl ? (
                      <img src={imageUrl} alt={product.product_name} className="h-full w-full object-contain p-4" loading="lazy" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-300"><Package className="h-12 w-12" /></div>
                    )}
                  </Link>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex flex-wrap gap-2">
                      {product.brand_name && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">{product.brand_name}</span>}
                      {product.category_name && <span className="rounded-full bg-orange-50 px-2 py-1 text-[11px] font-bold text-orange-700">{product.category_name}</span>}
                    </div>
                    <h3 className="mt-3 line-clamp-2 text-base font-black text-slate-950">{product.product_name}</h3>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{truncate(product.short_description || product.product_description, 'Curated for this campaign.')}</p>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Price</p>
                        <p className="text-lg font-black text-slate-950">{formatPrice(product.starting_price)}</p>
                      </div>
                      {product.active_variant_count > 1 && <span className="text-xs font-semibold text-slate-400">{product.active_variant_count} variants</span>}
                    </div>
                    <div className="mt-5 grid gap-2">
                      <Link href={`/store/products/${product.id}`} onClick={() => trackProductClick(product)} className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:border-slate-400">
                        View Product
                      </Link>
                      {page.display_settings.cta_mode !== 'view_product' && page.display_settings.enable_add_to_cart && product.can_purchase && (
                        <button type="button" onClick={() => addProduct(product)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-700 text-sm font-bold text-white hover:bg-emerald-800">
                          <ShoppingBag className="h-4 w-4" />
                          Add to Cart
                        </button>
                      )}
                      {page.display_settings.enable_buy_now && product.can_purchase && (
                        <button type="button" onClick={() => addProduct(product, true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-bold text-white hover:bg-slate-800">
                          Buy Now
                        </button>
                      )}
                      {page.display_settings.enable_whatsapp && page.display_settings.whatsapp_phone && (
                        <a href={whatsappHref(product)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-bold text-emerald-800 hover:bg-emerald-100">
                          <MessageCircle className="h-4 w-4" />
                          WhatsApp Inquiry
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <footer className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="font-semibold text-slate-700">Serapod2U Supply Chain</p>
          <p>Curated campaign products only.</p>
        </div>
      </footer>
    </main>
  )
}