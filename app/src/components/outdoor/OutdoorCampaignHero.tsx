'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import useEmblaCarousel from 'embla-carousel-react'
import Autoplay from 'embla-carousel-autoplay'

export type OutdoorHeroSlide = {
  src: string
  alt: string
  href: string
  bg: string
}

export default function OutdoorCampaignHero({ slides }: { slides: OutdoorHeroSlide[] }) {
  const count = slides.length
  const [index, setIndex] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: count > 1, duration: 28 },
    count > 1 ? [Autoplay({ delay: 6500, stopOnInteraction: false, stopOnMouseEnter: true })] : [],
  )

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

  useEffect(() => {
    setMounted(true)
  }, [])

  if (count === 0) return null

  const slideShell = (slide: OutdoorHeroSlide) => (
    <div
      key={slide.src}
      className="relative min-w-0 flex-[0_0_100%] flex items-center justify-center"
      style={{ background: slide.bg }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={slide.src}
        alt={slide.alt}
        className="block mx-auto h-auto w-auto max-w-full max-h-[62svh] min-h-0 object-contain sm:max-h-[72vh] lg:max-h-[min(78vh,56rem)]"
      />
      <Link
        href={slide.href}
        className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-[var(--out-ink)] transition hover:bg-[var(--out-moss)] hover:text-white sm:bottom-6 sm:h-11 sm:px-7"
      >
        Shop now
      </Link>
    </div>
  )

  if (!mounted) {
    return (
      <section className="px-3 sm:px-5 lg:px-8 pb-8 sm:pb-10" aria-label="Campaign">
        <div className="mx-auto max-w-6xl">
          <div className="relative overflow-hidden rounded-2xl sm:rounded-[2rem]">
            {slideShell(slides[0])}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="px-3 sm:px-5 lg:px-8 pb-8 sm:pb-10" aria-roledescription="carousel" aria-label="Campaign">
      <div className="mx-auto max-w-6xl lg:grid lg:grid-cols-[minmax(0,1fr)_5.5rem] lg:gap-3 lg:items-stretch">
        <div className="relative overflow-hidden rounded-2xl sm:rounded-[2rem]">
          <div ref={emblaRef} className="overflow-hidden">
            <div className="flex">
              {slides.map((slide) => slideShell(slide))}
            </div>
          </div>

          {count > 1 ? (
            <>
              <button
                type="button"
                aria-label="Previous"
                onClick={() => emblaApi?.scrollPrev()}
                className="absolute left-3 top-1/2 z-10 hidden -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[var(--out-ink)] shadow-sm hover:bg-white sm:flex"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Next"
                onClick={() => emblaApi?.scrollNext()}
                className="absolute right-3 top-1/2 z-10 hidden -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[var(--out-ink)] shadow-sm hover:bg-white sm:flex"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : null}
        </div>

        {count > 1 ? (
          <div className="mt-3 flex justify-center gap-2 lg:mt-0 lg:flex-col">
            {slides.map((slide, i) => (
              <button
                key={slide.src}
                type="button"
                aria-label={slide.alt}
                aria-current={i === index}
                onClick={() => emblaApi?.scrollTo(i)}
                className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border-2 sm:h-16 sm:w-16 sm:rounded-2xl lg:h-auto lg:w-full lg:flex-1 ${
                  i === index ? 'border-[var(--out-ink)]' : 'border-transparent opacity-70 hover:opacity-100'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slide.src} alt="" className="h-full w-full object-cover object-center" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
