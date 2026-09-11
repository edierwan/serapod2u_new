'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import useEmblaCarousel from 'embla-carousel-react'
import type { StorefrontProduct } from '@/lib/storefront/products'
import OutdoorProductCard from '@/components/outdoor/OutdoorProductCard'

export default function OutdoorProductRail({ products }: { products: StorefrontProduct[] }) {
  const [index, setIndex] = useState(0)
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: false,
  })

  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    emblaApi.on('select', onSelect)
    onSelect()
    return () => {
      emblaApi.off('select', onSelect)
    }
  }, [emblaApi, onSelect])

  if (products.length === 0) return null

  const canPrev = index > 0
  const canNext = emblaApi ? index < emblaApi.scrollSnapList().length - 1 : false

  return (
    <div className="relative">
      {products.length > 2 ? (
        <div className="mb-4 hidden justify-end gap-2 sm:flex">
          <button
            type="button"
            aria-label="Previous products"
            disabled={!canPrev}
            onClick={() => emblaApi?.scrollPrev()}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--out-line)] bg-white disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next products"
            disabled={!canNext}
            onClick={() => emblaApi?.scrollNext()}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--out-line)] bg-white disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      ) : null}

      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex gap-4 sm:gap-5">
          {products.map((product) => (
            <div key={product.id} className="min-w-0 flex-[0_0_78%] sm:flex-[0_0_46%] lg:flex-[0_0_23.5%]">
              <OutdoorProductCard product={product} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
