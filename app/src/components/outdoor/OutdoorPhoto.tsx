'use client'

import { useEffect, useRef, useState } from 'react'

/** Centred label over a sold-out photo; the parent needs `relative` and `out-sold-out` to fade the image. */
export function OutdoorSoldOutTag({ large = false }: { large?: boolean }) {
  return (
    <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status">
      <span
        className={`rounded-full bg-[var(--out-bark)] font-semibold uppercase tracking-[0.18em] text-[var(--out-cream)] shadow-lg ${
          large ? 'px-5 py-2 text-sm' : 'px-3.5 py-1.5 text-[11px]'
        }`}
      >
        Sold out
      </span>
    </span>
  )
}

/**
 * A master-data photo that swaps to the bundled packshot, if there is one, when it fails
 * to load, and to a plain panel when that fails too, never a broken-image icon.
 */
export default function OutdoorPhoto({
  src,
  backup,
  alt,
  className,
}: {
  src: string
  backup?: string | null
  alt: string
  className?: string
}) {
  const [stage, setStage] = useState<'photo' | 'backup' | 'none'>('photo')
  const ref = useRef<HTMLImageElement>(null)
  const shown = stage === 'photo' ? src : stage === 'backup' ? backup || '' : ''

  const fail = () => {
    setStage((current) => (current === 'photo' && backup && backup !== src ? 'backup' : 'none'))
  }

  // A photo that failed before hydration never fires onError, so check it once mounted.
  useEffect(() => {
    const img = ref.current
    if (img && img.complete && img.naturalWidth === 0 && !/\.svg($|\?)/i.test(img.currentSrc || img.src)) fail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (stage === 'none' || !shown) {
    return <div role="img" aria-label={alt} className={`${className || ''} rounded-xl bg-[var(--out-sand)]/30`} />
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} src={shown} alt={alt} className={className} onError={fail} />
  )
}
