'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────

interface HeroBanner {
  id: string
  title: string
  subtitle: string
  badge_text: string
  image_url: string
  link_url: string
  link_text: string
}

interface StoreHeroSliderProps {
  banners: HeroBanner[]
  /** Interval in ms between auto-slides. 0 = no auto-rotate. Default: 6000 */
  interval?: number
}

// ── Component ─────────────────────────────────────────────────────

export default function StoreHeroSlider({ banners, interval = 6000 }: StoreHeroSliderProps) {
  const [current, setCurrent] = useState(0)
  const [isPaused, setIsPaused] = useState(false)

  const count = banners.length

  const next = useCallback(() => {
    setCurrent(prev => (prev + 1) % count)
  }, [count])

  const prev = useCallback(() => {
    setCurrent(prev => (prev - 1 + count) % count)
  }, [count])

  // Auto-rotate
  useEffect(() => {
    if (count <= 1 || isPaused || interval === 0) return
    const timer = setInterval(next, interval)
    return () => clearInterval(timer)
  }, [count, isPaused, interval, next])

  if (count === 0) return null

  const banner = banners[current]

  return (
    <section
      className="relative overflow-hidden bg-gray-900"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Background image with overlay */}
      <div className="absolute inset-0 transition-opacity duration-700">
        <img
          key={banner.id}
          src={banner.image_url}
          alt={banner.title || 'Hero banner'}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-gray-900/80 via-gray-900/50 to-transparent" />
      </div>

      {/* Content */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
        <div className="max-w-2xl">
          {banner.badge_text && (
            <span className="inline-block px-3 py-1 text-xs font-medium tracking-wider uppercase text-blue-400 bg-blue-500/10 backdrop-blur-sm rounded-full mb-4 border border-blue-400/20">
              {banner.badge_text}
            </span>
          )}

          {banner.title && (
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.1] tracking-tight">
              {banner.title}
            </h1>
          )}

          {banner.subtitle && (
            <p className="mt-5 text-lg text-gray-300 max-w-lg leading-relaxed">
              {banner.subtitle}
            </p>
          )}

          {banner.link_url && (
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={banner.link_url}
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-blue-600 rounded-full hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/25"
              >
                {banner.link_text || 'Shop Now'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-gray-300 bg-white/10 backdrop-blur-sm rounded-full hover:bg-white/20 transition-all border border-white/10"
              >
                Business Login
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Navigation arrows */}
      {count > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 backdrop-blur-sm text-white/80 hover:bg-white/20 hover:text-white transition-all border border-white/10"
            aria-label="Previous slide"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={next}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 backdrop-blur-sm text-white/80 hover:bg-white/20 hover:text-white transition-all border border-white/10"
            aria-label="Next slide"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Dots indicator */}
      {count > 1 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2">
          {banners.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`h-2 rounded-full transition-all ${
                i === current
                  ? 'w-6 bg-white'
                  : 'w-2 bg-white/40 hover:bg-white/60'
              }`}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      )}
    </section>
  )
}
