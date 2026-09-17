'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import useEmblaCarousel from 'embla-carousel-react'
import Autoplay from 'embla-carousel-autoplay'

export type OutdoorHeroSlide = {
  src: string
  alt: string
  href: string
  bg: string
  overlay?: 'shop-now' | 'moonchair' | null
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

  const active = slides[index] || slides[0]

  const slideShell = (slide: OutdoorHeroSlide) => (
    <div
      key={slide.src}
      className="relative min-w-0 flex-[0_0_100%] overflow-hidden rounded-[1.6rem] sm:rounded-[2rem]"
      style={{ background: slide.bg }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={slide.src}
        alt={slide.alt}
        className={`block w-full ${slide.overlay === 'shop-now' ? 'aspect-[4/5] object-cover sm:aspect-[5/4]' : 'h-auto object-contain'}`}
      />
      {slide.overlay === 'shop-now' ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 px-5 text-left sm:bottom-8 sm:px-8">
          <p className="font-display text-6xl leading-[0.85] tracking-tight text-white sm:text-7xl">shop</p>
          <p className="font-display text-6xl leading-[0.85] tracking-tight text-[var(--out-moss)] sm:text-7xl">now</p>
        </div>
      ) : null}
      {slide.overlay === 'moonchair' ? (
        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center sm:left-5">
          <p className="font-display text-[2.6rem] leading-[0.8] tracking-tight text-[var(--out-cream)] [writing-mode:vertical-rl] rotate-180 sm:text-6xl">
            Moonchair
          </p>
        </div>
      ) : null}
    </div>
  )

  return (
    <section className="px-4 sm:px-8 pb-2" aria-roledescription="carousel" aria-label="Campaign">
      <div className="mx-auto max-w-xl sm:max-w-3xl">
        <div className="relative overflow-hidden">
          {mounted ? (
            <div ref={emblaRef} className="overflow-hidden">
              <div className="flex">
                {slides.map((slide) => slideShell(slide))}
              </div>
            </div>
          ) : (
            slideShell(slides[0])
          )}
        </div>

        {count > 1 ? (
          <div className="mt-3 flex justify-center gap-1.5">
            {slides.map((slide, i) => (
              <button
                key={slide.src}
                type="button"
                aria-label={slide.alt}
                aria-current={i === index}
                onClick={() => emblaApi?.scrollTo(i)}
                className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-[var(--out-moss)]' : 'bg-[var(--out-moss)]/30'}`}
              />
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex justify-center">
          <Link
            href={active.href}
            className="inline-flex h-11 items-center rounded-full bg-[var(--out-moss)] px-8 text-sm font-semibold text-white hover:bg-[var(--out-moss-deep)]"
          >
            Shop Now
          </Link>
        </div>
      </div>
    </section>
  )
}
